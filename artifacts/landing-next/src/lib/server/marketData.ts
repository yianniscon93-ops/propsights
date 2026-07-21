import type postgres from "postgres";
import { getSql } from "./db";
import { demo } from "./demoData";
import type {
  AmenityPremium,
  AreaHealth,
  AreaInfo,
  AreaType,
  BenchmarkSeries,
  DashboardSummary,
  DealRow,
  DistrictHealthRow,
  EarlyBirdBucket,
  InvestStats,
  ListingDetail,
  MarketRequest,
  MarketResponse,
  MarketSnapshot,
  PaceData,
  PointRow,
  PolygonCoords,
  PricingBehavior,
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
      // Demand-feed freshness — nested try: the stays table is a one-off
      // backfill until it lands in sync_to_postgres.py.
      let bookingsThrough: string | null = null;
      try {
        const [b] = await sql`SELECT MAX(detected_at) AS t FROM booking_stays`;
        bookingsThrough = b?.t ? new Date(b.t).toISOString() : null;
      } catch {
        /* booking_stays not present in this environment */
      }
      return {
        source: "live" as const,
        totalListings: tot.n,
        areas: areas.map((a) => ({ slug: a.slug, count: a.count, lat: a.lat, lng: a.lng })),
        todateStart: meta?.todate_start ?? "",
        todateEnd: meta?.todate_end ?? "",
        fwdEnd: meta?.fwd_end ?? "",
        lastRunAt: meta?.last_run_at ? new Date(meta.last_run_at).toISOString() : null,
        bookingsThrough,
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

/**
 * booking_stays / pricing_behavior / area_pace are district-grain. Resolve
 * the current selection to one district label ("Paphos District", …) or
 * null = island-wide. Polygons resolve to their majority district.
 */
async function resolveDistrict(
  sql: Sql,
  polygon: PolygonCoords | null,
  areaId?: string | null
): Promise<string | null> {
  if (polygon) {
    const rows = await sql`
      SELECT district, COUNT(*)::int AS n FROM str_listings
      WHERE is_active IS TRUE AND district IS NOT NULL
        AND ST_Covers(ST_GeogFromText(${polygonWkt(polygon)}), geog)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1
    `;
    return rows.length ? rows[0].district : null;
  }
  if (areaId) {
    const rows = await sql`
      SELECT name_en, area_type, district FROM dim_areas WHERE area_id = ${areaId} LIMIT 1
    `;
    if (rows.length) {
      const r = rows[0];
      if (r.area_type === "district") return r.name_en;
      if (r.district) return `${r.district} District`; // dim_areas stores the short name
    }
  }
  return null;
}

/** Confidence floor for all demand analytics (data contract, 12 Jul 2026). */
const STAYS_BASE = (sql: Sql): Frag => sql`confidence >= 0.8 AND NOT stale_listing`;

const EARLY_BIRD_LABELS = [
  "0–7 days",
  "8–14 days",
  "15–30 days",
  "1–2 months",
  "2–3 months",
  "3–5 months",
  "5+ months",
];

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
               percentile_cont(0.5) WITHIN GROUP (ORDER BY eff_occ_todate)::float AS occ,
               percentile_cont(0.5) WITHIN GROUP
                 (ORDER BY avg_nightly_rate * eff_occ_todate / 100.0)::float AS revpar
        FROM str_listings
        WHERE (${where}) AND avg_nightly_rate IS NOT NULL AND eff_occ_todate IS NOT NULL
        GROUP BY 1 ORDER BY 1 ASC
      `;

      // District-grain discounting behaviour + early-bird economics.
      // Nested try: these tables are one-off backfills until they join the
      // regular sync — pricing must not fail if they're missing.
      let behavior: PricingBehavior | null = null;
      let earlyBird: EarlyBirdBucket[] = [];
      try {
        const district = await resolveDistrict(sql, polygon, areaId);
        const pb = await sql`
          SELECT stay_month, n_dates, n_listings,
                 pct_cut10::float, pct_cut20::float, med_cut_depth_pct::float,
                 conv_cut_pct::float, conv_hold_pct::float, static_pricer_share::float
          FROM pricing_behavior
          WHERE district = ${district ?? "CY"}
          ORDER BY stay_month ASC
        `;
        if (pb.length) {
          behavior = {
            scope: district ?? "Cyprus",
            months: pb.map((r) => ({
              month: r.stay_month,
              nDates: r.n_dates,
              nListings: r.n_listings,
              pctCut10: r.pct_cut10,
              pctCut20: r.pct_cut20,
              medCutDepth: r.med_cut_depth_pct,
              convCut: r.conv_cut_pct,
              convHold: r.conv_hold_pct,
              staticShare: r.static_pricer_share,
            })),
          };
        }
        const distCond = district ? sql`district = ${district}` : sql`TRUE`;
        const eb = await sql`
          SELECT CASE
              WHEN lead_time_days <= 7 THEN 0 WHEN lead_time_days <= 14 THEN 1
              WHEN lead_time_days <= 30 THEN 2 WHEN lead_time_days <= 60 THEN 3
              WHEN lead_time_days <= 90 THEN 4 WHEN lead_time_days <= 150 THEN 5
              ELSE 6 END AS b,
            COUNT(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY price_at_booking)::float AS med
          FROM booking_stays
          WHERE price_at_booking IS NOT NULL AND ${STAYS_BASE(sql)} AND ${distCond}
          GROUP BY 1 ORDER BY 1 ASC
        `;
        earlyBird = eb
          .filter((r) => r.n >= 50)
          .map((r) => ({
            bucket: EARLY_BIRD_LABELS[r.b],
            n: r.n,
            medPrice: r.med != null ? Math.round(r.med) : null,
          }));
      } catch (err) {
        console.warn("[dashboard] pricing behavior enrichment unavailable:", err);
      }

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
            medianRevpar: b.revpar != null ? Math.round(b.revpar * 10) / 10 : null,
          })),
        distribution: dist.map((d) => ({ binStart: d.bin_start, count: d.count })),
        byMonth: byMonth.map((m) => ({
          month: m.month,
          medianPrice: m.median_price != null ? Math.round(m.median_price) : null,
        })),
        behavior,
        earlyBird,
      };
    },
    () => ({ ...demo.pricing(f, polygon), behavior: demoBehavior(), earlyBird: demoEarlyBird() }),
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

const DEAL_COLUMNS = (sql: Sql): Frag => sql`
  listing_id::text AS id, title, url, price::float,
  bedrooms, size_m2::float,
  str_gross_yield::float, str_annual_revenue_est::float,
  ltr_gross_yield::float, ltr_monthly_rent_est::float,
  break_even_occ_pct::float, str_ltr_parity_occ_pct::float,
  str_comp_count, str_comp_adr::float, str_comp_eff_occ::float,
  days_on_market, dom_left_censored,
  price_change_pct::float, n_price_drops`;

function rowToDeal(r: postgres.Row): DealRow {
  return {
    id: r.id,
    title: r.title ?? "Listing",
    url: r.url ?? null,
    price: r.price,
    bedrooms: r.bedrooms,
    sizeM2: r.size_m2,
    strYield: r.str_gross_yield,
    strRevenue: r.str_annual_revenue_est != null ? Math.round(r.str_annual_revenue_est) : null,
    ltrYield: r.ltr_gross_yield,
    ltrRent: r.ltr_monthly_rent_est != null ? Math.round(r.ltr_monthly_rent_est) : null,
    breakEven: r.break_even_occ_pct,
    parity: r.str_ltr_parity_occ_pct,
    compCount: r.str_comp_count,
    compAdr: r.str_comp_adr != null ? Math.round(r.str_comp_adr) : null,
    compOcc: r.str_comp_eff_occ,
    dom: r.days_on_market,
    domCensored: !!r.dom_left_censored,
    priceChangePct: r.price_change_pct,
    nDrops: r.n_price_drops,
  };
}

// Screener guards: junk floors out data artifacts (€30k ruins with 90%
// "yields"), the comp floor keeps estimates credible (contract: comp_count
// says how good the estimate is).
const SCREENER_MIN_PRICE = 50000;
const SCREENER_MAX_YIELD = 25;
const SCREENER_MIN_COMPS = 5;

/** sale/ltr property_type vocabulary (Bazaraki) differs from Airbnb's. */
const SALE_TYPE_WORDS: Record<"apartment" | "house", string[]> = {
  apartment: ["apartment", "penthouse", "studio", "flat"],
  house: ["villa", "detached", "house", "maisonette", "bungalow", "townhouse"],
};

function saleTypeCond(sql: Sql, group: TypeGroup): Frag {
  const words = (g: "apartment" | "house") =>
    SALE_TYPE_WORDS[g].map((w) => sql`property_type ILIKE ${"%" + w + "%"}`);
  if (group === "apartment" || group === "house") return sql`(${orJoin(sql, words(group))})`;
  if (group === "other")
    return sql`NOT (${orJoin(sql, [...words("apartment"), ...words("house")])})`;
  return sql`FALSE`; // hotels aren't sold/rented on the property portals
}

/** The subset of the dashboard filters that translates to sale/ltr rows
 * (bedrooms + property type — the rest are Airbnb-only attributes). */
function saleFilterCond(sql: Sql, f: Filters): Frag {
  const conds: Frag[] = [sql`TRUE`];
  if (f.minBeds > 0) conds.push(sql`bedrooms >= ${f.minBeds}`);
  if (f.types.length) conds.push(sql`(${orJoin(sql, f.types.map((g) => saleTypeCond(sql, g)))})`);
  return conds.reduce((a, c) => sql`${a} AND ${c}`);
}

/** Named-area circle for sale/ltr tables (they carry no area assignment
 * yet): dim_areas centre + search radius. NOTE: must return plain data, not
 * a fragment — postgres fragments are thenables, so returning one from an
 * async fn would execute it as a standalone query on await. */
async function saleAreaCircle(
  sql: Sql,
  areaId: string
): Promise<{ lat: number; lng: number; meters: number } | null> {
  const rows = await sql`
    SELECT area_type, latitude, longitude, search_radius_km::float AS r
    FROM dim_areas WHERE area_id = ${areaId} LIMIT 1
  `;
  const a = rows[0];
  if (a && a.area_type !== "country" && a.latitude != null && a.longitude != null && a.r != null) {
    return { lat: a.latitude, lng: a.longitude, meters: a.r * 1000 };
  }
  return null;
}

/** Geo + attribute scope for sale/ltr tables: exact polygon, or a named
 * area approximated by its centre + search radius, plus the translatable
 * filter subset. Wrapped in an object — awaiting a bare fragment would
 * execute it (fragments are thenables). */
async function saleScope(
  sql: Sql,
  polygon: PolygonCoords | null,
  areaId: string | null | undefined,
  f: Filters
): Promise<{ where: Frag }> {
  const circle = !polygon && areaId ? await saleAreaCircle(sql, areaId) : null;
  const geo = polygon
    ? sql`ST_Covers(ST_GeogFromText(${polygonWkt(polygon)}), geog)`
    : circle
      ? sql`ST_DWithin(geog,
          ST_SetSRID(ST_MakePoint(${circle.lng}, ${circle.lat}), 4326)::geography,
          ${circle.meters})`
      : sql`TRUE`;
  return { where: sql`(${geo}) AND (${saleFilterCond(sql, f)})` };
}

/** Buy-side snapshot + ROI enrichment (backfilled 12 Jul 2026).
 * Scope: exact polygon, or named area via centre+radius; bedrooms and
 * property-type filters apply (the rest are Airbnb-only). */
export function getInvest(
  polygon: PolygonCoords | null,
  areaId?: string | null,
  f: Filters = DEFAULT_FILTERS
): Promise<InvestStats> {
  return tryLive<InvestStats>(
    async (sql) => {
      const { where: geo } = await saleScope(sql, polygon, areaId, f);
      const [agg] = await sql`
        SELECT COUNT(*)::int AS n,
          percentile_cont(ARRAY[0.25, 0.5, 0.75])
            WITHIN GROUP (ORDER BY price) FILTER (WHERE price > 0)::float8[] AS price_q,
          percentile_cont(0.5)
            WITHIN GROUP (ORDER BY price / NULLIF(size_m2, 0))
            FILTER (WHERE price > 0 AND size_m2 > 0)::float AS eur_m2,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY str_gross_yield)::float AS str_y,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ltr_gross_yield)::float AS ltr_y,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY str_annual_revenue_est)::float AS str_rev,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ltr_monthly_rent_est)::float AS ltr_rent,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY break_even_occ_pct)::float AS be,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY str_ltr_parity_occ_pct)::float AS par,
          AVG(days_on_market)::float AS dom,
          ROUND(100.0 * AVG(dom_left_censored::int), 1)::float AS dom_cens,
          COUNT(*) FILTER (WHERE n_price_drops > 0)::int AS cuts_n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price_change_pct)
            FILTER (WHERE n_price_drops > 0)::float AS cuts_med
        FROM sale_listings WHERE ${geo}
      `;
      const beds = await sql`
        SELECT LEAST(COALESCE(bedrooms, 0), 5)::int AS b, COUNT(*)::int AS count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE price > 0)::float AS med
        FROM sale_listings WHERE ${geo}
        GROUP BY 1 ORDER BY 1 ASC
      `;
      const screener = await sql`
        SELECT ${DEAL_COLUMNS(sql)} FROM sale_listings
        WHERE (${geo}) AND price >= ${SCREENER_MIN_PRICE}
          AND str_comp_count >= ${SCREENER_MIN_COMPS}
          AND str_gross_yield > 0 AND str_gross_yield <= ${SCREENER_MAX_YIELD}
        ORDER BY str_gross_yield DESC LIMIT 50
      `;
      // Cuts deeper than 40% are almost always listing-entry artifacts
      // (spec: trajectory data thin until more post-fix runs accrue).
      const movers = await sql`
        SELECT ${DEAL_COLUMNS(sql)} FROM sale_listings
        WHERE (${geo}) AND price >= ${SCREENER_MIN_PRICE}
          AND n_price_drops > 0 AND price_change_pct BETWEEN -40 AND -1
        ORDER BY price_change_pct ASC LIMIT 10
      `;
      const q = agg.price_q as number[] | null;
      const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
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
        strYieldMedian: r1(agg.str_y),
        ltrYieldMedian: r1(agg.ltr_y),
        strRevenueMedian: agg.str_rev != null ? Math.round(agg.str_rev) : null,
        ltrRentMedian: agg.ltr_rent != null ? Math.round(agg.ltr_rent) : null,
        breakEvenMedian: r1(agg.be),
        parityMedian: r1(agg.par),
        domAvg: agg.dom != null ? Math.round(agg.dom) : null,
        domCensoredShare: agg.dom_cens,
        cutsCount: agg.cuts_n,
        cutsMedianPct: r1(agg.cuts_med),
        screener: screener.map(rowToDeal),
        movers: movers.map(rowToDeal),
      };
    },
    demoInvest,
    "invest"
  );
}

// ---------------------------------------------------------------------------
// Booking pace (booking_stays, area_pace) — enrichment of 12 Jul 2026.
// All demand stats filter confidence ≥ 0.8 AND NOT stale_listing.
// ---------------------------------------------------------------------------

const WINDOW_DAYS_OUT = [0, 3, 7, 14, 21, 30, 45, 60, 90, 120, 150, 180];
/** Pickup chart stay-weeks: Mondays this many weeks after the current week. */
const PICKUP_WEEKS_AHEAD = [2, 5, 9];

export function getPace(
  polygon: PolygonCoords | null,
  areaId?: string | null,
  f: Filters = DEFAULT_FILTERS
): Promise<PaceData> {
  return tryLive<PaceData>(
    async (sql) => {
      const district = await resolveDistrict(sql, polygon, areaId);
      const hasFilters = countActive({ ...f, areas: [] }) > 0;

      // Named-area lookup for a precise listing-column condition + label.
      let area: AreaInfo | null = null;
      if (!polygon && areaId) {
        const rows = await sql`
          SELECT area_id, name_en, name_el, area_type, district, parent_id,
                 latitude, longitude, search_radius_km::float AS search_radius_km, listing_count
          FROM dim_areas WHERE area_id = ${areaId} LIMIT 1
        `;
        if (rows.length) area = rowToArea(rows[0]);
      }
      const cond = area && area.areaType !== "country" ? areaCond(sql, area) : null;

      // Stays scope: a listing set whenever the selection/filters resolve to
      // str_listings (polygon, filters, or a named area with a listings
      // column); district fallback for quarter/parish; island otherwise.
      let listingWhere: Frag | null = null;
      if (polygon || hasFilters) {
        listingWhere = buildWhere(sql, { ...f, areas: [] }, polygon);
        if (cond) listingWhere = sql`${listingWhere} AND ${cond}`;
      } else if (cond) {
        listingWhere = sql`is_active IS TRUE AND ${cond}`;
      }
      const scopeCond = listingWhere
        ? sql`listing_id IN (SELECT listing_id FROM str_listings WHERE ${listingWhere})`
        : district
          ? sql`district = ${district}`
          : sql`TRUE`;
      const base = sql`${STAYS_BASE(sql)} AND ${scopeCond}`;

      const scopeLabel =
        (polygon ? "Drawn area" : (area?.nameEn ?? "Cyprus")) +
        (hasFilters ? " · filters applied" : "");

      // Night-weighted median lead time per stay month (windowed medians
      // aren't native, so walk the cumulative night count per partition).
      const byMonth = await sql`
        WITH w AS (
          SELECT to_char(first_night, 'YYYY-MM') AS m, lead_time_days,
                 SUM(stay_length_nights) OVER (PARTITION BY to_char(first_night, 'YYYY-MM')
                                               ORDER BY lead_time_days) AS cum,
                 SUM(stay_length_nights) OVER (PARTITION BY to_char(first_night, 'YYYY-MM')) AS tot
          FROM booking_stays
          WHERE ${base}
            AND first_night >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')
            AND first_night <  date_trunc('month', CURRENT_DATE + INTERVAL '6 months')
        )
        SELECT m, MIN(lead_time_days)::int AS med, MAX(tot)::int AS nights
        FROM w WHERE cum >= tot / 2.0
        GROUP BY m ORDER BY m ASC
      `;

      // Lead time per district for stays in the next 90 days — always
      // island-wide so districts can be compared side by side.
      const byDistrict = await sql`
        WITH w AS (
          SELECT district, lead_time_days,
                 SUM(stay_length_nights) OVER (PARTITION BY district ORDER BY lead_time_days) AS cum,
                 SUM(stay_length_nights) OVER (PARTITION BY district) AS tot
          FROM booking_stays
          WHERE ${STAYS_BASE(sql)} AND district IS NOT NULL
            AND first_night >= CURRENT_DATE AND first_night < CURRENT_DATE + 90
        )
        SELECT district, MIN(lead_time_days)::int AS med, MAX(tot)::int AS nights
        FROM w WHERE cum >= tot / 2.0
        GROUP BY district ORDER BY med DESC
      `;

      // Booking-window CDF over COMPLETED recent stays (last 90 days) —
      // future stays are right-censored and would understate lead times.
      const cdf = await sql`
        SELECT d::int AS days_out,
               ROUND(100.0 * SUM(stay_length_nights) FILTER (WHERE lead_time_days >= d)
                     / NULLIF(SUM(stay_length_nights), 0), 1)::float AS share
        FROM booking_stays
        CROSS JOIN unnest(${WINDOW_DAYS_OUT}::int[]) AS d
        WHERE ${base}
          AND first_night >= CURRENT_DATE - 90 AND first_night < CURRENT_DATE
        GROUP BY d ORDER BY d ASC
      `;

      const mix = await sql`
        SELECT to_char(first_night, 'YYYY-MM') AS m, COUNT(*)::int AS n,
          ROUND(100.0 * AVG((stay_length_nights <= 3)::int), 1)::float AS short,
          ROUND(100.0 * AVG((stay_length_nights BETWEEN 4 AND 14)::int), 1)::float AS week,
          ROUND(100.0 * AVG((stay_length_nights BETWEEN 15 AND 27)::int), 1)::float AS mid,
          ROUND(100.0 * AVG((stay_length_nights >= 28)::int), 1)::float AS month28
        FROM booking_stays
        WHERE ${base}
          AND first_night >= date_trunc('month', CURRENT_DATE - INTERVAL '4 months')
          AND first_night <  date_trunc('month', CURRENT_DATE + INTERVAL '5 months')
        GROUP BY 1 HAVING COUNT(*) >= 50 ORDER BY 1 ASC
      `;

      // Median stay is night-weighted: "the typical booked night belongs to
      // a stay of N nights" — matches how hosts experience their calendar.
      const [overall] = await sql`
        WITH w AS (
          SELECT stay_length_nights,
                 SUM(stay_length_nights) OVER (ORDER BY stay_length_nights) AS cum,
                 SUM(stay_length_nights) OVER () AS tot
          FROM booking_stays WHERE ${base}
        )
        SELECT MIN(stay_length_nights)::float AS med FROM w WHERE cum >= tot / 2.0
      `;
      const [midShare] = await sql`
        SELECT ROUND(100.0 * AVG((stay_length_nights >= 15)::int), 1)::float AS mid_share
        FROM booking_stays WHERE ${base}
      `;

      // OTB pickup — raw unavailability by days-out for a few upcoming
      // stay-weeks. Owner blocks included: the UI plots the fill-up slope.
      const pickupRows = await sql`
        WITH wk AS (
          SELECT (date_trunc('week', CURRENT_DATE)::date + s * 7) AS stay_week
          FROM unnest(${PICKUP_WEEKS_AHEAD}::int[]) AS s
        )
        SELECT a.stay_week::text AS stay_week,
               (a.stay_week - a.as_of_date)::int AS days_out,
               a.otb_raw_pct::float AS otb
        FROM area_pace a JOIN wk USING (stay_week)
        WHERE a.district = ${district ?? "CY"}
        ORDER BY a.stay_week ASC, a.as_of_date ASC
      `;
      const pickupMap = new Map<string, Array<{ daysOut: number; otb: number }>>();
      for (const r of pickupRows) {
        const list = pickupMap.get(r.stay_week) ?? [];
        list.push({ daysOut: r.days_out, otb: r.otb });
        pickupMap.set(r.stay_week, list);
      }

      const [fresh] = await sql`SELECT MAX(detected_at) AS t FROM booking_stays`;

      return {
        source: "live",
        scope: scopeLabel,
        pickupScope: district ?? "Cyprus",
        bookingsThrough: fresh?.t ? new Date(fresh.t).toISOString() : null,
        leadTimeByMonth: byMonth
          .filter((r) => r.nights >= 100)
          .map((r) => ({ month: r.m, medianLead: r.med, nights: r.nights })),
        leadTimeByDistrict: byDistrict.map((r) => ({
          district: r.district,
          medianLead: r.med,
          nights: r.nights,
        })),
        // Null shares are thresholds beyond the observable detection window
        // (tracking started 21 Mar 2026) — drop them rather than plot zeros.
        bookingWindow: cdf
          .filter((r) => r.share != null)
          .map((r) => ({ daysOut: r.days_out, cumShare: r.share })),
        stayMix: mix.map((r) => ({
          month: r.m,
          n: r.n,
          short: r.short,
          week: r.week,
          mid: r.mid,
          month28: r.month28,
        })),
        midTermShare: midShare?.mid_share ?? null,
        medianStay: overall?.med ?? null,
        pickup: [...pickupMap.entries()].map(([stayWeek, points]) => ({ stayWeek, points })),
      };
    },
    demoPace,
    "pace"
  );
}

// ---------------------------------------------------------------------------
// Area health / supply — district league table, ramp-up, churn.
// ---------------------------------------------------------------------------

/** Weights for the v1 composite score (documented in the explainer). */
const SCORE_WEIGHTS = { occ: 0.4, revpar: 0.3, growth: 0.15, absorption: 0.15 };

export function getAreaHealth(): Promise<AreaHealth> {
  return tryLive<AreaHealth>(
    async (sql) => {
      // District weekly metrics over the last 8 completed weeks: the most
      // recent 4 are "current", the 4 before are the growth baseline.
      const weeks = await sql`
        SELECT w.area_id, d.name_en, w.week_start::text AS week_start,
               w.listing_count, w.eff_occ::float AS eff_occ, w.revpar::float AS revpar, w.bookings
        FROM str_area_weekly w
        JOIN dim_areas d ON d.area_id = w.area_id AND d.area_type = 'district'
        WHERE w.week_start + 6 <= (SELECT todate_end FROM sync_meta WHERE id = 1)
          AND w.week_start >= (SELECT todate_end FROM sync_meta WHERE id = 1) - 62
        ORDER BY w.week_start ASC
      `;

      const supply = await sql`
        SELECT district,
          COUNT(*) FILTER (WHERE is_active IS TRUE AND first_seen >= CURRENT_DATE - 90)::int AS new_n,
          COUNT(*) FILTER (WHERE is_active IS NOT TRUE AND last_seen >= CURRENT_DATE - 90)::int AS gone_n
        FROM str_listings WHERE district IS NOT NULL GROUP BY 1
      `;

      const absorption = await sql`
        SELECT l.district,
          ROUND(100.0 * AVG((EXISTS (
            SELECT 1 FROM booking_stays b
            WHERE b.listing_id = l.listing_id AND b.confidence >= 0.8 AND NOT b.stale_listing
          ))::int), 1)::float AS absorbed
        FROM str_listings l
        WHERE l.is_active IS TRUE AND l.district IS NOT NULL
          AND l.first_seen >= CURRENT_DATE - 90
        GROUP BY 1
      `;

      // Ramp-up: occupancy by weeks-since-launch. The initial-crawl cohort
      // (everything first_seen in the first two weeks of tracking) isn't
      // "new" — it's the whole backlog — so exclude it.
      const ramp = await sql`
        SELECT FLOOR((w.week_start - l.first_seen::date) / 7.0)::int AS wk,
          ROUND(100.0 * SUM(w.eff_occ / 100.0 * w.covered_nights)
                / NULLIF(SUM(w.covered_nights), 0), 1)::float AS occ,
          COUNT(DISTINCT w.listing_id)::int AS n
        FROM str_listings_weekly w
        JOIN str_listings l USING (listing_id)
        WHERE l.first_seen >= (SELECT MIN(first_seen) FROM str_listings) + INTERVAL '14 days'
          AND l.first_seen >= CURRENT_DATE - INTERVAL '26 weeks'
          AND w.week_start >= l.first_seen::date
          AND w.week_start + 6 <= (SELECT todate_end FROM sync_meta WHERE id = 1)
        GROUP BY 1 HAVING COUNT(DISTINCT w.listing_id) >= 20
        ORDER BY 1 ASC
      `;

      const churn = await sql`
        WITH t0 AS (SELECT MIN(first_seen)::date + 14 AS cut FROM str_listings)
        SELECT m, SUM(added)::int AS added, SUM(removed)::int AS removed FROM (
          SELECT to_char(first_seen, 'YYYY-MM') AS m, 1 AS added, 0 AS removed
          FROM str_listings, t0 WHERE first_seen::date >= t0.cut
          UNION ALL
          SELECT to_char(last_seen, 'YYYY-MM'), 0, 1
          FROM str_listings, t0 WHERE is_active IS NOT TRUE AND last_seen::date >= t0.cut
        ) x GROUP BY m ORDER BY m ASC
      `;

      // Aggregate the weekly rows into per-district current / baseline.
      const allWeeks = [...new Set(weeks.map((w) => w.week_start as string))].sort();
      const recent = new Set(allWeeks.slice(-4));
      const prior = new Set(allWeeks.slice(-8, -4));
      const byDistrict = new Map<string, { name: string; rows: postgres.Row[] }>();
      for (const w of weeks) {
        const e: { name: string; rows: postgres.Row[] } =
          byDistrict.get(w.area_id) ?? { name: w.name_en, rows: [] };
        e.rows.push(w);
        byDistrict.set(w.area_id, e);
      }
      const supplyBy = new Map(supply.map((s) => [s.district, s]));
      const absorptionBy = new Map(absorption.map((a) => [a.district, a.absorbed as number]));

      const raw = [...byDistrict.entries()].map(([areaId, { name, rows }]) => {
        const cur = rows.filter((r) => recent.has(r.week_start));
        const prev = rows.filter((r) => prior.has(r.week_start));
        const mean = (xs: Array<number | null>) => {
          const v = xs.filter((x): x is number => x != null);
          return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
        };
        const sum = (xs: Array<number | null>) => {
          const v = xs.filter((x): x is number => x != null);
          return v.length ? v.reduce((s, x) => s + x, 0) : null;
        };
        const curBookings = sum(cur.map((r) => r.bookings));
        const prevBookings = sum(prev.map((r) => r.bookings));
        const s = supplyBy.get(name);
        return {
          areaId,
          district: name,
          listings: cur.at(-1)?.listing_count ?? null,
          effOcc: mean(cur.map((r) => r.eff_occ)),
          revpar: mean(cur.map((r) => r.revpar)),
          bookingsGrowth:
            curBookings != null && prevBookings != null && prevBookings > 0
              ? Math.round((1000 * (curBookings - prevBookings)) / prevBookings) / 10
              : null,
          newListings90d: s?.new_n ?? null,
          delisted90d: s?.gone_n ?? null,
          absorption90d: absorptionBy.get(name) ?? null,
        };
      });

      // Composite score: min-max normalise each input across districts,
      // blend with the v1 weights, scale to 0–100.
      const norm = (v: number | null, all: Array<number | null>): number | null => {
        const xs = all.filter((x): x is number => x != null);
        if (v == null || xs.length < 2) return null;
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        return hi > lo ? (v - lo) / (hi - lo) : 0.5;
      };
      const districts: DistrictHealthRow[] = raw
        .map((d) => {
          const occN = norm(d.effOcc, raw.map((x) => x.effOcc));
          const revN = norm(d.revpar, raw.map((x) => x.revpar));
          const groN = norm(d.bookingsGrowth, raw.map((x) => x.bookingsGrowth));
          const absN = norm(d.absorption90d, raw.map((x) => x.absorption90d));
          const parts: Array<[number | null, number]> = [
            [occN, SCORE_WEIGHTS.occ],
            [revN, SCORE_WEIGHTS.revpar],
            [groN, SCORE_WEIGHTS.growth],
            [absN, SCORE_WEIGHTS.absorption],
          ];
          const have = parts.filter(([v]) => v != null) as Array<[number, number]>;
          const wTot = have.reduce((s, [, w]) => s + w, 0);
          const score = wTot > 0 ? Math.round((100 * have.reduce((s, [v, w]) => s + v * w, 0)) / wTot) : null;
          return {
            ...d,
            effOcc: d.effOcc != null ? Math.round(d.effOcc * 10) / 10 : null,
            revpar: d.revpar != null ? Math.round(d.revpar) : null,
            score,
          };
        })
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

      return {
        source: "live",
        districts,
        rampUp: ramp.map((r) => ({ week: r.wk, effOcc: r.occ, listings: r.n })),
        churn: churn.map((c) => ({ month: c.m, added: c.added, removed: c.removed })),
      };
    },
    demoHealth,
    "health"
  );
}

/** Rent-side snapshot (ltr_listings) — same scoping rules as sales. */
export function getRentals(
  polygon: PolygonCoords | null,
  areaId?: string | null,
  f: Filters = DEFAULT_FILTERS
): Promise<RentalStats> {
  return tryLive<RentalStats>(
    async (sql) => {
      const { where: geo } = await saleScope(sql, polygon, areaId, f);
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

// Demo ROI rows — values mirror real medians from the 12 Jul 2026 backfill
// so demo mode tells the same story as live.
function demoDeal(i: number, over: Partial<DealRow>): DealRow {
  return {
    id: `demo-${i}`,
    title: "2-bedroom apartment for sale",
    url: null,
    price: 240000,
    bedrooms: 2,
    sizeM2: 85,
    strYield: 9.5,
    strRevenue: 22800,
    ltrYield: 5.5,
    ltrRent: 1100,
    breakEven: 9.2,
    parity: 52,
    compCount: 24,
    compAdr: 120,
    compOcc: 58,
    dom: 41,
    domCensored: false,
    priceChangePct: null,
    nDrops: null,
    ...over,
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
    strYieldMedian: 8.4,
    ltrYieldMedian: 5.3,
    strRevenueMedian: 32200,
    ltrRentMedian: 1900,
    breakEvenMedian: 8.8,
    parityMedian: 52.9,
    domAvg: 55,
    domCensoredShare: 52.9,
    cutsCount: 187,
    cutsMedianPct: -5.1,
    screener: [
      demoDeal(1, { title: "1-bed apartment, Kato Paphos", price: 139000, strYield: 14.8, strRevenue: 20500, breakEven: 7.4, parity: 44, compCount: 88, compAdr: 96, compOcc: 64, dom: 33 }),
      demoDeal(2, { title: "2-bed apartment, Protaras", price: 185000, strYield: 13.2, strRevenue: 24400, breakEven: 8.1, parity: 47, compCount: 51, compAdr: 128, compOcc: 61, dom: 27 }),
      demoDeal(3, { title: "Studio, Larnaca centre", price: 98000, bedrooms: 0, sizeM2: 42, strYield: 12.6, strRevenue: 12300, ltrRent: 750, breakEven: 9.8, parity: 49, compCount: 33, compAdr: 74, compOcc: 57, dom: 61, domCensored: true }),
      demoDeal(4, { title: "3-bed townhouse, Peyia", price: 265000, bedrooms: 3, sizeM2: 128, strYield: 11.9, strRevenue: 31500, ltrRent: 1350, breakEven: 8.7, parity: 51, compCount: 19, compAdr: 142, compOcc: 59, dom: 48 }),
      demoDeal(5, { title: "2-bed maisonette, Paralimni", price: 172000, strYield: 11.1, strRevenue: 19100, breakEven: 9.3, parity: 53, compCount: 27, dom: 39 }),
      demoDeal(6, { title: "1-bed apartment, Limassol", price: 210000, bedrooms: 1, strYield: 10.4, strRevenue: 21800, ltrRent: 1250, breakEven: 8.9, parity: 56, compCount: 64, compAdr: 118, compOcc: 62, dom: 22 }),
    ],
    movers: [
      demoDeal(7, { title: "3-bed villa, Coral Bay", price: 495000, bedrooms: 3, sizeM2: 165, strYield: 7.8, priceChangePct: -14.6, nDrops: 3, dom: 118, domCensored: true }),
      demoDeal(8, { title: "2-bed apartment, Oroklini", price: 168000, priceChangePct: -11.2, nDrops: 2, dom: 94 }),
      demoDeal(9, { title: "4-bed house, Emba", price: 340000, bedrooms: 4, sizeM2: 190, priceChangePct: -9.8, nDrops: 2, dom: 87, domCensored: true }),
      demoDeal(10, { title: "1-bed apartment, Ayia Napa", price: 155000, bedrooms: 1, priceChangePct: -8.3, nDrops: 1, dom: 64 }),
    ],
  };
}

function demoBehavior(): PricingBehavior {
  return {
    scope: "Cyprus",
    months: [
      { month: "2026-05", nDates: 14210, nListings: 4820, pctCut10: 27.4, pctCut20: 12.1, medCutDepth: -18.2, convCut: 47.9, convHold: 35.2, staticShare: 3.9 },
      { month: "2026-06", nDates: 15080, nListings: 5010, pctCut10: 30.1, pctCut20: 15.3, medCutDepth: -19.6, convCut: 49.4, convHold: 37.8, staticShare: 3.6 },
      { month: "2026-07", nDates: 15890, nListings: 5140, pctCut10: 32.9, pctCut20: 17.8, medCutDepth: -20.9, convCut: 51.1, convHold: 39.0, staticShare: 3.4 },
    ],
  };
}

function demoEarlyBird(): EarlyBirdBucket[] {
  return [
    { bucket: "0–7 days", n: 21400, medPrice: 102 },
    { bucket: "8–14 days", n: 9800, medPrice: 108 },
    { bucket: "15–30 days", n: 12600, medPrice: 114 },
    { bucket: "1–2 months", n: 14900, medPrice: 121 },
    { bucket: "2–3 months", n: 10200, medPrice: 128 },
    { bucket: "3–5 months", n: 11800, medPrice: 133 },
    { bucket: "5+ months", n: 7200, medPrice: 139 },
  ];
}

function demoPace(): PaceData {
  // Lead-time ladder & district figures mirror the published real medians.
  const mkPickup = (weeksAhead: number, monday: Date) => {
    const stayWeek = monday.toISOString().slice(0, 10);
    const points: Array<{ daysOut: number; otb: number }> = [];
    for (let d = 110; d >= weeksAhead * 7; d -= 4) {
      const progress = Math.max(0, 1 - d / 120);
      points.push({ daysOut: d, otb: Math.round((10 + 55 * Math.pow(progress, 1.6)) * 10) / 10 });
    }
    return { stayWeek, points };
  };
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const plus = (w: number) => new Date(monday.getTime() + w * 7 * 86400000);
  const ym = (offset: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return d.toISOString().slice(0, 7);
  };
  return {
    source: "demo",
    scope: "Cyprus",
    pickupScope: "Cyprus",
    bookingsThrough: now.toISOString(),
    leadTimeByMonth: [
      { month: ym(-2), medianLead: 6, nights: 182000 },
      { month: ym(-1), medianLead: 11, nights: 240000 },
      { month: ym(0), medianLead: 25, nights: 210000 },
      { month: ym(1), medianLead: 65, nights: 96000 },
      { month: ym(2), medianLead: 95, nights: 71000 },
      { month: ym(3), medianLead: 123, nights: 40000 },
      { month: ym(4), medianLead: 151, nights: 12000 },
    ],
    leadTimeByDistrict: [
      { district: "Famagusta District", medianLead: 62, nights: 84000 },
      { district: "Paphos District", medianLead: 60, nights: 118000 },
      { district: "Larnaca District", medianLead: 52, nights: 76000 },
      { district: "Limassol District", medianLead: 41, nights: 61000 },
      { district: "Nicosia District", medianLead: 26, nights: 38000 },
    ],
    bookingWindow: [
      { daysOut: 0, cumShare: 100 },
      { daysOut: 3, cumShare: 91 },
      { daysOut: 7, cumShare: 82 },
      { daysOut: 14, cumShare: 70 },
      { daysOut: 21, cumShare: 62 },
      { daysOut: 30, cumShare: 54 },
      { daysOut: 45, cumShare: 44 },
      { daysOut: 60, cumShare: 36 },
      { daysOut: 90, cumShare: 24 },
      { daysOut: 120, cumShare: 15 },
      { daysOut: 150, cumShare: 9 },
      { daysOut: 180, cumShare: 5 },
    ],
    stayMix: [
      { month: ym(-2), n: 20400, short: 24, week: 55, mid: 13, month28: 8 },
      { month: ym(-1), n: 24100, short: 22, week: 58, mid: 12, month28: 8 },
      { month: ym(0), n: 21800, short: 19, week: 62, mid: 12, month28: 7 },
      { month: ym(1), n: 8900, short: 15, week: 66, mid: 13, month28: 6 },
      { month: ym(2), n: 6100, short: 17, week: 61, mid: 14, month28: 8 },
    ],
    midTermShare: 12.4,
    medianStay: 8,
    pickup: [mkPickup(2, plus(2)), mkPickup(5, plus(5)), mkPickup(9, plus(9))],
  };
}

function demoHealth(): AreaHealth {
  return {
    source: "demo",
    districts: [
      { areaId: "D3", district: "Famagusta District", score: 86, listings: 2900, effOcc: 71.2, revpar: 96, bookingsGrowth: 12.4, newListings90d: 210, delisted90d: 88, absorption90d: 64.2 },
      { areaId: "D6", district: "Paphos District", score: 74, listings: 4100, effOcc: 66.8, revpar: 84, bookingsGrowth: 9.1, newListings90d: 320, delisted90d: 140, absorption90d: 58.7 },
      { areaId: "D4", district: "Larnaca District", score: 58, listings: 2400, effOcc: 61.3, revpar: 71, bookingsGrowth: 7.7, newListings90d: 180, delisted90d: 95, absorption90d: 52.1 },
      { areaId: "D5", district: "Limassol District", score: 45, listings: 2800, effOcc: 57.9, revpar: 88, bookingsGrowth: 3.2, newListings90d: 240, delisted90d: 130, absorption90d: 47.5 },
      { areaId: "D1", district: "Nicosia District", score: 22, listings: 1100, effOcc: 49.4, revpar: 41, bookingsGrowth: 1.8, newListings90d: 90, delisted90d: 60, absorption90d: 41.3 },
    ],
    rampUp: [
      { week: 0, effOcc: 12.1, listings: 240 },
      { week: 1, effOcc: 18.9, listings: 236 },
      { week: 2, effOcc: 25.6, listings: 231 },
      { week: 3, effOcc: 31.2, listings: 224 },
      { week: 4, effOcc: 36.8, listings: 216 },
      { week: 5, effOcc: 41.0, listings: 202 },
      { week: 6, effOcc: 44.9, listings: 187 },
      { week: 7, effOcc: 47.3, listings: 168 },
      { week: 8, effOcc: 49.8, listings: 141 },
      { week: 9, effOcc: 51.2, listings: 118 },
      { week: 10, effOcc: 52.4, listings: 96 },
    ],
    churn: [
      { month: "2026-04", added: 310, removed: 140 },
      { month: "2026-05", added: 420, removed: 190 },
      { month: "2026-06", added: 380, removed: 230 },
      { month: "2026-07", added: 150, removed: 90 },
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
