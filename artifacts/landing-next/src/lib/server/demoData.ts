import { AREA_DATA } from "@/lib/areaData";
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
import { classifyType, type TypeGroup } from "@/lib/dashboard/format";

/**
 * Deterministic demo dataset used when DATABASE_URL is not configured.
 * Shapes mirror the live serving-layer queries exactly; numbers derive
 * from the landing page's AREA_DATA so demo and marketing copy agree.
 */

const TODATE_START = "2026-04-01";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

const TYPES: Array<{ type: string; weight: number; beds: [number, number]; mult: number }> = [
  { type: "Apartment", weight: 0.5, beds: [1, 3], mult: 1.0 },
  { type: "Villa", weight: 0.2, beds: [2, 5], mult: 1.55 },
  { type: "Studio", weight: 0.16, beds: [1, 1], mult: 0.72 },
  { type: "Home", weight: 0.14, beds: [2, 4], mult: 1.25 },
];

const NAME_A = ["Seafront", "Coastal", "Sunset", "Harbour", "Old Town", "Hillside", "Garden", "Marina", "Palm", "Stone"];
const NAME_B = ["Apartment", "Villa", "Retreat", "Suites", "Residence", "Escape", "House", "Studio", "Loft", "Haven"];

// Amenity base probabilities; villas skew outdoor-heavy.
const AMENITY_P: Record<string, number> = {
  has_sea_view: 0.28, has_beach_view: 0.12, has_mountain_view: 0.18, has_city_view: 0.2,
  has_garden_view: 0.22, has_pool: 0.32, has_hot_tub: 0.08, has_patio_or_balcony: 0.62,
  has_backyard: 0.18, has_garden: 0.2, has_bbq: 0.22, has_outdoor_furniture: 0.5,
  has_beach_access: 0.1, has_crib: 0.25, has_high_chair: 0.24, is_pet_friendly: 0.15,
  has_workspace: 0.45, has_fast_wifi: 0.38, long_term_stays_allowed: 0.55,
  has_free_parking: 0.6, has_ev_charger: 0.05, has_gym: 0.09,
};

// Monthly seasonality multiplier, Jan..Dec (Cyprus STR curve).
const SEASON = [0.62, 0.66, 0.74, 0.85, 0.95, 1.06, 1.16, 1.18, 1.04, 0.9, 0.72, 0.66];

