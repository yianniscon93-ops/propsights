import type postgres from "postgres";
import { getSql } from "./db";
import { demo } from "./demoData";
import type {
  AmenityPremium,
  AreaInfo,
  AreaType,
  BenchmarkSeries,
  DashboardSummary,
  InvestStats,
  ListingDetail,
  MarketRequest,
  MarketResponse,
  MarketSnapshot,
  PointRow,
  PolygonCoords,
  PricingData,
  RentalStats,
  SelectionStats,
  WeeklyPoint,
  WeeklyRow,
} from "@/lib/dashboard/types";
import type { Filters } from "@/lib/dashboard/filters";
import { AMENITIES } from "@/lib/dashboard/filters";
import { TYPE_GROUP_WORDS, type TypeGroup } from "@/lib/dashboard/format";

/**
 * Data access for the dashboard. Every function tries the live serving
 * layer (schema owned by data engineering, read-only) and falls back to
 * the deterministic demo dataset when DATABASE_URL is unset or a query
 * fails. Occupancy semantics: eff_* = effective (real bookings only);
 * raw_* includes owner blocks / gaps / stale calendars.
 */

type Sql = ReturnType<typeof postgres>;
type Frag = postgres.PendingQuery<postgres.Row[]>;

async function tryLive<T>(fn: (sql: Sql) => Promise<T>, fallback: () => T, label: string): Promise<T> {
  const sql = getSql();
  if (!sql) return fallback();
  try {
    return await fn(sql);
  } catch (err) {
    console.warn(`[dashboard] live query failed (${label}), serving demo data:`, err);
    return fallback();
  }
}

const AMENITY_KEYS = new Set(AMENITIES.map((a) => a.key));

function orJoin(sql: Sql, frags: Frag[]): Frag {
  return frags.reduce((a, b) => sql`${a} OR ${b}`);
}

function typeGroupCond(sql: Sql, group: TypeGroup): Frag {
  const words = (g: Exclude<TypeGroup, "other">) =>
    TYPE_GROUP_WORDS[g].map((w) => sql`property_type ILIKE ${"%" + w + "%"}`);
  if (group === "other") {
    const all = (Object.keys(TYPE_GROUP_WORDS) as Array<Exclude<TypeGroup, "other">>).flatMap(words);
    return sql`NOT (${orJoin(sql, all)})`;
  }
  return sql`(${orJoin(sql, words(group))})`;
}

/** Build the WHERE clause for str_listings from filters + optional polygon.
 * Contract golden rule: only active listings, ever. */
function buildWhere(sql: Sql, f: Filters, polygon: PolygonCoords | null): Frag {
  const conds: Frag[] = [sql`is_active IS TRUE`];
  if (f.areas.length) conds.push(sql`area IN ${sql(f.areas)}`);
  if (f.types.length) conds.push(sql`(${orJoin(sql, f.types.map((g) => typeGroupCond(sql, g)))})`);
  if (f.minBeds > 0) conds.push(sql`bedrooms >= ${f.minBeds}`);
  if (f.priceMin != null) conds.push(sql`avg_nightly_rate >= ${f.priceMin}`);
  if (f.priceMax != null) conds.push(sql`avg_nightly_rate <= ${f.priceMax}`);
  if (f.superhost) conds.push(sql`is_superhost = TRUE`);
  if (f.guestFav) conds.push(sql`is_guest_fav = TRUE`);
  if (f.entireOnly) conds.push(sql`room_type = 'Entire place'`);
  if (f.minRating != null) conds.push(sql`avg_rating >= ${f.minRating}`);
  if (f.beachMax != null) conds.push(sql`proximity_beach_min <= ${f.beachMax}`);
  for (const a of f.amenities) {
    if (AMENITY_KEYS.has(a)) conds.push(sql`${sql(a)} = TRUE`);
  }
  if (polygon) conds.push(sql`ST_Covers(ST_GeogFromText(${polygonWkt(polygon)}), geog)`);
  return conds.length ? conds.reduce((a, c) => sql`${a} AND ${c}`) : sql`TRUE`;
}

/** Closed WKT ring from [lat, lng] vertices (validated by the route). */
function polygonWkt(polygon: PolygonCoords): string {
  const pts = polygon.map(([lat, lng]) => `${lng.toFixed(6)} ${lat.toFixed(6)}`);
  pts.push(pts[0]);
  return `POLYGON((${pts.join(",")}))`;
}

const TYPE_MIX_CASE = (sql: Sql): Frag => {
  const like = (g: Exclude<TypeGroup, "other">) =>
    orJoin(sql, TYPE_GROUP_WORDS[g].map((w) => sql`property_type ILIKE ${"%" + w + "%"}`));
  return sql`CASE
    WHEN ${like("apartment")} THEN 'apartment'
    WHEN ${like("house")} THEN 'house'
    WHEN ${like("hotel")} THEN 'hotel'
    ELSE 'other' END`;
};

