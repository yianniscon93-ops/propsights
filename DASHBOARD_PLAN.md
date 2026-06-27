# PropSights Live Dashboard — Build Plan

## Overview

A live, filterable map dashboard showing Cyprus short-term rental
market data, backed by PostgreSQL, served by the existing Express API
server, and rendered in the existing React landing site.

**Stack already in place:**
- Database: Replit PostgreSQL (provision with one click in the Database tab)
- ORM: Drizzle ORM — already in `pnpm-workspace.yaml` catalog
- API: Express 5 + TypeScript — `artifacts/api-server`
- Frontend: React 19 + Vite + react-leaflet — `artifacts/landing`
- Shared DB package: `lib/db` (to be created — referenced as `@workspace/db`)

---

## Phase 1 — Database & Schema

### 1.1 Provision PostgreSQL

In Replit, open the **Database** tab in the left sidebar and click
**Create database**. Replit injects `DATABASE_URL` automatically as an
environment variable — no manual config needed.

### 1.2 Create `lib/db` shared package

Create the following file tree:

```
lib/db/
  package.json
  tsconfig.json
  src/
    index.ts        ← exports client + schema
    client.ts       ← Drizzle + postgres connection
    schema/
      areas.ts
      listings.ts
      metrics.ts
```

**`lib/db/package.json`**
```json
{
  "name": "@workspace/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

**`lib/db/src/client.ts`**
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

### 1.3 Schema

Design these three tables to match your data points:

**`lib/db/src/schema/areas.ts`** — one row per city/district
```ts
import { pgTable, serial, text, real } from "drizzle-orm/pg-core";

export const areas = pgTable("areas", {
  id:        serial("id").primaryKey(),
  slug:      text("slug").notNull().unique(),   // e.g. "limassol"
  name:      text("name").notNull(),             // e.g. "Limassol"
  lat:       real("lat").notNull(),
  lng:       real("lng").notNull(),
  region:    text("region"),                     // e.g. "Coast", "Mountain"
});
```

**`lib/db/src/schema/listings.ts`** — one row per rental property
```ts
import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { areas } from "./areas.js";

export const listings = pgTable("listings", {
  id:          serial("id").primaryKey(),
  externalId:  text("external_id").unique(),     // your source ID
  areaId:      integer("area_id").references(() => areas.id),
  lat:         real("lat").notNull(),
  lng:         real("lng").notNull(),
  propertyType: text("property_type"),           // "apartment" | "villa" | "studio"
  bedrooms:    integer("bedrooms"),
  rating:      real("rating"),
  reviewCount: integer("review_count"),
  nightlyRate: real("nightly_rate"),             // EUR
  occupancy:   real("occupancy"),                // 0–100
  updatedAt:   timestamp("updated_at").defaultNow(),
});
```

**`lib/db/src/schema/metrics.ts`** — aggregated stats per area per month
```ts
import { pgTable, serial, integer, real, date } from "drizzle-orm/pg-core";
import { areas } from "./areas.js";

export const metrics = pgTable("metrics", {
  id:           serial("id").primaryKey(),
  areaId:       integer("area_id").references(() => areas.id),
  month:        date("month").notNull(),         // first day of month: 2025-07-01
  avgOccupancy: real("avg_occupancy"),           // %
  medianAdr:    real("median_adr"),              // EUR nightly
  estMonthly:   real("est_monthly"),             // EUR/month
  listingCount: integer("listing_count"),
});
```

Adjust column names/types to match your actual data points.

### 1.4 Migrations

Install `drizzle-kit` and run migrations:

```bash
pnpm add -D drizzle-kit --filter @workspace/db
```

Add to `lib/db/package.json` scripts:
```json
"scripts": {
  "migrate": "drizzle-kit push",
  "studio":  "drizzle-kit studio"
}
```

Add `drizzle.config.ts` in `lib/db/`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/schema/index.ts",
  out:    "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Run: `pnpm --filter @workspace/db run migrate`

---

## Phase 2 — Data Import

Write a one-time import script at `scripts/import-data.ts`:

```ts
import { db } from "@workspace/db";
import { areas, listings, metrics } from "@workspace/db/schema";

