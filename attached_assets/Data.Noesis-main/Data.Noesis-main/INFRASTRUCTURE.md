# Infrastructure — Performance & Cost Reference

Live document. Update after each run with observed figures.

**Legend**: ✅ confirmed from observed run | 〜 calculated estimate | ⚠️ needs attention

---

## Infrastructure Overview

| Component | Spec | Cost |
|-----------|------|------|
| **Server** | Hetzner CX22 — 2 vCPU, 4GB RAM, 40GB NVMe, Ubuntu 24.04 (Helsinki) | €4.35/mo |
| **Proxy** | Webshare rotating residential — 80M+ IP pool, `p.webshare.io:80` | $27.50/mo (10GB) |
| **Total** | | ~€4.35 + $27.50/mo |

**Note**: Hetzner's own 20TB/month outbound traffic allowance is irrelevant here — all scraping traffic routes through Webshare proxies, not the server's own IP. Server outbound (SSH, git pulls) is negligible.

---

## Bandwidth Baselines (per request type)

| Request type | Endpoint | KB/request | Source |
|---|---|---|---|
| Calendar fetch | `PdpAvailabilityCalendar` | ~11 KB | ✅ estimated from observed run |
| Tile search — undated | `StaysSearch` (no check_in/out) | ~20.29 KB | ✅ Webshare dashboard |
| Tile search — dated | `StaysSearch` (with check_in/out) | ~24.7 KB | ✅ Webshare dashboard |

---

## Workflow 1 — `run_availability.py`

**Schedule**: every 2 days at 18:45 → ~15 runs/month

**What it does**: fetches 12-month availability calendar for every known listing. Zero tile searches.

| Metric | Value | Source |
|--------|-------|--------|
| Listings fetched | ~12,829 | ✅ confirmed listing count (post Apr 2026 pricing run) |
| Tile searches | 0 | ✅ availability fetches calendars only |
| Calendar requests | ~12,829 | one `get_calendar()` per listing |
| **Bandwidth per run** | ~141 MB | 〜 12,829 × 11 KB |
| **Bandwidth per month** | ~2.1 GB | 〜 15 runs × 141 MB |
| Parallel workers | 4 (`CALENDAR_WORKERS`) | |
| Estimated run time | ~1.5–2 hours | 〜 12,734 listings / 4 workers × ~1.5s/request |
| Peak RAM | ~200 MB Python + up to 1.5 GB DuckDB (gold update) | |
| DB tables written | `availability_log`, `availability_latest`, `bookings`, `gold` | |

**After availability**: triggers `update_silver()` + `update_gold()`. Gold's first full run took ~5 hours; subsequent incremental runs ~30 min.

---

## Workflow 2 — `run_pricing.py`

**Schedule**: weekly Tuesdays at 04:00 → 4 runs/month

**What it does**: dated tile search (check_in / check_out +3 nights) for 56 sample dates (28 weeks × Tue + Fri). Captures nightly price per listing per date.

| Metric | Value | Source |
|--------|-------|--------|
| Sample dates | 56 (28 weeks × Tue + Fri) | |
| Tiles per date | **526** | 〜 0.05° grid step (~5.6 km × 4.5 km tiles) |
| Total tile requests per run | **29,456** | 56 × 526 |
| KB per request | 24.7 KB | ✅ |
| **Bandwidth per run** | **~1.3 GB** | ✅ confirmed Apr 2026 |
| **Bandwidth per month** | **~5.2 GB** | 〜 4 runs × 1.3 GB |
| Parallel workers | 5 (`DATE_WORKERS`) | |
| Estimated run time | ~3–3.5 hours | 〜 ceil(56/5) = 12 rounds × 526 tiles × 1.8s |
| DB tables written | `pricing_bronze`, `pricing_silver` | |

**Grid**: `PRICING_GRID_STEP = 0.05°` — coarser than discovery. Each tile ~25 km². New listing IDs discovered here are written to the `listings` table, replacing the need for a dedicated discovery run.

**Coverage**: 7,788 / 12,829 listings captured in `pricing_silver` after first run = **~61%**. Dense tiles hit Airbnb's ~280 result cap. Sufficient for area-level pricing analysis — sample is geographically representative.

---

## Workflow 3 — `run_enrichment.py`

**Schedule**: every Wednesday at 06:00 → 4 runs/month (runs ~2 hours after pricing completes)

**What it does**: fetches listing detail page for all listings where `description IS NULL` — covers new listings discovered by the pricing run and any that returned no description on a prior attempt. Writes amenities, ratings, superhost/verified status, description, and parsed description attributes.

| Metric | Value | Source |
|--------|-------|--------|
| Listings per run | new listings only (description IS NULL) | typically small after bulk run completes |
| KB per request | ~96 KB | ✅ observed Apr 2026 |
| **Bandwidth per run** | negligible (few hundred new listings/week) | 〜 |
| Delay between requests | 1s | |
| DB tables written | `listings` (amenities, ratings, description, parsed attrs) | |

**Note**: bulk one-off enrichment (`run_enrichment.py limit=None`) ran Apr 2026 to backfill all 13,151 existing listings (~1.23 GB one-off cost). Ongoing cron runs are lightweight.

---

## Workflow 4 — `run_bazaraki_sale.py`

**Schedule**: every Sunday at 22:00 → 4 runs/month

**What it does**: scrapes all for-sale property listings (apartments + houses) island-wide from bazaraki.com's geometry API. No TLS fingerprinting required — clean JSON GET requests.