const DETAIL_COLUMNS = (sql: Sql): Frag => sql`
  listing_id::text AS id, name, area AS area_slug, area_label,
  latitude::float AS lat, longitude::float AS lng,
  property_type, room_type, bedrooms, beds, size_sqm,
  avg_rating::float AS rating, review_count,
  avg_nightly_rate::float AS nightly_rate,
  is_superhost, is_guest_fav,
  eff_occ_todate::float, eff_occ_fwd60::float,
  raw_occ_todate::float, raw_occ_fwd60::float,
  bookings_30d, total_bookings,
  proximity_beach_min, proximity_center_min,
  airbnb_url,
  ${sql.unsafe(AMENITIES.map((a) => a.key).join(", "))}`;

function rowToDetail(r: postgres.Row): ListingDetail {
  return {
    id: r.id,
    name: r.name ?? "Listing",
    areaSlug: r.area_slug ?? "",
    areaLabel: r.area_label ?? null,
    lat: r.lat,
    lng: r.lng,
    propertyType: r.property_type,
    roomType: r.room_type,
    bedrooms: r.bedrooms,
    beds: r.beds,
    sizeSqm: r.size_sqm,
    rating: r.rating,
    reviewCount: r.review_count,
    nightlyRate: r.nightly_rate,
    isSuperhost: !!r.is_superhost,
    isGuestFav: !!r.is_guest_fav,
    effOccTodate: r.eff_occ_todate,
    effOccFwd60: r.eff_occ_fwd60,
    rawOccTodate: r.raw_occ_todate,
    rawOccFwd60: r.raw_occ_fwd60,
    bookings30d: r.bookings_30d,
    totalBookings: r.total_bookings,
    proximityBeachMin: r.proximity_beach_min,
    proximityCenterMin: r.proximity_center_min,
    airbnbUrl: r.airbnb_url ?? null,
    amenities: AMENITIES.filter((a) => r[a.key] === true).map((a) => a.key),
  };
}

export function getSummary(): Promise<DashboardSummary> {
  return tryLive<DashboardSummary>(
    async (sql) => {
      const [meta] = await sql`
        SELECT todate_start::text, todate_end::text, fwd_end::text, last_run_at
        FROM sync_meta WHERE id = 1
      `;
      const areas = await sql`
        SELECT area AS slug, COUNT(*)::int AS count,
               AVG(latitude)::float AS lat, AVG(longitude)::float AS lng
        FROM str_listings WHERE area IS NOT NULL AND is_active IS TRUE
        GROUP BY area ORDER BY count DESC
      `;
      const [tot] = await sql`SELECT COUNT(*)::int AS n FROM str_listings WHERE is_active IS TRUE`;
      return {
        source: "live" as const,
        totalListings: tot.n,
        areas: areas.map((a) => ({ slug: a.slug, count: a.count, lat: a.lat, lng: a.lng })),
        todateStart: meta?.todate_start ?? "",
        todateEnd: meta?.todate_end ?? "",
        fwdEnd: meta?.fwd_end ?? "",
        lastRunAt: meta?.last_run_at ? new Date(meta.last_run_at).toISOString() : null,
      };
    },
    demo.summary,
    "summary"
  );
}

export function getPoints(f: Filters): Promise<PointRow[]> {
  return tryLive<PointRow[]>(
    async (sql) => {
      const rows = await sql`
        SELECT
          listing_id::text AS id,
          latitude::float AS lat, longitude::float AS lng,
          eff_occ_todate::float, eff_occ_fwd60::float,
          raw_occ_todate::float, raw_occ_fwd60::float
        FROM str_listings
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND (${buildWhere(sql, f, null)})
      `;
      return rows.map((r) => ({
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        effOccTodate: r.eff_occ_todate,
        effOccFwd60: r.eff_occ_fwd60,
        rawOccTodate: r.raw_occ_todate,
        rawOccFwd60: r.raw_occ_fwd60,
      }));
    },
    () => demo.points(f),
    "points"
  );
}

export function getListing(id: string): Promise<ListingDetail | null> {
  return tryLive<ListingDetail | null>(
    async (sql) => {
      const rows = await sql`
        SELECT ${DETAIL_COLUMNS(sql)} FROM str_listings WHERE listing_id = ${id}
      `;
      return rows.length ? rowToDetail(rows[0]) : null;
    },
    () => demo.listing(id),
    "listing"
  );
}

