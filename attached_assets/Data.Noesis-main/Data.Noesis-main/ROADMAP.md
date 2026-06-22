# Next Steps

## 1. Parse Reviews + Pricing ✓

### Reviews Scraping ✓
- avg_rating + review_count stored per listing via reviews_bronze, joined into gold
- Enables quality scoring per area

### Pricing Parsing ✓
- **Weekday + weekend sampling** — Tuesday (weekday) + Friday (weekend) per week × 28 weeks = 56 sample dates covering ~6.5 months forward
- 3-night windows via search_by_area() to extract nightly rate from price breakdown string
- **5 dates in parallel** (DATE_WORKERS=5) — safe with rotating proxies (each request is a different IP); SEARCH_DELAY=1s between tiles
- pricing_bronze (append-only) → pricing_silver (latest price + date_changed tracking)
- **Smart progress logging** — per-tile noise suppressed; logs every 25 tiles with % progress + ETA on date completion
- Runs independently via run_pricing.py every **Tuesday at 04:00**
- Cross-onboarding: new listings discovered by pricing are automatically onboarded into availability pipeline
- ✅ **First run completed Apr 2026** — 486 tiles, ~850 MB bandwidth, ~4.5 hours, 7,788/12,829 listings captured in pricing_silver (61% coverage), 95 new listings discovered

---

## 2. Move to Server + Full Cyprus Coverage ✓

### Completed
- **Hetzner CX22 VPS** (Helsinki, Ubuntu 24.04, €4.35/mo + backups) — scraper runs independently of laptop
- **GitHub deploy sync** — SSH deploy key on server, `git pull` to deploy any change
- **Cron jobs** — `run_availability.py` every 2 days at 18:45, `run_discovery.py` 1st + 15th of each month at 14:00, `run_pricing.py` weekly Tuesdays at 04:00
- **run.py split into two scripts** — `run_availability.py` (calendar fetches only, every 2 days) + `run_discovery.py` (tile search + listing metadata, weekly)
- **Full Cyprus coverage** — 15 regions covering all Greek Cypriot districts including south coast, east coast, and inland corridors
- **No-date tile search** — discovery searches without check_in/check_out, returning all active listings regardless of booking status
- **Parallel calendar fetches** — `ThreadPoolExecutor(max_workers=4)` — reduced from 8 to avoid rate limiting
- **Gold microbatch processing** — rewrote gold layer to process 200 listings at a time (was loading 4.5M rows into Python → OOM kill); DuckDB memory capped at 1.5GB; first full run ~5hrs, incremental runs minutes
- **Standalone silver/gold scripts** — `analytics/create_silver.py` + `analytics/create_gold.py` for manual reruns independent of availability pipeline
- **Biweekly local backup** — `~/Desktop/backups/run_backup.sh` exports all DuckDB tables to Parquet and downloads to local machine; cron 1st + 15th of each month
- **Incremental gold** — only reprocesses listings where silver changed since last run (watermark-based)
- **Delisted listing detection** — `listings.last_seen_at` updated every discovery run; listings absent for 14+ days excluded from gold
- **Email alerts** — Gmail SMTP (port 587), notifies on start / exception / end
- **Webshare rotating residential proxies** — wired into all three scripts via `WEBSHARE_PROXY_URL` env var; bypasses Airbnb IP blocks
- **Exponential backoff** — retries on 429/502/503 with jitter; 403 retried with short delay when proxy active (rotates IP); `Connection: close` header forces fresh IP per calendar request

---

## 2.5 Listing Enrichment — StaysPdpSections ← next up

Enrich each listing with full detail data from Airbnb's `StaysPdpSections` GraphQL endpoint — the same data shown on a listing's detail page. Runs as a second phase inside `run_discovery.py` after tile searches complete, only for listings not refreshed in the last 30 days (capped at 200/run).

### Endpoint confirmed ✓
- Operation: `StaysPdpSections`
- Hash: `7afae2523702f3fb10726682c19bdfb2313518a4eb1b9f7b15b217e1de1905e5`
- Response path: `data.presentation.stayProductDetailPage.sections.sections[]`
- Each section identified by `sectionComponentType` field
- Confirmed sections: `POLICIES_DEFAULT` (house rules, cancellation, pets), `OVERVIEW_DEFAULT_V2` (guests, bedrooms, bathrooms)
- Amenities + reviews section types to be discovered on first test run (logged for mapping)

