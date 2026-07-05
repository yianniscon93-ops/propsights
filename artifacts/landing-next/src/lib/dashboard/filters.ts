import type { TypeGroup } from "./format";

/** Filter state shared by the panel UI, the points query and the stats query. */
export interface Filters {
  areas: string[]; // area slugs; empty = all
  types: TypeGroup[]; // empty = all
  minBeds: number; // 0 = any
  priceMin: number | null;
  priceMax: number | null;
  superhost: boolean;
  guestFav: boolean;
  entireOnly: boolean;
  minRating: number | null; // e.g. 4.5
  beachMax: number | null; // minutes to beach
  amenities: string[]; // AMENITIES keys
}

export const DEFAULT_FILTERS: Filters = {
  areas: [],
  types: [],
  minBeds: 0,
  priceMin: null,
  priceMax: null,
  superhost: false,
  guestFav: false,
  entireOnly: false,
  minRating: null,
  beachMax: null,
  amenities: [],
};

/** Amenity flags available on str_listings (whitelist — used to build SQL). */
export const AMENITIES: Array<{ key: string; label: string; group: string }> = [
  { key: "has_sea_view", label: "Sea view", group: "Views" },
  { key: "has_beach_view", label: "Beach view", group: "Views" },
  { key: "has_mountain_view", label: "Mountain view", group: "Views" },
  { key: "has_city_view", label: "City view", group: "Views" },
  { key: "has_garden_view", label: "Garden view", group: "Views" },
  { key: "has_pool", label: "Pool", group: "Outdoor" },
  { key: "has_hot_tub", label: "Hot tub", group: "Outdoor" },
  { key: "has_patio_or_balcony", label: "Patio / balcony", group: "Outdoor" },
  { key: "has_backyard", label: "Backyard", group: "Outdoor" },
  { key: "has_garden", label: "Garden", group: "Outdoor" },
  { key: "has_bbq", label: "BBQ", group: "Outdoor" },
  { key: "has_outdoor_furniture", label: "Outdoor furniture", group: "Outdoor" },
  { key: "has_beach_access", label: "Beach access", group: "Outdoor" },
  { key: "has_crib", label: "Crib", group: "Family" },
  { key: "has_high_chair", label: "High chair", group: "Family" },
  { key: "is_pet_friendly", label: "Pet friendly", group: "Family" },
  { key: "has_workspace", label: "Workspace", group: "Work & stays" },
  { key: "has_fast_wifi", label: "Fast wifi", group: "Work & stays" },
  { key: "long_term_stays_allowed", label: "Long-term stays", group: "Work & stays" },
  { key: "has_free_parking", label: "Free parking", group: "Facilities" },
  { key: "has_ev_charger", label: "EV charger", group: "Facilities" },
  { key: "has_gym", label: "Gym", group: "Facilities" },
];

const AMENITY_KEYS = new Set(AMENITIES.map((a) => a.key));
const TYPE_VALUES = new Set<TypeGroup>(["apartment", "house", "hotel", "other"]);

export function countActive(f: Filters): number {
  let n = 0;
  if (f.areas.length) n++;
  if (f.types.length) n++;
  if (f.minBeds > 0) n++;
  if (f.priceMin != null || f.priceMax != null) n++;
  if (f.superhost) n++;
  if (f.guestFav) n++;
  if (f.entireOnly) n++;
  if (f.minRating != null) n++;
  if (f.beachMax != null) n++;
  n += f.amenities.length;
  return n;
}

export function encodeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.areas.length) p.set("areas", f.areas.join(","));
  if (f.types.length) p.set("types", f.types.join(","));
  if (f.minBeds > 0) p.set("minBeds", String(f.minBeds));
  if (f.priceMin != null) p.set("priceMin", String(f.priceMin));
  if (f.priceMax != null) p.set("priceMax", String(f.priceMax));
  if (f.superhost) p.set("superhost", "1");
  if (f.guestFav) p.set("guestFav", "1");
  if (f.entireOnly) p.set("entireOnly", "1");
  if (f.minRating != null) p.set("minRating", String(f.minRating));
  if (f.beachMax != null) p.set("beachMax", String(f.beachMax));
  if (f.amenities.length) p.set("amenities", f.amenities.join(","));
  return p.toString();
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.length) return v.split(",");
  return [];
}

/** Sanitize untrusted input (query params or JSON body) into a Filters object. */
export function parseFilters(input: Record<string, unknown> | URLSearchParams): Filters {
  const get = (k: string): unknown =>
    input instanceof URLSearchParams ? (input.get(k) ?? undefined) : input[k];
  const bool = (k: string) => {
    const v = get(k);
    return v === true || v === "1" || v === "true";
  };
  return {
    areas: list(get("areas")).slice(0, 50),
    types: list(get("types")).filter((t): t is TypeGroup => TYPE_VALUES.has(t as TypeGroup)),
    minBeds: Math.max(0, Math.min(10, num(get("minBeds")) ?? 0)),
    priceMin: num(get("priceMin")),
    priceMax: num(get("priceMax")),
    superhost: bool("superhost"),
    guestFav: bool("guestFav"),
    entireOnly: bool("entireOnly"),
    minRating: num(get("minRating")),
    beachMax: num(get("beachMax")),
    amenities: list(get("amenities")).filter((a) => AMENITY_KEYS.has(a)),
  };
}