| Metric | Value | Source |
|--------|-------|--------|
| Rubrics scraped | 2 (`apartments_sale` ~15,900 listings, `houses_sale` ~8,423) | ✅ rubric counts from API |
| Total listings | ~24,300 | 〜 |
| Pages (est. ~100 items/page) | ~245 pages | 〜 |
| KB per page | ~10 KB (compact JSON geometry) | 〜 |
| **Bandwidth per run** | **~2.5 MB** | 〜 negligible |
| **Bandwidth per month** | **~10 MB** | 〜 4 runs/month |
| Request delay | 0.5s between pages | |
| Estimated run time | ~2–3 min | 〜 |
| DB tables written | `bazaraki_sale_log`, `bazaraki_sale_latest` | |

---

## Workflow 5 — `run_bazaraki_rental.py`

**Schedule**: every Monday at 22:00 → 4 runs/month

**What it does**: scrapes all long-term rental listings (apartments + houses) island-wide from bazaraki.com's geometry API.

| Metric | Value | Source |
|--------|-------|--------|
| Rubrics scraped | 2 (`apartments_rent` ~5,200 listings, `houses_rent` ~1,500) | ✅ rubric counts from API |
| Total listings | ~6,700 | 〜 |
| Pages (est. ~100 items/page) | ~70 pages | 〜 |
| KB per page | ~10 KB | 〜 |
| **Bandwidth per run** | **~0.7 MB** | 〜 negligible |
| **Bandwidth per month** | **~2.8 MB** | 〜 4 runs/month |
| Request delay | 0.5s between pages | |
| Estimated run time | <1 min | 〜 |
| DB tables written | `bazaraki_rental_log`, `bazaraki_rental_latest` | |

---

## Workflow 6 — `run_bazaraki_enrich.py`

**Schedule**: Sun 23:30 (`--type sale`) + Mon 23:30 (`--type rental`) → 8 runs/month

**What it does**: fetches Bazaraki detail pages for listings where `details_fetched_at IS NULL`. Extracts size_m2, floor, parking, condition, furnishing, included, air_conditioning, construction_year, energy_efficiency, bathrooms, postal_code, description. Runs independently per type right after its corresponding scrape.

| Metric | Value | Source |
|--------|-------|--------|
| Listings per run | new listings only (details_fetched_at IS NULL) | typically small after bulk run |
| KB per request | ~10–20 KB (HTML detail page) | 〜 |
| **Bandwidth per run** | negligible ongoing | 〜 |
| Request delay | 1s between requests | |
| DB tables written | `bazaraki_sale_latest` (Sun) / `bazaraki_rental_latest` (Mon) | |

**Note**: bulk one-off enrichment ran Apr 2026 to backfill all ~31k listings. Ongoing runs are lightweight (new listings from weekly scrape only).

---

## Monthly Summary (current state)

| Workflow | Runs/month | Bandwidth/month | Status |
|----------|-----------|-----------------|--------|
| `run_availability.py` | 15 | ~2.1 GB | ✅ running |
| `run_pricing.py` | 4 | **~5.2 GB** | ✅ running |
| `run_enrichment.py` | 4 | negligible | ✅ running (Wed 06:00) |
| `run_bazaraki_sale.py` | 4 | ~10 MB | ✅ running (Sun 22:00) |
| `run_bazaraki_enrich.py --type sale` | 4 | negligible | ✅ running (Sun 23:30) |
| `run_bazaraki_rental.py` | 4 | ~2.8 MB | ✅ running (Mon 22:00) |
| `run_bazaraki_enrich.py --type rental` | 4 | negligible | ✅ running (Mon 23:30) |
| ~~`run_discovery.py`~~ | ~~removed~~ | — | ❌ retired Apr 2026 |
| **Total** | | **~7.3 GB** | ✅ within 10GB plan |

---

## Cron Schedule Overview

| Day | Time | Job | Purpose |
|-----|------|-----|---------|
| Every 2 days | 18:45 | `run_availability.py` | 12-month calendar for all ~13k listings |
| Tuesday | 04:00 | `run_pricing.py` | Nightly price sampling, 56 dates |
| Wednesday | 06:00 | `run_enrichment.py` | Airbnb detail enrichment for new listings |
| Sunday | 22:00 | `run_bazaraki_sale.py` | ~24k for-sale listings |
| Sunday | 23:30 | `run_bazaraki_enrich.py --type sale` | Detail pages for new sale listings |
| Monday | 22:00 | `run_bazaraki_rental.py` | ~7k rental listings |
| Monday | 23:30 | `run_bazaraki_enrich.py --type rental` | Detail pages for new rental listings |

---

## Server Resource Usage

| Resource | Normal (idle) | During availability run | During gold (first run) |
|----------|--------------|------------------------|------------------------|
| CPU | <5% | 30–50% (4 threads) | 20–40% |
| RAM | ~500 MB | ~800 MB | up to 3.6 GB (DuckDB capped at 1.5 GB + Python) |
| Disk (DB) | grows ~137 MB/run (availability_log) | | |
| Run overlap risk | ⚠️ DuckDB single-writer lock — cron jobs must not overlap |

**OOM history**: gold update OOM-killed once (Apr 2026) when loading 4.5M silver rows into Python. Fixed by microbatch rewrite (BATCH_SIZE=200, DuckDB memory_limit=1.5GB).

---

## Action Items

| Priority | Item |
|----------|------|
| ✅ Done | Fixed `run_pricing.py` tile grid — `PRICING_GRID_STEP=0.05°`, 526 tiles (was 2,966) |
| ✅ Done | Upgraded Webshare to 10GB ($27.50/mo) |
| ✅ Done | Retired `run_discovery.py` — new listings covered by pricing run + Wednesday enrichment |
| ✅ Done | Bulk enrichment backfill — 13,151 listings enriched Apr 2026 |
| 🟡 Medium | Confirm actual availability run duration (currently estimated) |
| 🟢 Low | Monitor gold incremental run time after availability (should be <30 min) |