### New data captured

**Listings table (new columns):**
- `amenities` (VARCHAR/JSON) — full list with categories (pool, garden, parking, AC, wifi, kitchen, hot tub, BBQ…)
- `bathrooms` (FLOAT)
- `max_guests` (INTEGER)
- `sleeping_arrangements` (VARCHAR/JSON) — per-bedroom bed types
- `description` (TEXT)
- `is_superhost` (BOOLEAN)
- `host_response_rate` (VARCHAR)
- `cancellation_policy` (VARCHAR)
- `pets_allowed` (BOOLEAN)
- `details_fetched_at` (TIMESTAMP) — refresh watermark

**New table: `listing_reviews`**
- Last 6–7 review snippets per listing per run
- Fields: `listing_id`, `execution_timestamp`, `reviewer_name`, `review_date`, `review_text`, `language`
- Enables future sentiment analysis / AI summary features

**New table: `listing_ratings`**
- Detailed rating breakdown per listing per run
- Fields: `cleanliness`, `accuracy`, `communication`, `location`, `checkin`, `value`
- More granular than the single avg_rating currently stored in reviews_bronze

### What this unlocks
- Amenity-based filtering in dashboard (pool / garden / parking / AC)
- Superhost quality signal for analytics
- Hedonic price modelling inputs (amenities + bathrooms + capacity → price drivers)
- Review snippets for future AI-generated property summaries
- Bedroom-level sleeping arrangement data (currently only bedroom count)

### Implementation steps
1. Discover `PdpSections` hash + response structure via Chrome DevTools (`/rooms/<id>` network tab)
2. Add `fetch_pdp_hash()` + `get_listing_details()` + `_parse_pdp_sections()` to `scraper/airbnb_client.py`
3. Add new columns + tables to `init_db()`, add `write_listing_details()` + `get_listings_needing_details()` to `storage/storage.py`
4. Add `_fetch_listing_details_batch()` phase to `run_discovery.py`
5. Test with `per_run_limit=5` locally before deploying

---

## 2.6. Booking.com — Feasibility Assessment

### Difficulty vs Airbnb

| Factor | Airbnb | Booking.com |
|---|---|---|
| Anti-bot system | TLS fingerprint — solved with `curl_cffi` | **DataDome** — dedicated anti-bot vendor, far more aggressive |
| Scraping method | Lightweight HTTP client | Requires headless browser (Playwright) or paid bypass |
| Internal API | Clean JSON endpoints (StaysSearch, PdpAvailabilityCalendar) | No clean internal API; heavily JS-rendered |
| Rate limiting | Manageable with proxy rotation | Very tight; fast IP bans |
| Maintenance burden | Low — endpoints stable for months | High — DataDome challenges evolve regularly |
| Relative difficulty | Baseline | **5–10× harder and more expensive** |

### Alternatives to building our own scraper
- **Apify** has a maintained Booking.com scraper — pay per result, no maintenance on our end. Viable for a pilot.
- **Transparent Intelligence / AirDNA** license Booking data — expensive, aimed at enterprises.
- **Check volume first** — before investing in a Booking.com pipeline, manually estimate how many STR-specific listings (apartments/villas, not hotels) exist in Cyprus on Booking vs Airbnb. We currently have ~13k Airbnb listings. If Booking adds meaningfully more unique supply, it's worth it. If it's mostly hotels and duplicates, it isn't.

### Decision criteria
Build only if:
1. Manual check confirms Booking has significant non-hotel STR supply in Cyprus that Airbnb doesn't have
2. Revenue/product justifies the complexity and ongoing maintenance cost
3. Airbnb pipeline is fully stable and enriched (Sections 2.5 done)

### Action
Before committing: run a quick manual count on Booking.com filtering for "apartments/villas, entire place" in key Cyprus areas. Compare to our 13k Airbnb figure. Decision becomes obvious.

---

## 3. Build History (3–6 Months)

- Let the scraper run silently with full Cyprus coverage
- Accumulate occupancy, pricing, reviews, and booking data across all markets
- No pitching until data is solid — data in hand is the credibility

---

## 3.5. PostgreSQL Migration — Prerequisite for Go-Live

