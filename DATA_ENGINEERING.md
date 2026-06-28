# PostgreSQL Serving Layer (PropSights)

The serving layer that the PropSights product repo reads from. This repo (Data.Noesis) is data engineering only — it scrapes, computes the gold layer in DuckDB, and publishes pre-aggregated, query-ready tables to PostgreSQL. The product repo (frontend + API) consumes from these tables.

```
Data.Noesis (this repo)                          PropSights repo
┌─────────────────────────────────┐             ┌──────────────────┐
│ scrape → DuckDB → gold           │             │ API + dashboard  │
│        → sync_to_postgres.py ────┼──► Postgres ─┼──► reads tables  │
└─────────────────────────────────┘   (bnb DB)   └──────────────────┘
        OUR JOB ENDS HERE ▲                              ▲ THEIR JOB
                    the database IS the contract
```

**Design principle:** DuckDB does the heavy aggregation at sync time; PostgreSQL stores ~query-ready rows so the dashboard never aggregates raw calendar data at request time. See `schema.sql` for the canonical DDL and `../sync_to_postgres.py` for the population logic.

**Schema ownership:** this repo owns the schema. The product repo should introspect it (`drizzle-kit pull`), never define migrations against it.

---

## What we did (PostgreSQL Phase A — Jun 2026)

1. Installed PostgreSQL + PostGIS on the Hetzner server.
2. Created 7 analytics tables (`db/schema.sql`) — pre-aggregated, not raw mirrors.
3. Built `sync_to_postgres.py` — reads DuckDB, upserts to Postgres (`ON CONFLICT DO UPDATE`, never truncates, so dashboard reads are never blocked).
4. Wired the sync into the pipeline so it auto-publishes after every run:
   - `run_availability.py` (every 48h) → `str_listings`, `str_listings_weekly`, `str_area_weekly`, `sync_meta` (~30s)
   - `run_pricing.py` (weekly) → `pricing_calendar`
   - `run_bazaraki_sale/rental/enrich.py` (1st & 15th) → `sale_listings`, `ltr_listings`
5. Secrets moved to `/opt/bnb_git/.env` (`DATABASE_URL`, `SMTP_PASSWORD`), loaded via `python-dotenv` in each runner.

---

## How to connect

### 1. SSH to the server

```bash
ssh root@204.168.209.175          # Hetzner CX22, Helsinki, Ubuntu 24.04
```

### 2. Connect to the database

```bash
# As the postgres superuser (admin tasks, DDL):
sudo -u postgres psql -d bnb

# As the application user (what the sync + API use):
psql postgresql://bnb:bnb@localhost/bnb
```

| | |
|---|---|
| Host | `localhost` (server-local only — see note) |
| Port | `5432` |
| Database | `bnb` |
| User / password | `bnb` / `bnb` |
| `DATABASE_URL` | `postgresql://bnb:bnb@localhost/bnb` (in `/opt/bnb_git/.env`) |
| Extensions | PostGIS |

> **Remote access:** Postgres currently listens on `localhost` only. The product repo can reach it two ways: (a) run the product API on this same server (localhost works as-is), or (b) open Postgres to the network (`listen_addresses` in `postgresql.conf` + a `pg_hba.conf` rule + firewall). This is an open decision — see Remaining Steps.

### 3. Quick inspection

```bash
sudo -u postgres psql -d bnb -c '\dt'              # list tables
sudo -u postgres psql -d bnb -c '\d str_listings'  # describe a table
sudo -u postgres psql -d bnb -c 'SELECT * FROM sync_meta;'   # data freshness
```

---

## Tables

> Tier column = which product tier may query it (enforced in the product API, not the DB). Full DDL in `schema.sql`.

### `str_listings` — free + paid

One row per active STR listing. Powers the polygon-draw analysis. A free user draws a polygon → `ST_Within(geog, polygon)` → aggregate across matched rows.

