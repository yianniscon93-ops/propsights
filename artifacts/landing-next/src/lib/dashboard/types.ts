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

/** Full row for the hover card / top-listings list. */
export interface ListingDetail extends OccFields {
  id: string;
  name: string;
  areaSlug: string;
  /** Display name from the serving layer (area_label) — preferred over areaSlug. */
  areaLabel?: string | null;
  /** Direct Airbnb listing URL from str_listings.airbnb_url — null in demo mode. */
  airbnbUrl?: string | null;
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
  /** Per-€50-rate-band medians (today) — the sweet-spot chart. medianRevpar
   * is the per-listing rate × occupancy median: € earned per available night. */
  occByPrice?: Array<{
    binStart: number;
    count: number;
    medianOcc: number | null;
    medianRevpar?: number | null;
  }>;
  /** Discounting behaviour (pricing_behavior) — district grain. */
  behavior?: PricingBehavior | null;
  /** Median nightly price paid by lead-time bucket (booking_stays). */
  earlyBird?: EarlyBirdBucket[];
}

/** One stay-month of discounting behaviour for the resolved district. */
export interface PricingBehaviorMonth {
  month: string; // "2026-07"
  nDates: number;
  nListings: number;
  pctCut10: number | null; // % of open dates cut ≥10% by T-14
  pctCut20: number | null;
  medCutDepth: number | null; // negative, e.g. -20.9
  convCut: number | null; // % of cut dates that converted
  convHold: number | null; // % of held dates that converted
  staticShare: number | null; // % of listings that never touch prices
}

export interface PricingBehavior {
  /** District label the numbers are for ("Cyprus" when island-wide). */
  scope: string;
  months: PricingBehaviorMonth[];
}

export interface EarlyBirdBucket {
  bucket: string; // "0–7 days" …
  n: number;
  medPrice: number | null; // median nightly price at booking
}

export interface DashboardSummary {
  source: "live" | "demo";
  totalListings: number;
  areas: Array<{ slug: string; count: number; lat: number; lng: number }>;
  todateStart: string;
  todateEnd: string;
  fwdEnd: string;
  lastRunAt: string | null;
  /** MAX(booking_stays.detected_at) — how fresh the demand feed is. */
  bookingsThrough: string | null;
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

/** One sale listing enriched with ROI estimates — screener / movers rows.
 * All yield figures are comp-derived estimates (compCount/compTier say how good). */
export interface DealRow {
  id: string;
  title: string;
  url: string | null;
  price: number;
  bedrooms: number | null;
  sizeM2: number | null;
  strYield: number | null; // gross, % of price
  strRevenue: number | null; // € / year, comp-modelled
  ltrYield: number | null;
  ltrRent: number | null; // € / month
  breakEven: number | null; // occupancy % where STR covers costs
  parity: number | null; // occupancy % where STR beats LTR
  compCount: number | null;
  compAdr: number | null;
  compOcc: number | null; // comp median effective occupancy %
  dom: number | null; // days on market
  domCensored: boolean; // true → show "≥"
  priceChangePct: number | null; // negative = cut
  nDrops: number | null;
}

/** Buy-side (sale_listings) snapshot — polygon or island only for now. */
export interface InvestStats {
  source: "live" | "demo";
  supply: number;
  priceQuartiles: [number, number, number] | null;
  eurPerM2Median: number | null;
  byBedrooms: Array<{ label: string; count: number; medianPrice: number | null }>;
  // ROI enrichment (backfilled 12 Jul 2026) — medians over the selection.
  strYieldMedian: number | null;
  ltrYieldMedian: number | null;
  strRevenueMedian: number | null;
  ltrRentMedian: number | null;
  breakEvenMedian: number | null;
  parityMedian: number | null;
  domAvg: number | null;
  domCensoredShare: number | null; // 0–100
  cutsCount: number | null; // active listings with observed price drops
  cutsMedianPct: number | null; // negative
  /** Top gross-yield listings with credible comps — client filters by budget. */
  screener: DealRow[];
  /** Deepest observed price cuts — motivated sellers. */
  movers: DealRow[];
}

// ---------------------------------------------------------------------------
// Booking pace (booking_stays + area_pace) — district grain.
// Lead times are lower bounds (≤2-day scrape cadence); forward months are
// right-censored (late bookers haven't booked yet).
// ---------------------------------------------------------------------------

export interface PaceData {
  source: "live" | "demo";
  /** Human label for what the booking stats cover (area/polygon + filters). */
  scope: string;
  /** area_pace is district-pre-aggregated — the pickup chart's true grain. */
  pickupScope: string;
  bookingsThrough: string | null;
  /** Night-weighted median lead time per stay month. */
  leadTimeByMonth: Array<{ month: string; medianLead: number | null; nights: number }>;
  /** Night-weighted median lead time per district, stays in the next 90 days. */
  leadTimeByDistrict: Array<{ district: string; medianLead: number | null; nights: number }>;
  /** CDF over completed recent stays: % of booked nights already on the
   * books ≥ daysOut days before arrival. */
  bookingWindow: Array<{ daysOut: number; cumShare: number }>;
  /** Stay-length mix per month — shares 0–100 by bookings. */
  stayMix: Array<{ month: string; n: number; short: number; week: number; mid: number; month28: number }>;
  midTermShare: number | null; // 15+ nights, % of stays in scope
  medianStay: number | null; // nights
  /** OTB pickup per stay week: raw unavailability by days-out (owner blocks
   * included — read the slope, not the level). */
  pickup: Array<{ stayWeek: string; points: Array<{ daysOut: number; otb: number }> }>;
}

// ---------------------------------------------------------------------------
// Area health / supply (str_listings first_seen/last_seen × booking_stays).
// ---------------------------------------------------------------------------

export interface DistrictHealthRow {
  areaId: string;
  district: string; // "Paphos District"
  /** Composite 0–100 within-table score: occ 40 / RevPAR 30 / booking
   * growth 15 / absorption 15 (v1 weights — a product decision). */
  score: number | null;
  listings: number | null;
  effOcc: number | null; // avg last 4 completed weeks
  revpar: number | null;
  bookingsGrowth: number | null; // last 4w vs prior 4w, %
  newListings90d: number | null;
  delisted90d: number | null;
  absorption90d: number | null; // % of ≤90d-old listings with ≥1 confident booking
}

export interface AreaHealth {
  source: "live" | "demo";
  districts: DistrictHealthRow[];
  /** New-listing ramp-up: occupancy by weeks since first seen. */
  rampUp: Array<{ week: number; effOcc: number | null; listings: number }>;
  /** Monthly supply churn (first full month of tracking onward). */
  churn: Array<{ month: string; added: number; removed: number }>;
}

/** Rent-side (ltr_listings) snapshot — polygon or island only for now. */
export interface RentalStats {
  source: "live" | "demo";
  supply: number;
  rentQuartiles: [number, number, number] | null;
  byBedrooms: Array<{ label: string; count: number; medianRent: number | null }>;
}