export function getPricing(
  f: Filters,
  polygon: PolygonCoords | null,
  areaId?: string | null
): Promise<PricingData> {
  return tryLive<PricingData>(
    async (sql) => {
      let where = buildWhere(sql, f, polygon);
      // Named-area scope via the listings name column (quarter/parish have
      // none yet — those fall back to island-wide pricing).
      if (areaId) {
        const rows = await sql`
          SELECT area_id, name_en, name_el, area_type, district, parent_id,
                 latitude, longitude, search_radius_km::float AS search_radius_km, listing_count
          FROM dim_areas WHERE area_id = ${areaId} LIMIT 1
        `;
        if (rows.length) {
          const cond = areaCond(sql, rowToArea(rows[0]));
          if (cond) where = sql`${where} AND ${cond}`;
        }
      }
      const inSelection = sql`listing_id IN (SELECT listing_id FROM str_listings WHERE ${where})`;

      const curve = await sql`
        SELECT
          calendar_date::text AS date,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_night)::float AS median_price,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY price_per_night)::float AS p25,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY price_per_night)::float AS p75,
          COUNT(DISTINCT listing_id)::int AS listings
        FROM pricing_calendar
        WHERE calendar_date >= CURRENT_DATE AND ${inSelection}
        GROUP BY calendar_date ORDER BY calendar_date ASC
      `;

      const dist = await sql`
        SELECT (LEAST(FLOOR(avg_nightly_rate / 25), 20) * 25)::int AS bin_start,
               COUNT(*)::int AS count
        FROM str_listings
        WHERE avg_nightly_rate IS NOT NULL AND (${where})
        GROUP BY 1 ORDER BY 1 ASC
      `;

      const byMonth = await sql`
        SELECT to_char(calendar_date, 'YYYY-MM') AS month,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_night)::float AS median_price
        FROM pricing_calendar
        WHERE calendar_date >= CURRENT_DATE AND ${inSelection}
        GROUP BY 1 ORDER BY 1 ASC
      `;

      // Amenity premiums: with/without splits for headline amenities within
      // the selection. Client suppresses splits with < 20 listings a side.
      const PREMIUM_KEYS = ["has_pool", "has_sea_view", "has_hot_tub"] as const;
      const premiums: AmenityPremium[] = await Promise.all(
        PREMIUM_KEYS.map(async (key) => {
          const [r] = await sql`
            SELECT
              COUNT(*) FILTER (WHERE ${sql(key)} IS TRUE)::int AS with_n,
              COUNT(*) FILTER (WHERE ${sql(key)} IS NOT TRUE)::int AS without_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_nightly_rate)
                FILTER (WHERE ${sql(key)} IS TRUE)::float AS with_rate,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_nightly_rate)
                FILTER (WHERE ${sql(key)} IS NOT TRUE)::float AS without_rate,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY eff_occ_todate)
                FILTER (WHERE ${sql(key)} IS TRUE)::float AS with_occ,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY eff_occ_todate)
                FILTER (WHERE ${sql(key)} IS NOT TRUE)::float AS without_occ
            FROM str_listings WHERE ${where}
          `;
          return {
            key,
            withCount: r.with_n,
            withoutCount: r.without_n,
            withMedianRate: r.with_rate != null ? Math.round(r.with_rate) : null,
            withoutMedianRate: r.without_rate != null ? Math.round(r.without_rate) : null,
            withMedianOcc: r.with_occ,
            withoutMedianOcc: r.without_occ,
          };
        })
      );

      // Rate by bedrooms + the sweet-spot chart (occupancy per €50 band).
      const bedLabels = ["Studio", "1 bed", "2 bed", "3 bed", "4 bed", "5+ bed"];
      const byBeds = await sql`
        SELECT LEAST(COALESCE(bedrooms, 0), 5)::int AS b, COUNT(*)::int AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_nightly_rate)::float AS med
        FROM str_listings
        WHERE (${where}) AND avg_nightly_rate IS NOT NULL
        GROUP BY 1 ORDER BY 1 ASC
      `;
      const occBands = await sql`
        SELECT (LEAST(FLOOR(avg_nightly_rate / 50), 8) * 50)::int AS bin,
               COUNT(*)::int AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY eff_occ_todate)::float AS occ
        FROM str_listings
        WHERE (${where}) AND avg_nightly_rate IS NOT NULL AND eff_occ_todate IS NOT NULL
        GROUP BY 1 ORDER BY 1 ASC
      `;

      // The pricing calendar mixes full-coverage and partial sample dates;
      // partial dates skew the median, so keep only well-covered ones.
      const maxCoverage = Math.max(...curve.map((c) => c.listings as number), 0);
      const covered = curve.filter((c) => c.listings >= maxCoverage * 0.6);

      return {
        source: "live",
        forwardCurve: covered.map((c) => ({
          date: c.date,
          medianPrice: c.median_price != null ? Math.round(c.median_price) : null,
          listings: c.listings,
          p25: c.p25 != null ? Math.round(c.p25) : null,
          p75: c.p75 != null ? Math.round(c.p75) : null,
        })),
        premiums,
        byBedrooms: byBeds.map((b) => ({
          label: bedLabels[b.b],
          count: b.n,
          medianRate: b.med != null ? Math.round(b.med) : null,
        })),
        // Thin bands are noise — only keep bands with a real sample.
        occByPrice: occBands
          .filter((b) => b.n >= 10)
          .map((b) => ({
            binStart: b.bin,
            count: b.n,
            medianOcc: b.occ != null ? Math.round(b.occ * 10) / 10 : null,
          })),
        distribution: dist.map((d) => ({ binStart: d.bin_start, count: d.count })),
        byMonth: byMonth.map((m) => ({
          month: m.month,
          medianPrice: m.median_price != null ? Math.round(m.median_price) : null,
        })),
      };
    },
    () => demo.pricing(f, polygon),
    "pricing"
  );
}