// Load your data (CSV, JSON, API, etc.)
// Example for areas:
await db.insert(areas).values([
  { slug: "limassol", name: "Limassol", lat: 34.6786, lng: 33.0413 },
  // ... all areas
]).onConflictDoNothing();

// Insert listings in batches of 500
const BATCH = 500;
for (let i = 0; i < yourListings.length; i += BATCH) {
  await db.insert(listings).values(yourListings.slice(i, i + BATCH))
    .onConflictDoUpdate({ target: listings.externalId, set: { updatedAt: new Date() } });
}

// Insert metrics
await db.insert(metrics).values(yourMetrics).onConflictDoNothing();
```

Run: `pnpm tsx scripts/import-data.ts`

---

## Phase 3 — API Endpoints

Add these routes in `artifacts/api-server/src/routes/`:

### `GET /api/areas`
Returns all areas with their latest aggregated stats. Used to populate
the map markers and the filter dropdown.

```ts
// Query: join areas + latest metrics row per area
const result = await db
  .select({ ...areas, ...metrics })
  .from(areas)
  .leftJoin(metrics, eq(metrics.areaId, areas.id))
  .orderBy(desc(metrics.month));

// Deduplicate to latest month per area, return as JSON
```

Response shape:
```json
[{
  "id": 1, "slug": "limassol", "name": "Limassol",
  "lat": 34.6786, "lng": 33.0413,
  "avgOccupancy": 74, "medianAdr": 142,
  "estMonthly": 3210, "listingCount": 521
}]
```

### `GET /api/listings`
Returns individual listings filtered by query params. Used for the
detail panel when a user clicks a map area.

Query params:
- `areaId` — filter by area
- `propertyType` — "apartment" | "villa" | "studio"
- `minBedrooms`, `maxBedrooms`
- `minRate`, `maxRate`
- `minOccupancy`

```ts
// Build dynamic WHERE clause using Drizzle's and() + eq() + gte() + lte()
// LIMIT 200 — don't return unbounded results
```

### `GET /api/metrics/seasonality?areaId=1`
Returns month-by-month occupancy + ADR for the chart.

```ts
// SELECT * FROM metrics WHERE area_id = $1 ORDER BY month ASC
```

### `GET /api/dashboard/summary`
Top-level numbers for the page header: total listings, avg occupancy,
highest-ADR area, etc.

---

## Phase 4 — Dashboard Page (Frontend)

Add a `/dashboard` route to the landing site.

### 4.1 New page file

`artifacts/landing/src/pages/Dashboard.tsx`

Layout:
```
┌─────────────────────────────────────────────────┐
│  Nav (existing)                                 │
├──────────────────┬──────────────────────────────┤
│  Sidebar         │  Map (react-leaflet)          │
│  ─ Filters       │  ─ Circle markers per area    │
│  ─ Area list     │    sized by listing count     │
│  ─ Selected      │    colored by occupancy %     │
│    area detail   │  ─ Click → select area        │
│                  │  ─ Optional: neighbourhood    │
│                  │    heatmap overlay            │
└──────────────────┴──────────────────────────────┘
│  Bottom: seasonality chart for selected area    │
└─────────────────────────────────────────────────┘
```

### 4.2 Data fetching

Use `@tanstack/react-query` (already in the workspace catalog):

```ts
// Fetch all areas on mount
const { data: areas } = useQuery({
  queryKey: ["areas"],
  queryFn: () => fetch(`${BASE_URL}api/areas`).then(r => r.json()),
});

// Fetch listings when area selected
const { data: listings } = useQuery({
  queryKey: ["listings", selectedAreaId, filters],
  queryFn: () => fetch(`${BASE_URL}api/listings?areaId=${selectedAreaId}&...`).then(r => r.json()),
  enabled: !!selectedAreaId,
});
```

### 4.3 Map markers

Use `react-leaflet` `CircleMarker` for each area:

```tsx
{areas.map(area => (
  <CircleMarker
    key={area.id}
    center={[area.lat, area.lng]}
    radius={Math.sqrt(area.listingCount) * 1.5}   // size = listing volume
    fillColor={occupancyColor(area.avgOccupancy)}   // green scale
    fillOpacity={0.75}
    stroke={selectedArea?.id === area.id}
    eventHandlers={{ click: () => setSelectedArea(area) }}
  />
))}
```

`occupancyColor` helper: map 0–100% onto a green gradient
(`#D0D9C6` → `#4A5E3A`).

