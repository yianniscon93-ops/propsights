import type postgres from "postgres";
import { getSql } from "./db";
import { demo } from "./demoData";
import type {
  DashboardSummary,
  ListingDetail,
  PointRow,
  PolygonCoords,
  PricingData,
  SelectionStats,
  WeeklyPoint,
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

/** Build the WHERE clause for str_listings from filters + optional polygon. */
function buildWhere(sql: Sql, f: Filters, polygon: PolygonCoords | null): Frag {
  const conds: Frag[] = [];
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
  listing_id::text AS id, name, area AS area_slug,
  latitude::float AS lat, longitude::float AS lng,
  property_type, room_type, bedrooms, beds, size_sqm,
  avg_rating::float AS rating, review_count,
  avg_nightly_rate::float AS nightly_rate,
  is_superhost, is_guest_fav,
  eff_occ_todate::float, eff_occ_fwd60::float,
  raw_occ_todate::float, raw_occ_fwd60::float,
  bookings_30d, total_bookings,
  proximity_beach_min, proximity_center_min,
  ${sql.unsafe(AMENITIES.map((a) => a.key).join(", "))}`;

function rowToDetail(r: postgres.Row): ListingDetail {
  return {
    id: r.id,
    name: r.name ?? "Listing",
    areaSlug: r.area_slug ?? "",
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
        FROM str_listings WHERE area IS NOT NULL
        GROUP BY area ORDER BY count DESC
      `;
      const [tot] = await sql`SELECT COUNT(*)::int AS n FROM str_listings`;
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

export function getPricing(f: Filters, polygon: PolygonCoords | null): Promise<PricingData> {
  return tryLive<PricingData>(
    async (sql) => {
      const where = buildWhere(sql, f, polygon);
      const inSelection = sql`listing_id IN (SELECT listing_id FROM str_listings WHERE ${where})`;

      const curve = await sql`
        SELECT
          calendar_date::text AS date,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_night)::float AS median_price,
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