export function getStats(f: Filters, polygon: PolygonCoords | null): Promise<SelectionStats> {
  return tryLive<SelectionStats>(
    async (sql) => {
      const where = buildWhere(sql, f, polygon);

      const [agg] = await sql`
        SELECT
          COUNT(*)::int AS n,
          ROUND(AVG(eff_occ_todate)::numeric, 1)::float AS eff_td,
          ROUND(AVG(eff_occ_fwd60)::numeric, 1)::float  AS eff_f60,
          ROUND(AVG(raw_occ_todate)::numeric, 1)::float AS raw_td,
          ROUND(AVG(raw_occ_fwd60)::numeric, 1)::float  AS raw_f60,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_nightly_rate)::float AS median_rate,
          ROUND(AVG(avg_nightly_rate)::numeric, 0)::float AS avg_rate,
          ROUND(100.0 * COUNT(*) FILTER (WHERE is_superhost) / GREATEST(COUNT(*), 1), 1)::float AS sh
        FROM str_listings WHERE ${where}
      `;

      const mix = await sql`
        SELECT ${TYPE_MIX_CASE(sql)} AS grp, COUNT(*)::int AS count
        FROM str_listings WHERE ${where}
        GROUP BY 1 ORDER BY count DESC
      `;

      // Weekly tables extend into future (booking-pace) weeks — clip the
      // realized trend to weeks fully covered by the availability data.
      const weekly = await sql`
        SELECT
          week_start::text,
          ROUND(AVG(eff_occ)::numeric, 1)::float AS eff_occ,
          ROUND(AVG(raw_occ)::numeric, 1)::float AS raw_occ,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_price)::float AS median_adr,
          COUNT(*)::int AS listing_count
        FROM str_listings_weekly
        WHERE week_start + 6 <= (SELECT todate_end FROM sync_meta WHERE id = 1)
          AND listing_id IN (SELECT listing_id FROM str_listings WHERE ${where})
        GROUP BY week_start ORDER BY week_start ASC
      `;

      // Quality floor keeps low-coverage 100%-occupancy artifacts out of "top".
      const top = await sql`
        SELECT ${DETAIL_COLUMNS(sql)}
        FROM str_listings
        WHERE (${where}) AND avg_nightly_rate IS NOT NULL AND coverage_days >= 30
        ORDER BY eff_occ_todate DESC NULLS LAST
        LIMIT 8
      `;

      const weeklyPoints: WeeklyPoint[] = weekly.map((w) => ({
        weekStart: w.week_start,
        effOcc: w.eff_occ,
        rawOcc: w.raw_occ,
        medianAdr: w.median_adr != null ? Math.round(w.median_adr) : null,
        listingCount: w.listing_count,
      }));

      return {
        source: "live",
        listingCount: agg.n,
        effOccTodate: agg.eff_td,
        effOccFwd60: agg.eff_f60,
        rawOccTodate: agg.raw_td,
        rawOccFwd60: agg.raw_f60,
        medianRate: agg.median_rate != null ? Math.round(agg.median_rate) : null,
        avgRate: agg.avg_rate,
        superhostShare: agg.n ? agg.sh : null,
        typeMix: mix.map((m) => ({ group: m.grp as TypeGroup, count: m.count })),
        weekly: weeklyPoints,
        topListings: top.map(rowToDetail),
      };
    },
    () => demo.stats(f, polygon),
    "stats"
  );
}

// ---------------------------------------------------------------------------
// Data-contract v2 (Data.Noesis, 11 Jul 2026): dim_areas + the two query
// paths. Path A = pre-aggregated str_area_weekly for named areas without
// attribute filters; path B = str_listings → str_listings_weekly for
// polygons / filtered selections, occupancy re-weighted by covered_nights.
// ---------------------------------------------------------------------------

import { FIRST_WEEK, mondayOf } from "@/lib/dashboard/weeks";
import { countActive } from "@/lib/dashboard/filters";

/** str_listings column that carries each dim_areas level; quarter/parish
 * have none yet → those selections degrade to path A (filters ignored). */
const AREA_COLUMN: Partial<Record<AreaType, "district" | "municipality" | "community" | "tourist_area">> = {
  district: "district",
  municipality: "municipality",
  community: "community",
  tourist_area: "tourist_area",
};

function rowToArea(r: postgres.Row): AreaInfo {
  return {
    areaId: r.area_id,
    nameEn: r.name_en,
    nameEl: r.name_el ?? null,
    areaType: r.area_type as AreaType,
    district: r.district ?? null,
    parentId: r.parent_id ?? null,
    lat: r.latitude,
    lng: r.longitude,
    radiusKm: r.search_radius_km,
    listingCount: r.listing_count ?? 0,
  };
}

/** All named areas (search bar filters client-side — the table is tiny). */
export function getAreas(): Promise<AreaInfo[]> {
  return tryLive<AreaInfo[]>(
    async (sql) => {
      const rows = await sql`
        SELECT area_id, name_en, name_el, area_type, district, parent_id,
               latitude, longitude, search_radius_km::float AS search_radius_km,
               listing_count
        FROM dim_areas
        ORDER BY listing_count DESC NULLS LAST
      `;
      return rows.map(rowToArea);
    },
    demoAreas,
    "areas"
  );
}