function pickType(rand: () => number) {
  const x = rand();
  let acc = 0;
  for (const t of TYPES) {
    acc += t.weight;
    if (x <= acc) return t;
  }
  return TYPES[0];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOnOrBefore(d: Date): Date {
  const out = new Date(d);
  const day = (out.getUTCDay() + 6) % 7; // Mon = 0
  out.setUTCDate(out.getUTCDate() - day);
  return out;
}

const slugify = (name: string) => name.toLowerCase().replace(/\s+/g, "_");

interface DemoStore {
  listings: ListingDetail[];
  byId: Map<string, ListingDetail>;
  weekly: Map<string, WeeklyPoint[]>; // by area slug
  summary: DashboardSummary;
}

let store: DemoStore | null = null;

function build(): DemoStore {
  const listings: ListingDetail[] = [];
  const weekly = new Map<string, WeeklyPoint[]>();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const fwdEnd = new Date(now.getTime() + 59 * 86400000);
  const summerBoost = SEASON[now.getUTCMonth()];

  let idCounter = 100000;

  for (const [areaName, base] of Object.entries(AREA_DATA)) {
    const slug = slugify(areaName);
    const rand = mulberry32(hash(areaName));
    // Landing credibility strip claims 3,400+ listings; AREA_DATA sums to
    // ~2,450, so scale counts up to keep the two stories consistent.
    const count = Math.round(base.listings * 1.4);

    for (let i = 0; i < count; i++) {
      const t = pickType(rand);
      const beds = t.beds[0] + Math.floor(rand() * (t.beds[1] - t.beds[0] + 1));
      const rate = Math.round(base.rate * t.mult * (0.72 + rand() * 0.8));
      const effTodate = clamp(base.occupancy + (rand() - 0.5) * 34, 8, 98);
      const rawTodate = clamp(effTodate + 4 + rand() * 14, effTodate, 100);
      const effFwd = clamp(effTodate * (0.82 + rand() * 0.3) * clamp(summerBoost, 0.8, 1.15), 4, 98);
      const rawFwd = clamp(effFwd + 5 + rand() * 16, effFwd, 100);
      const hasRating = rand() > 0.12;
      const isVilla = t.type === "Villa" || t.type === "Home";
      const amenities = AMENITIES.filter((a) => {
        let p = AMENITY_P[a.key] ?? 0.1;
        if (isVilla && ["has_pool", "has_backyard", "has_garden", "has_bbq"].includes(a.key)) p += 0.3;
        return rand() < p;
      }).map((a) => a.key);

      listings.push({
        id: String(idCounter++),
        name: `${NAME_A[Math.floor(rand() * NAME_A.length)]} ${NAME_B[Math.floor(rand() * NAME_B.length)]}`,
        areaSlug: slug,
        lat: base.lat + (rand() - 0.5) * 0.075,
        lng: base.lng + (rand() - 0.5) * 0.095,
        propertyType: t.type,
        roomType: rand() < 0.94 ? "Entire place" : "Private room",
        bedrooms: beds,
        beds: beds + (rand() < 0.4 ? 1 : 0),
        sizeSqm: Math.round(35 + beds * 28 + rand() * 40),
        rating: hasRating ? r1(4.1 + rand() * 0.9) : null,
        reviewCount: hasRating ? Math.floor(rand() * 220) : 0,
        nightlyRate: rate,
        isSuperhost: rand() < 0.2,
        isGuestFav: rand() < 0.19,
        effOccTodate: r1(effTodate),
        effOccFwd60: r1(effFwd),
        rawOccTodate: r1(rawTodate),
        rawOccFwd60: r1(rawFwd),
        bookings30d: Math.floor(rand() * 9),
        totalBookings: Math.floor(rand() * 40),
        proximityBeachMin: Math.round(2 + rand() * 38),
        proximityCenterMin: Math.round(2 + rand() * 30),
        amenities,
      });
    }

    // Weekly series: Mondays from the first Monday after TODATE_START
    // through the last completed week.
    const points: WeeklyPoint[] = [];
    const wrand = mulberry32(hash(areaName) ^ 0x9e3779b9);
    let wk = mondayOnOrBefore(new Date(`${TODATE_START}T00:00:00Z`));
    if (isoDate(wk) < TODATE_START) wk = new Date(wk.getTime() + 7 * 86400000);
    const lastWeek = mondayOnOrBefore(yesterday);
    while (wk <= lastWeek) {
      const season = SEASON[wk.getUTCMonth()];
      const eff = clamp(base.occupancy * season * (0.94 + wrand() * 0.12), 5, 98);
      const raw = clamp(eff + 6 + wrand() * 10, eff, 100);
      points.push({
        weekStart: isoDate(wk),
        effOcc: r1(eff),
        rawOcc: r1(raw),
        medianAdr: Math.round(base.rate * (0.85 + season * 0.2) * (0.96 + wrand() * 0.08)),
        listingCount: Math.round(base.listings * 1.4 * (0.92 + wrand() * 0.08)),
      });
      wk = new Date(wk.getTime() + 7 * 86400000);
    }
    weekly.set(slug, points);
  }

  const areaCounts = new Map<string, number>();
  for (const l of listings) areaCounts.set(l.areaSlug, (areaCounts.get(l.areaSlug) ?? 0) + 1);
  const areaCenters = new Map(
    Object.entries(AREA_DATA).map(([name, base]) => [slugify(name), base])
  );

  const summary: DashboardSummary = {
    source: "demo",
    totalListings: listings.length,
    areas: [...areaCounts.entries()]
      .map(([slug, count]) => ({
        slug,
        count,
        lat: areaCenters.get(slug)?.lat ?? 34.98,
        lng: areaCenters.get(slug)?.lng ?? 33.25,
      }))
      .sort((a, b) => b.count - a.count),
    todateStart: TODATE_START,
    todateEnd: isoDate(yesterday),
    fwdEnd: isoDate(fwdEnd),
    lastRunAt: now.toISOString(),
  };

  return { listings, byId: new Map(listings.map((l) => [l.id, l])), weekly, summary };
}

function getStore(): DemoStore {
  if (!store) store = build();
  return store;
}

function inPolygon(lat: number, lng: number, poly: PolygonCoords): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function matches(l: ListingDetail, f: Filters): boolean {
  if (f.areas.length && !f.areas.includes(l.areaSlug)) return false;
  if (f.types.length && !f.types.includes(classifyType(l.propertyType))) return false;
  if (f.minBeds > 0 && (l.bedrooms ?? 0) < f.minBeds) return false;
  if (f.priceMin != null && (l.nightlyRate ?? 0) < f.priceMin) return false;
  if (f.priceMax != null && (l.nightlyRate ?? Infinity) > f.priceMax) return false;
  if (f.superhost && !l.isSuperhost) return false;
  if (f.guestFav && !l.isGuestFav) return false;
  if (f.entireOnly && l.roomType !== "Entire place") return false;
  if (f.minRating != null && (l.rating ?? 0) < f.minRating) return false;
  if (f.beachMax != null && (l.proximityBeachMin ?? Infinity) > f.beachMax) return false;
  for (const a of f.amenities) if (!l.amenities.includes(a)) return false;
  return true;
}

function select(f: Filters, polygon: PolygonCoords | null): ListingDetail[] {
  return getStore().listings.filter(
    (l) => matches(l, f) && (!polygon || inPolygon(l.lat, l.lng, polygon))
  );
}

function aggregate(rows: ListingDetail[]): SelectionStats {
  const avg = (f: (l: ListingDetail) => number | null): number | null => {
    const vals = rows.map(f).filter((v): v is number => v != null);
    return vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const rates = rows
    .map((l) => l.nightlyRate)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  const mix = new Map<TypeGroup, number>();
  for (const l of rows) {
    const g = classifyType(l.propertyType);
    mix.set(g, (mix.get(g) ?? 0) + 1);
  }

  // Weekly: weight each area's curve by how many selected listings it contributes.
  const areaWeights = new Map<string, number>();
  for (const l of rows) areaWeights.set(l.areaSlug, (areaWeights.get(l.areaSlug) ?? 0) + 1);
  const byWeek = new Map<string, { eff: number; raw: number; adr: number; w: number }>();
  for (const [slug, w] of areaWeights) {
    for (const p of getStore().weekly.get(slug) ?? []) {
      const acc = byWeek.get(p.weekStart) ?? { eff: 0, raw: 0, adr: 0, w: 0 };
      acc.eff += (p.effOcc ?? 0) * w;
      acc.raw += (p.rawOcc ?? 0) * w;
      acc.adr += (p.medianAdr ?? 0) * w;
      acc.w += w;
      byWeek.set(p.weekStart, acc);
    }
  }
  const weekly: WeeklyPoint[] = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, acc]) => ({
      weekStart,
      effOcc: acc.w ? r1(acc.eff / acc.w) : null,
      rawOcc: acc.w ? r1(acc.raw / acc.w) : null,
      medianAdr: acc.w ? Math.round(acc.adr / acc.w) : null,
      listingCount: rows.length,
    }));

  return {
    source: "demo",
    listingCount: rows.length,
    effOccTodate: avg((l) => l.effOccTodate),
    effOccFwd60: avg((l) => l.effOccFwd60),
    rawOccTodate: avg((l) => l.rawOccTodate),
    rawOccFwd60: avg((l) => l.rawOccFwd60),
    medianRate: rates.length ? rates[Math.floor(rates.length / 2)] : null,
    avgRate: avg((l) => l.nightlyRate) != null ? Math.round(avg((l) => l.nightlyRate)!) : null,
    superhostShare: rows.length
      ? r1((100 * rows.filter((l) => l.isSuperhost).length) / rows.length)
      : null,
    typeMix: [...mix.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count),
    weekly,
    topListings: [...rows]
      .sort((a, b) => (b.effOccTodate ?? 0) - (a.effOccTodate ?? 0))
      .slice(0, 8),
  };
}