| Column | Type | Notes |
|---|---|---|
| `listing_id` | `BIGINT PK` | |
| `name`, `area` | `VARCHAR` | |
| `latitude`, `longitude` | `DOUBLE` | |
| `geog` | `geography(Point,4326)` | GiST-indexed — the polygon query |
| `property_type`, `room_type` | `VARCHAR` | |
| `bedrooms`, `beds`, `size_sqm` | `INTEGER` | |
| `is_superhost`, `is_guest_fav` | `BOOLEAN` | |
| `proximity_beach_min`, `proximity_center_min` | `INTEGER` | |
| `avg_rating`, `review_count` | `DOUBLE / INT` | latest review snapshot |
| `raw_occ_todate` | `NUMERIC(5,1)` | realized, Apr 1 → yesterday, naive |
| `eff_occ_todate` | `NUMERIC(5,1)` | realized, booking-confidence weighted |
| `raw_occ_fwd60` | `NUMERIC(5,1)` | projected, today → +59, naive |
| `eff_occ_fwd60` | `NUMERIC(5,1)` | projected, today → +59, weighted |
| `coverage_days` | `INTEGER` | past days of data this listing has |
| `avg_nightly_rate` | `NUMERIC(10,2)` | avg forward nightly price |
| `bookings_30d`, `total_bookings` | `INTEGER` | velocity / since Apr 1 |
| `last_booking_at` | `TIMESTAMP` | |
| `has_pool … long_term_stays_allowed` | `BOOLEAN ×22` | amenity flags |
| `first_seen`, `last_seen`, `synced_at` | `TIMESTAMP` | |

Indexes: `PK(listing_id)`, `GiST(geog)`, `btree(area)`.

---

### `str_listings_weekly` — paid

One row per listing per ISO week (Monday). Listing-level history for date-range analysis. ~880k rows.

| Column | Type |
|---|---|
| `listing_id`, `week_start` | `BIGINT`, `DATE` — composite PK |
| `raw_occ`, `eff_occ` | `NUMERIC(5,1)` |
| `avg_price` | `NUMERIC(10,2)` |
| `booked_nights`, `covered_nights` | `INTEGER` (covered ≤ 7) |
| `bookings` | `INTEGER` |

Indexes: `PK(listing_id,week_start)`, `btree(week_start)`.

---

### `str_area_weekly` — paid

One row per area per ISO week. Area trends + market comparison. ~1.2k rows.

| Column | Type |
|---|---|
| `area`, `week_start` | `VARCHAR`, `DATE` — composite PK |
| `listing_count` | `INTEGER` |
| `raw_occ`, `eff_occ` | `NUMERIC(5,1)` |
| `avg_adr`, `median_adr` | `NUMERIC(10,2)` |
| `bookings` | `INTEGER` |
| `revenue_estimate` | `NUMERIC(14,2)` — nullable until revenue model |

Index: `PK(area,week_start)`.

---

### `pricing_calendar` — paid

One row per listing per forward date. Pricing dynamics (seasonality, day-of-week). ~300k rows. Synced on the weekly pricing cadence.

| Column | Type |
|---|---|
| `listing_id`, `calendar_date` | `BIGINT`, `DATE` — composite PK |
| `price_per_night` | `NUMERIC(10,2)` |

Indexes: `PK(listing_id,calendar_date)`, `btree(calendar_date)`.

---

### `ltr_listings` — paid

Bazaraki long-term rentals. ~8k rows. `area` is NULL for now (Bazaraki has no district tagging yet — query by `geog`).

| Column | Type |
|---|---|
| `listing_id` | `BIGINT PK` |
| `title` | `VARCHAR` |
| `monthly_rent` | `NUMERIC(10,2)` |
| `area` | `VARCHAR` (currently NULL) |
| `latitude`, `longitude`, `geog` | `DOUBLE / geography` |
| `bedrooms`, `property_type`, `size_m2` | `INT / VARCHAR / REAL` |
| `url`, `first_seen`, `last_seen` | |