function rowToWeekly(r: postgres.Row): WeeklyRow {
  const effOcc = r.eff_occ != null ? Number(r.eff_occ) : null;
  const avgAdr = r.avg_adr != null ? Number(r.avg_adr) : null;
  const revpar =
    r.revpar != null
      ? Number(r.revpar)
      : effOcc != null && avgAdr != null
        ? Math.round((effOcc / 100) * avgAdr * 100) / 100
        : null;
  return {
    weekStart: r.week_start,
    listings: r.listings ?? null,
    effOcc,
    medianAdr: r.median_adr != null ? Math.round(Number(r.median_adr)) : null,
    avgAdr: avgAdr != null ? Math.round(avgAdr) : null,
    revpar,
    bookings: r.bookings ?? null,
    revenueEst: r.revenue_est != null ? Math.round(Number(r.revenue_est)) : null,
  };
}

/** Path A: pre-aggregated weekly series for one or more area_ids. */
async function areaWeekly(sql: Sql, areaIds: string[], s: string, e: string): Promise<Map<string, WeeklyRow[]>> {
  const rows = await sql`
    SELECT area_id, week_start::text AS week_start, listing_count AS listings,
           eff_occ::float AS eff_occ, avg_adr::float AS avg_adr,
           median_adr::float AS median_adr, revpar::float AS revpar,
           bookings, revenue_est::float AS revenue_est
    FROM str_area_weekly
    WHERE area_id IN ${sql(areaIds)} AND week_start BETWEEN ${s} AND ${e}
    ORDER BY week_start ASC
  `;
  const out = new Map<string, WeeklyRow[]>();
  for (const r of rows) {
    const list = out.get(r.area_id) ?? [];
    list.push(rowToWeekly(r));
    out.set(r.area_id, list);
  }
  return out;
}

/** Path B: aggregate str_listings_weekly over a listing set defined by
 * `where` on str_listings. Occupancy weighted by covered_nights (contract). */
async function listingWeekly(sql: Sql, where: Frag, s: string, e: string): Promise<WeeklyRow[]> {
  const rows = await sql`
    SELECT
      w.week_start::text AS week_start,
      COUNT(DISTINCT w.listing_id)::int AS listings,
      ROUND(100.0 * SUM(w.eff_occ / 100.0 * w.covered_nights)
                  / NULLIF(SUM(w.covered_nights), 0), 1)::float AS eff_occ,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY w.avg_price)::float AS median_adr,
      ROUND(AVG(w.avg_price)::numeric, 2)::float AS avg_adr,
      SUM(w.bookings)::int AS bookings
    FROM str_listings_weekly w
    JOIN (SELECT listing_id FROM str_listings WHERE ${where}) sel USING (listing_id)
    WHERE w.week_start BETWEEN ${s} AND ${e}
    GROUP BY w.week_start ORDER BY w.week_start ASC
  `;
  return rows.map(rowToWeekly);
}

const BEDROOM_LABELS = ["Studio", "1 bed", "2 bed", "3 bed", "4 bed", "5+ bed"];

/** Current-state snapshot over a listing set (does NOT follow the picker). */
async function listingSnapshot(sql: Sql, where: Frag): Promise<MarketSnapshot> {
  const [agg] = await sql`
    SELECT
      COUNT(*)::int AS n,
      percentile_cont(ARRAY[0.25, 0.5, 0.75])
        WITHIN GROUP (ORDER BY avg_nightly_rate) FILTER (WHERE avg_nightly_rate IS NOT NULL)
        ::float8[] AS adr_q,
      percentile_cont(ARRAY[0.25, 0.5, 0.75])
        WITHIN GROUP (ORDER BY eff_occ_todate) FILTER (WHERE eff_occ_todate IS NOT NULL)
        ::float8[] AS occ_q,
      ROUND(100.0 * COUNT(*) FILTER (WHERE is_superhost) / GREATEST(COUNT(*), 1), 1)::float AS sh
    FROM str_listings WHERE ${where}
  `;
  const beds = await sql`
    SELECT LEAST(COALESCE(bedrooms, 0), 5)::int AS b, COUNT(*)::int AS count
    FROM str_listings WHERE ${where}
    GROUP BY 1 ORDER BY 1 ASC
  `;
  const mix = await sql`
    SELECT ${TYPE_MIX_CASE(sql)} AS grp, COUNT(*)::int AS count
    FROM str_listings WHERE ${where}
    GROUP BY 1 ORDER BY count DESC
  `;
  const shareCols = AMENITIES.map(
    (a) => `ROUND(100.0 * AVG((${a.key} IS TRUE)::int), 1) AS ${a.key}`
  ).join(", ");
  const [am] = await sql`
    SELECT ${sql.unsafe(shareCols)} FROM str_listings WHERE ${where}
  `;
  const round1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
  const q3 = (a: unknown): [number, number, number] | null =>
    Array.isArray(a) && a.length === 3 && a.every((x) => x != null)
      ? [round1(a[0])!, round1(a[1])!, round1(a[2])!]
      : null;
  return {
    listings: agg.n,
    adrQuartiles: q3(agg.adr_q),
    occQuartiles: q3(agg.occ_q),
    superhostShare: agg.n ? agg.sh : null,
    bedrooms: beds.map((b) => ({ label: BEDROOM_LABELS[b.b], count: b.count })),
    typeMix: mix.map((m) => ({ group: m.grp as TypeGroup, count: m.count })),
    amenities: AMENITIES
      .map((a) => ({ key: a.key, share: round1(am?.[a.key]) ?? 0 }))
      .filter((a) => a.share > 0)
      .sort((a, b) => b.share - a.share),
  };
}