function pricingFor(rows: ListingDetail[]): PricingData {
  const rates = rows
    .map((l) => l.nightlyRate)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;

  // Mirror the live pricing calendar: sampled ~2 dates/week, ~6 months deep.
  const forwardCurve: PricingData["forwardCurve"] = [];
  const monthAcc = new Map<string, number[]>();
  if (median != null) {
    const start = new Date();
    const jitter = mulberry32(rates.length || 1);
    for (let d = 0; d < 180; d += 3) {
      const day = new Date(start.getTime() + d * 86400000);
      const season = SEASON[day.getUTCMonth()];
      const price = Math.round(median * season * (0.98 + jitter() * 0.05));
      forwardCurve.push({ date: isoDate(day), medianPrice: price, listings: rows.length });
      const month = isoDate(day).slice(0, 7);
      if (!monthAcc.has(month)) monthAcc.set(month, []);
      monthAcc.get(month)!.push(price);
    }
  }

  const bins = new Map<number, number>();
  for (const r of rates) {
    const bin = Math.min(Math.floor(r / 25), 20) * 25;
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const distribution = [...bins.entries()]
    .map(([binStart, count]) => ({ binStart, count }))
    .sort((a, b) => a.binStart - b.binStart);

  const byMonth = [...monthAcc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, vals]) => ({
      month,
      medianPrice: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
    }));

  return { source: "demo", forwardCurve, distribution, byMonth };
}

export const demo = {
  summary: (): DashboardSummary => getStore().summary,
  points: (f: Filters): PointRow[] =>
    select(f, null).map((l) => ({
      id: l.id,
      lat: l.lat,
      lng: l.lng,
      effOccTodate: l.effOccTodate,
      effOccFwd60: l.effOccFwd60,
      rawOccTodate: l.rawOccTodate,
      rawOccFwd60: l.rawOccFwd60,
    })),
  listing: (id: string): ListingDetail | null => getStore().byId.get(id) ?? null,
  stats: (f: Filters, polygon: PolygonCoords | null): SelectionStats =>
    aggregate(select(f, polygon)),
  pricing: (f: Filters, polygon: PolygonCoords | null): PricingData =>
    pricingFor(select(f, polygon)),
};
