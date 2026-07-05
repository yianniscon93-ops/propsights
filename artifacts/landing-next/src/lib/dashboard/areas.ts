/**
 * Product-side area naming for the serving layer's flat `area` slugs
 * (e.g. "kokkinochoria_other", "nicosia_downtown"). The proper fix is an
 * areas dimension table published by data engineering; until then this
 * mapping owns display names and the area → sub-area hierarchy.
 */

export interface AreaInfo {
  label: string; // display name of this slug
  parent: string; // top-level area it belongs to
}

export const AREA_INFO: Record<string, AreaInfo> = {
  limassol_other: { label: "Limassol", parent: "Limassol" },
  pissouri_other: { label: "Pissouri", parent: "Limassol" },
  paphos_other: { label: "Paphos", parent: "Paphos" },
  paphos_coast_other: { label: "Paphos Coast", parent: "Paphos" },
  droushia_other: { label: "Droushia", parent: "Paphos" },
  polis_latchi_other: { label: "Polis & Latchi", parent: "Paphos" },
  larnaca_other: { label: "Larnaca", parent: "Larnaca" },
  ayia_napa_other: { label: "Ayia Napa", parent: "Ayia Napa" },
  kokkinochoria_other: { label: "Kokkinochoria", parent: "Kokkinochoria" },
  nicosia_other: { label: "Nicosia (other)", parent: "Nicosia" },
  nicosia_downtown: { label: "Downtown", parent: "Nicosia" },
  nicosia_suburbs_other: { label: "Suburbs", parent: "Nicosia" },
  nicosia_east_other: { label: "East", parent: "Nicosia" },
  aglantzia: { label: "Aglantzia", parent: "Nicosia" },
  akropoli: { label: "Akropoli", parent: "Nicosia" },
  agioi_omologites: { label: "Agioi Omologites", parent: "Nicosia" },
  agios_antonios: { label: "Agios Antonios", parent: "Nicosia" },
  troodos_other: { label: "Troodos", parent: "Troodos" },
  south_coast_other: { label: "South Coast", parent: "South Coast" },
};

/** Fallback for slugs not in the mapping (new syncs, demo data). */
export function prettifySlug(slug: string): string {
  return slug
    .replace(/_other$/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function areaLabel(slug: string): string {
  const info = AREA_INFO[slug];
  if (!info) return prettifySlug(slug);
  return info.parent === info.label ? info.label : `${info.parent} · ${info.label}`;
}

export interface AreaGroup {
  parent: string;
  children: Array<{ slug: string; label: string; count: number }>;
  count: number;
}

/** Group live slug counts into the parent/sub-area hierarchy for the filter UI. */
export function groupAreas(counts: Array<{ slug: string; count: number }>): AreaGroup[] {
  const byParent = new Map<string, AreaGroup>();
  for (const { slug, count } of counts) {
    const info = AREA_INFO[slug] ?? { label: prettifySlug(slug), parent: prettifySlug(slug) };
    let g = byParent.get(info.parent);
    if (!g) {
      g = { parent: info.parent, children: [], count: 0 };
      byParent.set(info.parent, g);
    }
    g.children.push({ slug, label: info.label, count });
    g.count += count;
  }
  for (const g of byParent.values()) g.children.sort((a, b) => b.count - a.count);
  return [...byParent.values()].sort((a, b) => b.count - a.count);
}