/** WHERE fragment for a named area via its str_listings name column. */
function areaCond(sql: Sql, area: AreaInfo): Frag | null {
  if (area.areaType === "country") return sql`TRUE`;
  const col = AREA_COLUMN[area.areaType];
  return col ? sql`${sql(col)} = ${area.nameEn}` : null;
}

async function findDistrict(sql: Sql, area: AreaInfo): Promise<AreaInfo | null> {
  if (!area.district || area.areaType === "district" || area.areaType === "country") return null;
  const rows = await sql`
    SELECT area_id, name_en, name_el, area_type, district, parent_id,
           latitude, longitude, search_radius_km::float AS search_radius_km, listing_count
    FROM dim_areas WHERE area_type = 'district' AND district = ${area.district} LIMIT 1
  `;
  return rows.length ? rowToArea(rows[0]) : null;
}

export function getMarket(req: MarketRequest): Promise<MarketResponse> {
  const f = parseFiltersLoose(req.filters);
  const polygon = req.selection.kind === "polygon" ? req.selection.coords : null;
  return tryLive<MarketResponse>(
    async (sql) => {
      // Clamp the picker range to whole weeks within coverage.
      const s = mondayOf(req.weekStart) < FIRST_WEEK ? FIRST_WEEK : mondayOf(req.weekStart);
      const e = mondayOf(req.weekEnd) < s ? s : mondayOf(req.weekEnd);

      const hasFilters = countActive({ ...f, areas: [] }) > 0;
      const sel = req.selection;

      let area: AreaInfo | null = null;
      if (sel.kind === "area") {
        const rows = await sql`
          SELECT area_id, name_en, name_el, area_type, district, parent_id,
                 latitude, longitude, search_radius_km::float AS search_radius_km, listing_count
          FROM dim_areas WHERE area_id = ${sel.areaId} LIMIT 1
        `;
        if (!rows.length) throw new Error(`unknown area_id ${sel.areaId}`);
        area = rowToArea(rows[0]);
      }

      const cond = area ? areaCond(sql, area) : null;
      // Quarter/parish selections can't be resolved to listings yet —
      // fall back to path A and tell the client filters were ignored.
      const filtersIgnored = sel.kind === "area" && hasFilters && cond == null;
      const usePathA =
        (sel.kind === "all" && !hasFilters) ||
        (sel.kind === "area" && (!hasFilters || cond == null));

      const district = area ? await findDistrict(sql, area) : null;

      let weekly: WeeklyRow[] = [];
      const benchmarks: BenchmarkSeries[] = [];

      if (usePathA) {
        const selId = sel.kind === "area" ? area!.areaId : "CY";
        const ids = [selId];
        if (district) ids.push(district.areaId);
        if (selId !== "CY") ids.push("CY");
        const series = await areaWeekly(sql, ids, s, e);
        weekly = series.get(selId) ?? [];
        if (district)
          benchmarks.push({ id: district.areaId, label: district.nameEn, weekly: series.get(district.areaId) ?? [] });
        if (selId !== "CY")
          benchmarks.push({ id: "CY", label: "Cyprus", weekly: series.get("CY") ?? [] });
      } else {
        // Path B: polygon, filtered named area, or filtered island.
        const geo =
          sel.kind === "polygon"
            ? buildWhere(sql, { ...f, areas: [] }, polygon)
            : cond
              ? sql`${buildWhere(sql, { ...f, areas: [] }, null)} AND ${cond}`
              : buildWhere(sql, { ...f, areas: [] }, null);
        weekly = await listingWeekly(sql, geo, s, e);
        // Benchmarks carry the SAME filters (apples-to-apples, decision 11 Jul).
        const islandWhere = buildWhere(sql, { ...f, areas: [] }, null);
        if (district) {
          const dWhere = sql`${islandWhere} AND district = ${district.nameEn}`;
          benchmarks.push({ id: district.areaId, label: district.nameEn, weekly: await listingWeekly(sql, dWhere, s, e) });
        }
        if (sel.kind !== "all") {
          benchmarks.push({ id: "CY", label: "Cyprus", weekly: await listingWeekly(sql, islandWhere, s, e) });
        }
      }

      // Snapshot (current state) — needs a listing-grain WHERE; null for
      // quarter/parish where no listings column exists yet.
      let snapshot: MarketSnapshot | null = null;
      const snapFilters = filtersIgnored ? { ...DEFAULT_FILTERS } : { ...f, areas: [] };
      if (sel.kind === "polygon") {
        snapshot = await listingSnapshot(sql, buildWhere(sql, snapFilters, polygon));
      } else if (sel.kind === "all" || area?.areaType === "country") {
        snapshot = await listingSnapshot(sql, buildWhere(sql, snapFilters, null));
      } else if (cond) {
        snapshot = await listingSnapshot(sql, sql`${buildWhere(sql, snapFilters, null)} AND ${cond}`);
      }

      return {
        source: "live",
        path: usePathA ? "area" : "listing",
        filtersIgnored,
        weekly,
        benchmarks,
        snapshot,
      };
    },
    () => demoMarket(f, polygon),
    "market"
  );
}

