import type { TypeGroup } from "./format";

export type OccMetric = "eff" | "raw";
export type OccWindow = "todate" | "fwd60";

export interface OccFields {
  effOccTodate: number | null;
  effOccFwd60: number | null;
  rawOccTodate: number | null;
  rawOccFwd60: number | null;
}

export function occOf(x: OccFields, metric: OccMetric, window: OccWindow): number | null {
  if (metric === "eff") return window === "todate" ? x.effOccTodate : x.effOccFwd60;
  return window === "todate" ? x.rawOccTodate : x.rawOccFwd60;
}

/** Slim row for map dots — keep the payload small (up to ~15k rows). */
export interface PointRow extends OccFields {
  id: string;
  lat: number;
  lng: number;
}

/** Full row for the hover card / top-listings list. No external URLs (product decision). */
export interface ListingDetail extends OccFields {
  id: string;
  name: string;
  areaSlug: string;
  /** Display name from the serving layer (area_label) — preferred over areaSlug. */
  areaLabel?: string | null;
  lat: number;
  lng: number;
  propertyType: string | null;
  roomType: string | null;
  bedrooms: number | null;
  beds: number | null;
  sizeSqm: number | null;
  rating: number | null;
  reviewCount: number | null;
  nightlyRate: number | null;
  isSuperhost: boolean;
  isGuestFav: boolean;
  bookings30d: number | null;
  totalBookings: number | null;
  proximityBeachMin: number | null;
  proximityCenterMin: number | null;
  amenities: string[]; // whitelisted amenity keys that are true
}

export interface WeeklyPoint {
  weekStart: string; // ISO date, Monday
  effOcc: number | null;
  rawOcc: number | null;
  medianAdr: number | null;
  listingCount: number | null;
}

/** Aggregates for the current selection (whole market or drawn polygon). */
export interface SelectionStats {
  source: "live" | "demo";
  listingCount: number;
  effOccTodate: number | null;
  effOccFwd60: number | null;
  rawOccTodate: number | null;
  rawOccFwd60: number | null;
  medianRate: number | null;
  avgRate: number | null;
  superhostShare: number | null; // 0–100
  typeMix: Array<{ group: TypeGroup; count: number }>;
  weekly: WeeklyPoint[];
  topListings: ListingDetail[];
}

export interface PricingData {
  source: "live" | "demo";
  /**
   * Median nightly price by future calendar date. The live pricing
   * calendar is sampled (2–3 dates/week, ~6 months deep), so points are
   * not daily.
   */
  forwardCurve: Array<{
    date: string;
    medianPrice: number | null;
    listings: number;
    p25?: number | null;
    p75?: number | null;
  }>;
  /** Nightly-rate histogram in €25 bins; the last bin aggregates 500+. */
  distribution: Array<{ binStart: number; count: number }>;
  /** Median forward price by calendar month ("2026-07"). */
  byMonth: Array<{ month: string; medianPrice: number | null }>;
  /** With/without splits for headline amenities (suppressed when < 20 each side). */
  premiums?: AmenityPremium[];
  /** Median current rate per bedroom count (today). */
  byBedrooms?: Array<{ label: string; count: number; medianRate: number | null }>;
  /** Median effective occupancy per €50 rate band (today) — the sweet-spot chart. */
  occByPrice?: Array<{ binStart: number; count: number; medianOcc: number | null }>;
}

export interface DashboardSummary {
  source: "live" | "demo";
  totalListings: number;
  areas: Array<{ slug: string; count: number; lat: number; lng: number }>;
  todateStart: string;
  todateEnd: string;
  fwdEnd: string;
  lastRunAt: string | null;
}

/** [lat, lng] vertices of a drawn polygon (unclosed; ≥ 3 points). */
export type PolygonCoords = Array<[number, number]>;

// ---------------------------------------------------------------------------
// Data-contract types (Data.Noesis contract, 11 Jul 2026)
// ---------------------------------------------------------------------------

export type AreaType =
  | "country"
  | "district"
  | "municipality"
  | "community"
  | "quarter"
  | "parish"
  | "tourist_area";

/** One row of dim_areas — the named-area dimension owned by data eng. */
export interface AreaInfo {
  areaId: string;
  nameEn: string;
  nameEl: string | null;
  areaType: AreaType;
  district: string | null;
  parentId: string | null;
  lat: number | null;
  lng: number | null;
  radiusKm: number | null;
  listingCount: number;
}

/** One active selection scopes the map focus and every tab below it. */
export type Selection =
  | { kind: "all" }
  | { kind: "area"; area: AreaInfo }
  | { kind: "polygon"; coords: PolygonCoords };

/** One week of market metrics (path A or re-aggregated path B). */
export interface WeeklyRow {
  weekStart: string; // Monday, ISO date
  listings: number | null;
  effOcc: number | null; // 0–100
  medianAdr: number | null;
  avgAdr: number | null;
  revpar: number | null; // effOcc/100 × avgAdr
  bookings: number | null;
  revenueEst: number | null; // path A only — modelled, label "est."
}

export interface BenchmarkSeries {
  id: string; // area_id or "island"
  label: string;
  weekly: WeeklyRow[];
}

/** Current-state snapshot over the selection (does NOT follow the week picker). */
export interface MarketSnapshot {
  listings: number;
  adrQuartiles: [number, number, number] | null; // p25 / median / p75
  occQuartiles: [number, number, number] | null;
  superhostShare: number | null;
  bedrooms: Array<{ label: string; count: number }>;
  typeMix: Array<{ group: TypeGroup; count: number }>;
  /** share = % of listings in selection that have the amenity (0–100). */
  amenities: Array<{ key: string; share: number }>;
}

export interface MarketResponse {
  source: "live" | "demo";
  path: "area" | "listing"; // contract path A / path B
  /** True when attribute filters were ignored (quarter/parish selection). */
  filtersIgnored: boolean;
  weekly: WeeklyRow[];
  /** District + island series, same filters as the selection. */
  benchmarks: BenchmarkSeries[];
  /** Null when the selection can't be resolved to listings (quarter/parish). */
  snapshot: MarketSnapshot | null;
}

export interface MarketRequest {
  selection:
    | { kind: "all" }
    | { kind: "area"; areaId: string }
    | { kind: "polygon"; coords: PolygonCoords };
  filters: Record<string, unknown>;
  weekStart: string;
  weekEnd: string;
}

/** Amenity premium split (pricing tab): with vs without an amenity. */
export interface AmenityPremium {
  key: string;
  withCount: number;
  withoutCount: number;
  withMedianRate: number | null;
  withoutMedianRate: number | null;
  withMedianOcc: number | null;
  withoutMedianOcc: number | null;
}

/** Buy-side (sale_listings) snapshot — polygon or island only for now. */
export interface InvestStats {
  source: "live" | "demo";
  supply: number;
  priceQuartiles: [number, number, number] | null;
  eurPerM2Median: number | null;
  byBedrooms: Array<{ label: string; count: number; medianPrice: number | null }>;
}

/** Rent-side (ltr_listings) snapshot — polygon or island only for now. */
export interface RentalStats {
  source: "live" | "demo";
  supply: number;
  rentQuartiles: [number, number, number] | null;
  byBedrooms: Array<{ label: string; count: number; medianRent: number | null }>;
}