### 4.4 Filters (sidebar)

- **Property type** — checkbox group: Apartment / Villa / Studio / All
- **Bedrooms** — range slider: 1–5+
- **Nightly rate** — range slider: €0–€500
- **Min occupancy** — single slider: 0–100%
- **Sort by** — Occupancy / ADR / Revenue / Listings

All filters update the `/api/listings` query params reactively via
React Query's `queryKey`.

### 4.5 Seasonality chart

Use the existing SVG area-chart pattern from `HeroSequence.tsx`
(already built) or swap in Recharts:

```bash
pnpm add recharts --filter @workspace/landing
```

```tsx
<AreaChart data={seasonalityData}>
  <XAxis dataKey="month" />
  <YAxis />
  <Area dataKey="avgOccupancy" fill="#4A5E3A" stroke="#4A5E3A" />
</AreaChart>
```

### 4.6 Wire up the route

In `artifacts/landing/src/App.tsx`, add:
```tsx
import Dashboard from "./pages/Dashboard";
// ...
<Route path="/dashboard" component={Dashboard} />
```

Add a "Dashboard" link in the Nav (or gate it behind a login later).

---

## Phase 5 — Polish & Performance

### Caching
Add a simple in-memory cache on the API for the `/areas` endpoint
(data only refreshes every 48h anyway):

```ts
let cache: { data: unknown; at: number } | null = null;
const TTL = 60 * 60 * 1000; // 1 hour
if (cache && Date.now() - cache.at < TTL) return res.json(cache.data);
// ... query DB ... cache = { data: result, at: Date.now() };
```

### Spatial queries (optional, if you have neighbourhood polygons)
Enable PostGIS on your Replit Postgres instance:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```
Then add a `geom` column to `listings` and use bounding-box queries
to only return listings visible in the current map viewport:
```sql
WHERE ST_Within(geom, ST_MakeEnvelope($minLng,$minLat,$maxLng,$maxLat,4326))
```

### Map clustering (if >500 markers)
Use `react-leaflet-cluster` to group dense markers at low zoom levels:
```bash
pnpm add react-leaflet-cluster --filter @workspace/landing
```

---

## File Summary

```
lib/db/
  package.json
  tsconfig.json
  drizzle.config.ts
  src/
    index.ts
    client.ts
    schema/
      areas.ts
      listings.ts
      metrics.ts
      index.ts

scripts/
  import-data.ts

artifacts/api-server/src/routes/
  areas.ts        ← GET /api/areas
  listings.ts     ← GET /api/listings
  metrics.ts      ← GET /api/metrics/seasonality
  dashboard.ts    ← GET /api/dashboard/summary

artifacts/landing/src/
  pages/
    Dashboard.tsx
  components/
    dashboard/
      FilterSidebar.tsx
      AreaMarkers.tsx
      AreaDetail.tsx
      SeasonalityChart.tsx
```

---

## Order of operations

1. Provision Replit PostgreSQL (Database tab → Create)
2. Create `lib/db` package + schema
3. Run `pnpm --filter @workspace/db run migrate`
4. Import your data via `scripts/import-data.ts`
5. Add API routes and test with `curl`
6. Build the Dashboard page with hardcoded `areaId` first, verify map + chart
7. Add filters and wire them to the API
8. Style to match PropSights brand (olive `#4A5E3A`, cream `#F2F5EE`)

---

## Notes for Claude Code

- The monorepo uses **pnpm workspaces**. Always use
  `pnpm add <pkg> --filter @workspace/<name>` to add dependencies.
- The API server is **ESM** (`"type": "module"`). Use `.js` extensions
  in import paths even for `.ts` files.
- The `BASE_URL` env var in the frontend (from `import.meta.env.BASE_URL`)
  already includes a trailing slash — prepend it to all API calls:
  `fetch(`${BASE_URL}api/areas`)`.
- `@tanstack/react-query` and `drizzle-orm` are already in the
  workspace catalog — no version needed when installing.
- Do **not** mention Airbnb, Bazaraki, or "Data.Noesis" anywhere in
  user-visible copy.