/** Buy-side snapshot. Named-area filtering is unavailable (sale_listings.area
 * is NULL until the Bazaraki assigner runs) — polygon or island only. */
export function getInvest(polygon: PolygonCoords | null): Promise<InvestStats> {
  return tryLive<InvestStats>(
    async (sql) => {
      const geo = polygon
        ? sql`ST_Covers(ST_GeogFromText(${polygonWkt(polygon)}), geog)`
        : sql`TRUE`;
      const [agg] = await sql`
        SELECT COUNT(*)::int AS n,
          percentile_cont(ARRAY[0.25, 0.5, 0.75])
            WITHIN GROUP (ORDER BY price) FILTER (WHERE price > 0)::float8[] AS price_q,
          percentile_cont(0.5)
            WITHIN GROUP (ORDER BY price / NULLIF(size_m2, 0))
            FILTER (WHERE price > 0 AND size_m2 > 0)::float AS eur_m2
        FROM sale_listings WHERE ${geo}
      `;
      const beds = await sql`
        SELECT LEAST(COALESCE(bedrooms, 0), 5)::int AS b, COUNT(*)::int AS count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE price > 0)::float AS med
        FROM sale_listings WHERE ${geo}
        GROUP BY 1 ORDER BY 1 ASC
      `;
      const q = agg.price_q as number[] | null;
      return {
        source: "live",
        supply: agg.n,
        priceQuartiles:
          Array.isArray(q) && q.every((x) => x != null)
            ? [Math.round(q[0]), Math.round(q[1]), Math.round(q[2])]
            : null,
        eurPerM2Median: agg.eur_m2 != null ? Math.round(agg.eur_m2) : null,
        byBedrooms: beds.map((b) => ({
          label: BEDROOM_LABELS[b.b],
          count: b.count,
          medianPrice: b.med != null ? Math.round(b.med) : null,
        })),
      };
    },
    demoInvest,
    "invest"
  );
}

/** Rent-side snapshot (ltr_listings) — polygon or island only, like sales. */
export function getRentals(polygon: PolygonCoords | null): Promise<RentalStats> {
  return tryLive<RentalStats>(
    async (sql) => {
      const geo = polygon
        ? sql`ST_Covers(ST_GeogFromText(${polygonWkt(polygon)}), geog)`
        : sql`TRUE`;
      const [agg] = await sql`
        SELECT COUNT(*)::int AS n,
          percentile_cont(ARRAY[0.25, 0.5, 0.75])
            WITHIN GROUP (ORDER BY monthly_rent) FILTER (WHERE monthly_rent > 0)::float8[] AS rent_q
        FROM ltr_listings WHERE ${geo}
      `;
      const beds = await sql`
        SELECT LEAST(COALESCE(bedrooms, 0), 5)::int AS b, COUNT(*)::int AS count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent) FILTER (WHERE monthly_rent > 0)::float AS med
        FROM ltr_listings WHERE ${geo}
        GROUP BY 1 ORDER BY 1 ASC
      `;
      const q = agg.rent_q as number[] | null;
      return {
        source: "live",
        supply: agg.n,
        rentQuartiles:
          Array.isArray(q) && q.every((x) => x != null)
            ? [Math.round(q[0]), Math.round(q[1]), Math.round(q[2])]
            : null,
        byBedrooms: beds.map((b) => ({
          label: BEDROOM_LABELS[b.b],
          count: b.count,
          medianRent: b.med != null ? Math.round(b.med) : null,
        })),
      };
    },
    demoRentals,
    "rentals"
  );
}

// ---- Demo fallbacks for the contract endpoints (Vercel has no DB yet) ----

import { groupAreas } from "@/lib/dashboard/areas";
import { DEFAULT_FILTERS, parseFilters } from "@/lib/dashboard/filters";

function parseFiltersLoose(input: Record<string, unknown>): Filters {
  return parseFilters(input ?? {});
}

