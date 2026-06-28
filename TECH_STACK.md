# PropSights — Technology & Methodology Reference

> Written 28 June 2026. Intended to align the data engineering repo on integration points and next steps.

---

## Repository Layout

pnpm workspace monorepo (Node 24, TypeScript 5.9).

```
propsights/
  artifacts/
    landing/          ← React 19 + Vite  (public marketing + dashboard UI)
    api-server/       ← Express 5 + TypeScript  (REST API, port 5000 dev / 8080 prod)
    mockup-sandbox/   ← Replit preview only, not user-facing
  lib/
    db/               ← Drizzle ORM + postgres-js  (shared DB client + schema)
    api-spec/         ← OpenAPI 3 YAML  (single source of truth for all API contracts)
    api-client-react/ ← React Query hooks (auto-generated from api-spec via Orval)
    api-zod/          ← Zod schemas (auto-generated from api-spec via Orval)
  scripts/            ← one-off data import scripts (TypeScript, run with tsx)
```

---

## Frontend

| Concern | Technology |
|---|---|
| Framework | React 19 |
| Build tool | Vite |
| Routing | React Router (file-based, `/dashboard` target) |
| Data fetching | TanStack React Query v5 |
| Map | react-leaflet + Leaflet (CircleMarker per area, optional clustering via react-leaflet-cluster) |
| Charts | Recharts (AreaChart for seasonality) |
| UI components | shadcn/ui |
| Styling | Tailwind CSS (brand palette: olive `#4A5E3A`, cream `#F2F5EE`) |

### Dashboard page structure (planned)

```
/dashboard
  ├── FilterSidebar   — property type, bedrooms, nightly rate, occupancy sliders
  ├── Map             — CircleMarkers sized by listing count, coloured by occupancy %
  ├── AreaDetail      — stats for selected area
  └── SeasonalityChart — month-by-month occupancy + ADR for selected area
```

All filters drive React Query `queryKey` changes → reactive re-fetches from the API.

---

## Backend (API Server)

| Concern | Technology |
|---|---|
| Runtime | Node 24, ESM (`"type": "module"`) |
| Framework | Express 5 + TypeScript |
| Port | 5000 (dev) / 8080 (prod) |
| ORM | Drizzle ORM (type-safe, no codegen step for queries) |
| Database driver | postgres-js |
| API contract | OpenAPI 3 YAML in `lib/api-spec/openapi.yaml` |
| Hook codegen | Orval → generates React Query hooks + Zod validators from the spec |

### Planned API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/areas` | All areas with latest aggregated metrics |
| GET | `/api/listings` | Individual listings, filterable by area / type / bedrooms / rate / occupancy |
| GET | `/api/metrics/seasonality?areaId=` | Monthly occupancy + ADR time-series |
| GET | `/api/dashboard/summary` | Top-level KPIs (total listings, avg occupancy, highest-ADR area) |

Simple in-memory cache on `/api/areas` (1-hour TTL) — data only refreshes every 48 h.

Optional: PostGIS bounding-box queries if neighbourhood polygon data becomes available.

---

## Database

| Concern | Technology |
|---|---|
| Engine | PostgreSQL (Replit-hosted, injected as `DATABASE_URL`) |
| ORM / migrations | Drizzle ORM + `drizzle-kit push` |
| Optional extension | PostGIS (spatial queries) |

### Schema (3 tables)

**`areas`** — one row per city/district  
`id`, `slug`, `name`, `lat`, `lng`, `region`

**`listings`** — one row per STR property  
`id`, `external_id`, `area_id`, `lat`, `lng`, `property_type`, `bedrooms`, `rating`, `review_count`, `nightly_rate`, `occupancy`, `updated_at`

**`metrics`** — aggregated stats per area per month  
`id`, `area_id`, `month` (first day of month), `avg_occupancy`, `median_adr`, `est_monthly`, `listing_count`

---

## Data Ingestion

- One-off import script: `scripts/import-data.ts` (run with `pnpm tsx`)
- Accepts CSV / JSON / API as source
- Batch inserts of 500 rows; upsert on `external_id` for listings
- **This is the main integration point with the data engineering pipeline** — see "Next Steps" below

---

## API Contract Workflow

```
lib/api-spec/openapi.yaml   ← define new endpoints here first
        ↓  pnpm --filter @workspace/api-spec run codegen
lib/api-client-react/       ← React Query hooks (auto-generated)
lib/api-zod/                ← Zod validators (auto-generated)
```

Any new endpoint added to the API server must be spec-first: update the YAML, run codegen, then implement the route.

---

## Deployment

- Hosted on **Vercel** (auto-deploy on push to `main`)
- Environment variable `DATABASE_URL` injected at build/runtime
- Frontend `BASE_URL` (from `import.meta.env.BASE_URL`) always has a trailing slash — API calls use `` `${BASE_URL}api/...` ``

---

## Next Steps / Open Questions for Data Engineering

1. **Data format for import** — what format will the pipeline output? (CSV, JSON, Parquet?) The import script at `scripts/import-data.ts` needs to be wired to whatever the pipeline produces.

2. **Refresh cadence** — the API cache TTL is 1 hour; DB data is assumed to refresh every ~48 h. Is the pipeline a scheduled batch job or near-real-time? This affects whether we need a webhook/trigger to invalidate the cache or if polling is fine.

3. **Schema alignment** — the `listings` table expects these fields from the pipeline:
   - `external_id` (string, unique per property)
   - `lat`, `lng` (float)
   - `property_type` (apartment / villa / studio)
   - `bedrooms` (int)
   - `rating`, `review_count`
   - `nightly_rate` (EUR)
   - `occupancy` (0–100 float)

   The `metrics` table expects pre-aggregated monthly stats per area. Does the pipeline output raw listings only, or also aggregated metrics? If raw only, we can aggregate in SQL on the API side.

4. **Area/district mapping** — listings need an `area_id` FK. Does the pipeline already tag listings with a district/city slug, or do we need to do a spatial join (lat/lng → area) on import?

5. **PostGIS** — if the pipeline can provide neighbourhood polygon GeoJSON, enabling PostGIS on the Postgres instance unlocks viewport-bounded map queries. Worth discussing if that data is available.