DuckDB is an analytical database designed for single-user heavy queries, not concurrent web traffic. It holds a single-writer lock that blocks **all** connections — including reads — during every scrape run. Dashboard users see errors every 2 days (availability), every Tuesday (pricing), and every Wednesday (enrichment). Must be resolved before any public launch.

### Why PostgreSQL

| | DuckDB | PostgreSQL |
|---|---|---|
| Concurrent readers | ❌ blocked during writes | ✅ unlimited |
| Concurrent writers | ❌ one at a time | ✅ row-level locks |
| Dashboard during scrape | ❌ errors | ✅ works fine |
| Multiple scraper nodes (future) | ❌ impossible | ✅ built for this |
| Query rewrites needed | — | ~5% (minor syntax) |

PostgreSQL uses **MVCC** (Multi-Version Concurrency Control) — every transaction gets a consistent snapshot. Readers and writers never block each other. Standard for any production web app.

### Migration Plan

**Phase A — Sync-based (low risk, do now)**

Keep scraper writing to DuckDB unchanged. After each cron run, a sync script exports read tables to Postgres. FastAPI reads from Postgres only.

```
Scraper → DuckDB (unchanged)
              ↓ sync script (runs post-scrape)
           PostgreSQL ← FastAPI ← Dashboard
```

Steps:
1. Install Postgres on the Hetzner server
2. Create sync script: export `gold`, `listings`, `availability_latest`, `pricing_silver` → Postgres via Parquet COPY
3. Add sync script call at the end of each cron job
4. Point `api/db.py` at Postgres instead of DuckDB

Zero risk to the pipeline — scraper is completely untouched. Dashboard may show data that is minutes behind (sync runs after scrape completes).

**Phase B — Full migration (do before public launch)**

Rewrite `storage/storage.py` to write directly to Postgres. DuckDB retired. Single source of truth.

```
Scraper → PostgreSQL ← FastAPI ← Dashboard
```

Steps:
1. Rewrite `storage/storage.py` to use `psycopg2` / `asyncpg`
2. One-time migration: export all DuckDB tables → import into Postgres with same table names
3. Update `api/db.py` to use Postgres connection
4. Retire DuckDB

### Where to run Postgres

| Option | Cost | Setup | Recommendation |
|---|---|---|---|
| Same Hetzner CX22 server | Free | 30 min | **Start here** — CX22 has 4GB RAM, plenty for Postgres + scraper |
| Hetzner Managed Postgres | €5–10/mo | 10 min | Upgrade when paying customers exist (auto backups, HA) |

### Notes
- Table names stay the same across both phases — no API query changes in Phase A
- This is also required for distributed scraping (Section 9) — DuckDB cannot handle concurrent writes from multiple nodes
- Phase A can be done in a day; Phase B is the larger rewrite, do it right before launch

---

## 4. Refine the Dashboard

### 4a. Foundation ✓
- FastAPI backend (`api/`) with `/api/summary` endpoint — occupancy, pricing, listing counts per area from DuckDB
- Next.js 15 frontend (`frontend/`) — stat cards + area table, dark theme