function demoAreas(): AreaInfo[] {
  const s = demo.summary();
  const bySlug = new Map(s.areas.map((a) => [a.slug, a]));
  const out: AreaInfo[] = [
    {
      areaId: "CY", nameEn: "Cyprus", nameEl: "Κύπρος", areaType: "country",
      district: null, parentId: null, lat: 34.98, lng: 33.25, radiusKm: 100,
      listingCount: s.totalListings,
    },
  ];
  for (const g of groupAreas(s.areas)) {
    for (const c of g.children) {
      const m = bySlug.get(c.slug);
      if (!m) continue;
      out.push({
        areaId: c.slug, nameEn: c.label, nameEl: null, areaType: "community",
        district: g.parent, parentId: "CY", lat: m.lat, lng: m.lng,
        radiusKm: 6, listingCount: c.count,
      });
    }
  }
  return out;
}

function scaleWeekly(w: WeeklyRow[], k: number): WeeklyRow[] {
  const r1 = (v: number | null, f: number) => (v == null ? null : Math.round(v * f * 10) / 10);
  return w.map((x) => ({
    ...x,
    effOcc: x.effOcc == null ? null : Math.min(100, r1(x.effOcc, k)!),
    medianAdr: x.medianAdr == null ? null : Math.round(x.medianAdr * (2 - k)),
    avgAdr: x.avgAdr == null ? null : Math.round(x.avgAdr * (2 - k)),
    revpar: x.revpar == null ? null : Math.round(x.revpar * k),
  }));
}

function demoMarket(f: Filters, polygon: PolygonCoords | null): MarketResponse {
  const stats = demo.stats(f, polygon);
  const weekly: WeeklyRow[] = stats.weekly.map((w) => {
    const avgAdr = w.medianAdr != null ? Math.round(w.medianAdr * 1.12) : null;
    return {
      weekStart: w.weekStart,
      listings: w.listingCount,
      effOcc: w.effOcc,
      medianAdr: w.medianAdr,
      avgAdr,
      revpar:
        w.effOcc != null && avgAdr != null ? Math.round((w.effOcc / 100) * avgAdr) : null,
      bookings:
        w.listingCount != null && w.effOcc != null
          ? Math.round(w.listingCount * (w.effOcc / 100) * 0.35)
          : null,
      revenueEst: null,
    };
  });
  const med = stats.medianRate;
  return {
    source: "demo",
    path: "listing",
    filtersIgnored: false,
    weekly,
    benchmarks: [{ id: "CY", label: "Cyprus", weekly: scaleWeekly(weekly, 0.93) }],
    snapshot: {
      listings: stats.listingCount,
      adrQuartiles: med != null ? [Math.round(med * 0.68), med, Math.round(med * 1.52)] : null,
      occQuartiles:
        stats.effOccTodate != null
          ? [
              Math.max(0, Math.round((stats.effOccTodate - 14) * 10) / 10),
              stats.effOccTodate,
              Math.min(100, Math.round((stats.effOccTodate + 11) * 10) / 10),
            ]
          : null,
      superhostShare: stats.superhostShare,
      bedrooms: [
        { label: "Studio", count: Math.round(stats.listingCount * 0.08) },
        { label: "1 bed", count: Math.round(stats.listingCount * 0.3) },
        { label: "2 bed", count: Math.round(stats.listingCount * 0.34) },
        { label: "3 bed", count: Math.round(stats.listingCount * 0.19) },
        { label: "4 bed", count: Math.round(stats.listingCount * 0.06) },
        { label: "5+ bed", count: Math.round(stats.listingCount * 0.03) },
      ],
      typeMix: stats.typeMix,
      amenities: [
        { key: "has_patio_or_balcony", share: 72.4 },
        { key: "has_free_parking", share: 64.1 },
        { key: "has_pool", share: 38.2 },
        { key: "has_sea_view", share: 27.9 },
        { key: "has_fast_wifi", share: 24.6 },
        { key: "has_bbq", share: 18.3 },
        { key: "has_hot_tub", share: 7.1 },
      ],
    },
  };
}

function demoInvest(): InvestStats {
  return {
    source: "demo",
    supply: 3184,
    priceQuartiles: [189000, 295000, 520000],
    eurPerM2Median: 2850,
    byBedrooms: [
      { label: "Studio", count: 142, medianPrice: 128000 },
      { label: "1 bed", count: 512, medianPrice: 165000 },
      { label: "2 bed", count: 1103, medianPrice: 255000 },
      { label: "3 bed", count: 968, medianPrice: 385000 },
      { label: "4 bed", count: 331, medianPrice: 620000 },
      { label: "5+ bed", count: 128, medianPrice: 990000 },
    ],
  };
}

function demoRentals(): RentalStats {
  return {
    source: "demo",
    supply: 1420,
    rentQuartiles: [850, 1200, 1800],
    byBedrooms: [
      { label: "Studio", count: 96, medianRent: 700 },
      { label: "1 bed", count: 342, medianRent: 950 },
      { label: "2 bed", count: 528, medianRent: 1250 },
      { label: "3 bed", count: 337, medianRent: 1700 },
      { label: "4 bed", count: 87, medianRent: 2400 },
      { label: "5+ bed", count: 30, medianRent: 3300 },
    ],
  };
}
