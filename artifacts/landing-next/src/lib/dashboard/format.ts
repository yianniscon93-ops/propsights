export function fmtEuro(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `€${v.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(1)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString("en-GB");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Occupancy → colour on the light basemap.
 * Warm sand (low) → olive (high); no cool tones.
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [40, [216, 222, 203]], // #D8DECB
  [60, [143, 163, 107]], // #8FA36B
  [80, [74, 94, 58]], // #4A5E3A
  [95, [38, 51, 28]], // #26331C
];

export function occupancyColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "#B8BFAA";
  const clamped = Math.max(STOPS[0][0], Math.min(STOPS[STOPS.length - 1][0], v));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i];
    const [b, cb] = STOPS[i + 1];
    if (clamped >= a && clamped <= b) {
      const t = (clamped - a) / (b - a);
      const rgb = ca.map((c, j) => Math.round(c + (cb[j] - c) * t));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }
  return "#4A5E3A";
}

/** Property-type groups, matched by substring against property_type. */
export type TypeGroup = "apartment" | "house" | "hotel" | "other";

export const TYPE_GROUP_WORDS: Record<Exclude<TypeGroup, "other">, string[]> = {
  apartment: ["apartment", "condo", "loft", "flat", "studio", "place to stay"],
  house: ["villa", "house", "home", "townhouse", "bungalow", "cottage", "chalet", "cabin"],
  hotel: ["hotel", "guesthouse", "bed and breakfast", "hostel"],
};

export const TYPE_GROUP_LABELS: Record<TypeGroup, string> = {
  apartment: "Apartment & Studio",
  house: "House & Villa",
  hotel: "Hotel & Guesthouse",
  other: "Other",
};

export function classifyType(propertyType: string | null): TypeGroup {
  const t = (propertyType ?? "").toLowerCase();
  for (const g of ["apartment", "house", "hotel"] as const) {
    if (TYPE_GROUP_WORDS[g].some((w) => t.includes(w))) return g;
  }
  return "other";
}
