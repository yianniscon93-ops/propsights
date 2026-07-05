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

export interface DashboardSummary {
  source: "live" | "demo";
  totalListings: number;
  areas: Array<{ slug: string; count: number }>;
  todateStart: string;
  todateEnd: string;
  fwdEnd: string;
  lastRunAt: string | null;
}

/** [lat, lng] vertices of a drawn polygon (unclosed; ≥ 3 points). */
export type PolygonCoords = Array<[number, number]>;