### 4b. Deploy to Server ← next up
- Install FastAPI + uvicorn on Hetzner, run as a `systemd` service (auto-restarts on crash, starts on boot)
- nginx reverse proxy: `/api/*` → FastAPI (port 8000), static frontend files served from same server
- Build Next.js locally (`npm run build`) → copy static output to server → nginx serves it
- Verify dashboard data auto-refreshes after each cron run (API reads DB live on every request — no rebuild needed)
- Auth: token header check in FastAPI before making it publicly accessible
- Domain + SSL (Let's Encrypt via Certbot) — needed before sharing with anyone

### 4c. Design — Sleek & Fresh
The old `dashboard.html` is the reference for what should be here. Key design goals:
- Consistent dark navy palette (`#131c2b` background, `#1a2638` cards, `#1e3048` borders) — warmer and richer than plain grey
- Sticky filter bar at the top (date range, metric toggle, property type pills, bedrooms pills, region dropdown)
- KPI cards with left accent border and delta indicators (vs previous period)
- Booking velocity row — how many nights were booked in the last 30 days
- Zone comparison cards — appear when user draws zones on the map

### 4d. Filters
All data on the page should react to these filters (API passes them as query params):
- **Date range** — from/to month selectors
- **Metric** — toggle between Occupancy % and Avg Price / Night
- **Property type** — pill selector (apartment, house, villa, entire home…)
- **Bedrooms** — pill selector (studio, 1, 2, 3, 4+)
- **Region** — dropdown (all regions + each area individually)

### 4e. Map — Draw Zones, Compare Markets
The map is the centrepiece of the dashboard. Reference: `dashboard.html` had a full Leaflet map with draw + cluster.
- **react-leaflet** map centred on Cyprus, listing markers clustered (colour by occupancy bucket)
- **Draw tool** — user draws up to 3 rectangles/polygons on the map; each zone gets a colour
- **All data on the page updates** to reflect only listings inside the drawn zone(s)
- **Zone comparison panel** — side-by-side KPIs for each drawn zone (occupancy, price, listing count, revenue estimate)
- Colour mode toggle: colour markers by occupancy or by avg price
- Fullscreen button for the map
- API needs a `/api/listings` endpoint returning all listing coordinates + metrics (for map rendering)

### 4f. Charts (Recharts)
- Monthly occupancy trend line — overall avg + per drawn zone ✓ (started)
- Seasonality chart — avg occupancy by calendar month (Jan–Dec pattern)
- Occupancy distribution histogram — how spread out are listings across occupancy buckets
- Price vs occupancy scatter plot — one dot per listing, reveals elasticity
- Nights booked per day — last 30 days bar chart (booking velocity)
- Bedroom breakdown table — listings / avg occupancy / avg price / est. revenue per bedroom count
- **Migrate database from DuckDB → PostgreSQL** at this stage (concurrent FastAPI connections require it)
  - DuckDB SQL maps cleanly to PostgreSQL — no query rewrites, mostly syntax-compatible
  - Migration script: export DuckDB tables to Parquet → import into PostgreSQL
  - Table names are already finalised in DuckDB (`availability_log`, `availability_latest`, `bookings`, `gold`, `listings`, `reviews_bronze`, `pricing_bronze`, `pricing_silver`) — use same names in PostgreSQL
  - One-time effort, low risk given clean data model

---

## 5.5 Sophisticated Revenue Model

Naive `revenue = price_per_night × occupancy` misses three big effects we can now
capture given dated pricing snapshots:

1. **Booked-at price ≠ current price** — once a date is booked, Airbnb stops
   updating its displayed price. We need the price from `pricing_bronze`
   *as of the snapshot immediately before the date flipped to unavailable*.
2. **Lead-time pricing** — hosts adjust prices as check-in approaches; the
   realised price is the one at booking-detection time, not today's.
3. **Stay-length effects** — weekly / monthly discounts mean per-night revenue
   varies with `stay_length_nights` (now available in gold).

Output: `gold.realised_price_per_night`, `gold.revenue_estimate_gross`,
`gold.revenue_estimate_net` (after ~12% Cyprus VAT + Airbnb host fee).

Prerequisites: 4+ weeks of `pricing_bronze` history, cleaning-fee field from
listing enrichment, decision on gross vs net display in the dashboard.

Full design in [`DATA_ENGINEERING_ROADMAP.md`](DATA_ENGINEERING_ROADMAP.md#2-revenue-model--beyond-price--occupancy)
(section 2). Builds on `pricing_gold` (section 3 there).

---

## 6. Econometric Layer

- Demand elasticity modelling (price vs occupancy sensitivity)
- Optimal pricing recommendations per property type / area / season
- Market saturation analysis (where is supply outpacing demand?)
- Investment return modelling (is buying a 2-bed in Paphos a good STR investment?)
- Forecasting (Q3 projections based on historical patterns)

### Modelling Approaches

**Hedonic Price Model** — baseline approach. Treats each listing as a bundle of characteristics (location, room type, capacity, reviews) and estimates each characteristic's individual contribution to price. Most common in STR literature.

**Spatial Models (MGWR / SDM)** — Multiscale Geographically Weighted Regression and the Spatial Durbin Model account for spatial dependence, quantifying how nearby competing listings affect a property's price. Directly applicable to our per-neighbourhood data.

**Dynamic Pricing Models** — time-series analysis adjusting prices based on booking velocity, seasonal demand, and remaining supply. Integration with ML (XGBoost, Gradient Boosting) enables real-time optimisation.

**Panel Regression-Discontinuity Design (RDD)** — isolates the causal effect of policy or market changes (e.g. a regulatory shift, a new competitor entering the market) on price. Useful for report-level analysis.

**Repeat Sales Index** — tracks true ADR (Average Daily Rate) changes by comparing the same listing over time, controlling for quality changes. Reliable market price trend indicator.

**Hybrid ML Approaches** — combining traditional hedonic models with Random Forest, XGBoost, or Neural Networks improves accuracy for heterogeneous properties. Studies show superior predictive performance over pure econometric methods.

### Key Price Drivers (from literature)
- **Location & proximity** — distance to city centre or tourist attractions
- **Property features** — size and capacity account for up to 72% of price variation
- **Reputation** — review scores and review sentiment
- **Dynamic factors** — seasonality, day of week, booking lead time

### What Our Data Enables
We have the inputs for all of the above: nightly prices over time, occupancy, location, property type, bedrooms, reviews (upcoming), and booking velocity. The full model stack is buildable once 6+ months of history is in hand.

---

## 7. Regulatory Intelligence Layer (NLP + Web Agent)

Build an automated agent that periodically browses the web, scrapes official government and municipal sources, and extracts STR-relevant regulations and subsidies per area — then surfaces changes in the dashboard.

### Why this matters
Regulations are the single biggest risk factor for STR investors. A property that yields 7% today can be worthless overnight if the municipality bans short-term rentals or introduces a licensing cap. No product in the Cypriot market currently tracks this in one place.

### What to monitor
- **STR licensing requirements** — Cyprus Tourism Organisation (CTO) registration rules, per-district permit caps
- **Municipal restrictions** — Nicosia, Limassol, Paphos, Larnaca municipal bylaws on STR activity
- **Tax changes** — VAT treatment of STR income, special contribution tax, income tax brackets for rental income
- **Government subsidies & grants** — EU structural funds, Tourism Ministry renovation grants, rural development subsidies for property investment
- **Zoning changes** — land use changes affecting which areas permit STR

### Sources to target
- Cyprus Tourism Organisation: visitcyprus.com + CTO official portal
- Ministry of Interior (planning permits)
- Tax Department (taxisnet.mof.gov.cy)
- Municipal council announcement feeds (Nicosia, Limassol, Larnaca, Paphos)
- Famagusta district (Ayia Napa / Protaras) municipality
- Official Gazette of the Republic of Cyprus (gazette.moi.gov.cy)

### Technical approach
- **Web agent** — uses an LLM (Claude API with tool use) + web search to browse target URLs and extract structured information
- **Schedule** — run weekly; regulations do not change daily
- **Storage** — new `regulatory_intel` table: `(source_url, area, category, summary, raw_text, fetched_at, changed_at)`
- **Change detection** — compare incoming summary against last snapshot; flag if content has materially changed
- **Dashboard integration** — "Regulatory Alerts" panel: last checked date, any recent changes highlighted in red
- **iMessage alert** — notify when a change is detected

### Priority
Do this **after** Section 3 (history building is underway) and alongside Section 4 (dashboard refinement). This becomes a key product differentiator during the subscription pitch — no competitor offers regulatory intelligence bundled with market data.

---

## 8. Product & Distribution

- Weekly auto-generated market reports (PDF/email) — higher value than dashboard alone
- Subscription tiers: Dashboard access / Weekly reports / Custom econometric analysis
- First target: Cyprus property managers and real estate investors
- Proof of concept in Cyprus → expand to Greece → broader Mediterranean

---

## 5. Bazaraki Integration — Property ROI Dashboard ✅ Scraper built

Scrape Bazaraki.com (Cyprus's main property classifieds) and combine with Airbnb STR data to produce a **Return on Investment dashboard** — the most commercially valuable product in this stack.

### The idea
A buyer looking at a 2-bed apartment in Limassol for €280,000 can instantly see:
- Expected annual STR revenue based on real occupancy + pricing data for that area and bedroom count
- Gross yield: `annual_revenue / purchase_price`
- Net yield estimate after typical costs (management, maintenance, platform fees)
- Payback period
- Comparison across areas: *"Same budget gets you 6.2% yield in Larnaca vs 4.8% in Limassol"*

### Why this is a strong idea
- **No equivalent product exists in Cyprus** — investors currently guess or rely on developer projections
- **The data combination is the moat** — Bazaraki alone is just listings; Airbnb alone is just rentals; together they answer the question investors actually pay for
- **Directly actionable** — tells you exactly where to buy and what to expect in return
- **Natural upsell** — dashboard subscribers upgrade to this; developers and banks pay for custom analysis
- **Expands the audience** — adds real estate investors and developers who have no reason to use a pure STR tool

### What we scrape from Bazaraki ✅
Clean JSON geometry API — no bot protection, coordinates per listing.

**For sale (~16,000+ listings):** listing_id, title, price (€), lat/lng, bedrooms, property_type
**For rent (~7,000+ listings):** listing_id, title, monthly_rent (€), lat/lng, bedrooms, property_type

Four rubrics: apartments/houses × sale/rental. Paginated via `next` URL.

### Storage tables ✅
- `bazaraki_sale_log` / `bazaraki_sale_latest` — price + coordinates, price_changed tracking
- `bazaraki_rental_log` / `bazaraki_rental_latest` — monthly_rent + coordinates

### Runners ✅
- `run_bazaraki_sale.py` — scrapes apartments + houses for sale
- `run_bazaraki_rental.py` — scrapes apartments + houses for rent

### ROI calculation model

**STR yield:**
```
annual_str_revenue = avg_nightly_price × occupancy_rate × 365
str_gross_yield    = annual_str_revenue / purchase_price × 100
str_net_yield      = (annual_str_revenue × 0.75) / purchase_price × 100  # ~25% costs
```

**LTR yield:**
```
annual_ltr_revenue = avg_monthly_rent × 12
ltr_gross_yield    = annual_ltr_revenue / purchase_price × 100
ltr_net_yield      = (annual_ltr_revenue × 0.85) / purchase_price × 100  # ~15% costs
```

Occupancy and STR price from Airbnb silver/gold. LTR rent from Bazaraki rental. Purchase price from Bazaraki sale. All segmented by area + bedrooms.

### Status ✅ Tested — 400 listings, prices + coordinates correct, log/latest pipeline working

### Next steps

**5a. Run full scrape ← next up**
```bash
nohup /opt/bnb/venv/bin/python3 run_bazaraki_sale.py >> /opt/bnb_git/logs/bazaraki_sale.log 2>&1 &
nohup /opt/bnb/venv/bin/python3 run_bazaraki_rental.py >> /opt/bnb_git/logs/bazaraki_rental.log 2>&1 &
```
Expected: ~17k apartments + ~8k houses for sale, ~7k rentals. Est. ~15-20 min per runner.

**5b. Detail page enrichment — built year, size, amenities**

The map API gives us price + coordinates but not the full property details. For richer ROI analysis we need:
- `size_m2` — key input for price-per-sqm comparisons
- `year_built` — property age affects maintenance cost assumptions and investor decisions
- `amenities` — pool, parking, storage, lift (affects both STR desirability and LTR value)
- `bathrooms`, `district` text, `description`

**Approach:** fetch each listing's HTML detail page (`/adv/<id>/`), parse with BeautifulSoup.
- First run: fetch all new listings (one-off, ~25k requests, run over several hours with delay)
- Subsequent runs: only re-fetch listings where `price_changed IS NOT NULL` or newly seen — watermarked via `details_fetched_at` column
- After first full run: ~50-200 detail fetches/month (new + price-changed only)
- No bot protection on detail pages — confirmed 200 direct from server

**New columns in `bazaraki_sale_latest` / `bazaraki_rental_latest`:**
- `size_m2` FLOAT
- `year_built` INTEGER
- `amenities` VARCHAR (comma-separated or JSON)
- `bathrooms` INTEGER
- `details_fetched_at` TIMESTAMP — watermark, NULL = not yet fetched

**5c. Monthly cron**
Add after first full run confirmed. Sale + rental run independently, monthly schedule (prices change slowly).

---

## 9. Distributed Scraping

Run scraper nodes in parallel across multiple servers — each node owns a subset of cities, writes results to a shared central database. Reduces per-IP request rate, cuts total run time, and is the foundation for scaling to new markets.

### Architecture

```
Node 1 (Hetzner #1)  →  cities: nicosia, nicosia_suburbs, nicosia_east, larnaca, larnaca_south
Node 2 (Hetzner #2)  →  cities: limassol, south_coast, pissouri, troodos
Node 3 (Hetzner #3)  →  cities: paphos, paphos_coast, droushia, polis_latchi, kokkinochoria, ayia_napa
                               ↓
                     Central PostgreSQL DB (shared)
```

Each node runs the same `run.py` / `run_pricing.py` codebase with a different `KNOWN_CITIES` list passed via environment variable or config. All nodes write to the same PostgreSQL instance — concurrent writes are safe since each node owns distinct listing IDs.

### Why this matters even for Cyprus
- 3 nodes × different IPs = Airbnb sees 3 independent clients, not one aggressive one — dramatically reduces 405/429 rate
- Run time drops from ~1 hour to ~20 minutes (cities split across nodes run in parallel)
- Natural foundation for adding Greece: spin up a 4th node with Greek cities, same codebase

### Prerequisites
- PostgreSQL migration (Section 4) must be done first — DuckDB is single-writer, can't support concurrent node writes
- Each node needs its own IP (separate Hetzner servers or floating IPs)

### Cost
3× Hetzner CX22 = ~€13/mo total. Worthwhile at product scale.

---

## 10. Scraper Resilience ✓

### Done ✓
- **Tile retry logic** — tiles retried up to 3 times with 5s wait on failure before skipping
- **Exponential backoff** — 429/502/503 retried with jitter (5s→10s→20s→40s→80s→160s, capped at 300s); already in `_request_with_backoff()` in `airbnb_client.py`
- **403 handling** — with proxy: short 2–5s wait + retry (rotates IP); without proxy: raises immediately (hard ban)
- **Connection: close** header on calendar requests — forces new TCP connection per request → guaranteed IP rotation on each calendar fetch
- **Webshare rotating residential proxies** ✓ — 80M+ IP pool, wired into all three scripts via `WEBSHARE_PROXY_URL` env var in crontab + `/etc/environment`; plan: 10GB/mo (~$27.50)
- **Bandwidth baseline confirmed** — availability run (~12,829 listings) ~141 MB/run; pricing (486 tiles, 56 dates, 0.05° grid) ~1.21 GB/run ✅ observed Apr 2026
- **Proxy cost breakdown** (Webshare 10 GB/mo @ $27.50 = $2.75/GB):
  - Availability: ~141 MB × ~15 runs/mo = ~2.1 GB/mo → ~$5.78/mo
  - Pricing: ~1.21 GB × ~4 runs/mo = ~4.84 GB/mo → ~$13.31/mo
  - Discovery: small (tile searches only, no calendars) — est. <0.5 GB/mo
  - **Total est. ~7.5 GB/mo** — within 10 GB plan but tight; upgrade to 20 GB plan (~$55/mo) before adding new markets or data sources

### Monitoring
- Watch pricing run (Tue 07 Apr) for bandwidth and speed confirmation
- Alert threshold: 5%+ tile failures across a city = investigate proxy or Airbnb detection change

---

## 11. The Pitch

**Data in hand first — never pitch on promises.**

When the time comes, how we frame it matters. We are not "scraping Airbnb". We are building a **market intelligence platform for the short-term rental industry**.

### How to phrase it

> *"We track the entire Cyprus short-term rental market in real time — occupancy rates, pricing trends, booking velocity, and guest sentiment — across every district. Property managers use it to benchmark performance. Investors use it to identify underserved markets. The data goes back 6+ months, updated daily."*

### What to avoid saying
- "We scrape Airbnb" → say "We aggregate publicly available market data"
- "Our dashboard" → say "Our platform" or "our market intelligence tool"
- "We built this ourselves" → say "We've been tracking the market since [date]" — leads with the data, not the tech

### Positioning
- Not a tech product — a **market intelligence service**
- Comparable to CoStar (commercial real estate data) or STR Global (hospitality benchmarking) — both built on aggregated public data
- The data is the product. The dashboard is the delivery mechanism.

---

## What We Are Not Doing Yet

- Building auth or payments until the data and dashboard are solid
- Pitching to customers until 3–6 months of full-market data is in hand
- Over-engineering before validating that people will pay