Indexes: `PK(listing_id)`, `GiST(geog)`, `btree(area)`.

---

### `sale_listings` — paid

Bazaraki for-sale + ROI signals. ~34k rows. ROI columns nullable until the comp-matching model is built.

| Column | Type |
|---|---|
| `listing_id` | `BIGINT PK` |
| `title`, `price` | `VARCHAR / NUMERIC(12,2)` |
| `area` | `VARCHAR` (currently NULL) |
| `latitude`, `longitude`, `geog` | `DOUBLE / geography` |
| `bedrooms`, `property_type`, `size_m2` | `INT / VARCHAR / REAL` |
| `url` | `VARCHAR` |
| `str_annual_revenue_est`, `str_gross_yield` | `NUMERIC` — nullable |
| `ltr_monthly_rent_est`, `ltr_gross_yield` | `NUMERIC` — nullable |
| `first_seen`, `last_seen` | `TIMESTAMP` |

Indexes: `PK(listing_id)`, `GiST(geog)`, `btree(area)`.

---

### `sync_meta` — single row

Window bounds + data freshness. Read this to label date ranges and show "last updated".

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK` | always `1` |
| `todate_start` | `DATE` | constant `2026-04-01` |
| `todate_end` | `DATE` | last availability run date |
| `fwd_end` | `DATE` | today + 59 |
| `last_run_at`, `synced_at` | `TIMESTAMP` | |

---

## Occupancy model (important for the product team)

Two flavours, both 0–100 with 1 decimal:

- **raw** = unavailable dates ÷ total dates. Counts everything: real bookings, owner blocks, min-stay gaps, stale listings.
- **effective** = Σ booking_confidence ÷ (covered_days − dead_inventory_days). Only real guest bookings — the gold layer strips out blocks/gaps/stale. **This is the meaningful metric.** Effective is always ≤ raw; the gap is the noise.

Two windows:

- **to-date** (`*_todate`): realized, fixed start `2026-04-01` → yesterday. Denominator is per-listing actual coverage (see `coverage_days`), so listings with little history aren't distorted.
- **fwd60** (`*_fwd60`): projected booking pace, today → +59 days.

These match the legacy `_ADJ_OCC_SQL` definition so numbers reconcile across views.

---

## How the tables are populated

`sync_to_postgres.py` runs at the end of each pipeline job (gated on `DATABASE_URL`). Manual run:

```bash
ssh root@204.168.209.175
cd /opt/bnb_git
venv/bin/python3 sync_to_postgres.py --all                 # everything
venv/bin/python3 sync_to_postgres.py --domains str,weekly  # subset
```

Domains: `str`, `weekly`, `area`, `meta`, `pricing`, `ltr`, `sale`. Each runs in its own transaction — one domain failing doesn't roll back the others. Full sync ≈ 37s; the availability subset ≈ 30s.

---

## Remaining steps

These are consumer-side (product repo) — data engineering's job ends at "Postgres is populated".

1. **Build the PropSights API + dashboard** in the product repo. Read from these tables; endpoint shapes follow the screens. Tier gating in API middleware (free = 1 polygon, current-state from `str_listings`; paid = date ranges, comparison, `*_weekly` / `pricing_calendar` / `ltr` / `sale`). Gate by a live `SELECT tier FROM users` per request, not a JWT claim.

2. **Decide where the product API runs** → resolves the remote-access question.
   - On this Hetzner server → localhost Postgres works as-is.
   - Elsewhere → open Postgres to the network (`postgresql.conf listen_addresses`, `pg_hba.conf` rule, firewall) and use a strong password.

3. **Rotate the Gmail app password** (it was committed in git history) and env it in `run_discovery.py` / `run_enrichment.py` (the two runners still holding the literal). The rotated value goes in `/opt/bnb_git/.env` as `SMTP_PASSWORD`.
