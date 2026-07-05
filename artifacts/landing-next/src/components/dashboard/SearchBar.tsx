"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import type { DashboardSummary, Selection } from "@/lib/dashboard/types";
import { groupAreas } from "@/lib/dashboard/areas";
import { UI } from "./tokens";

interface Entry {
  label: string;
  sub?: string; // parent name for children
  slugs: string[];
  count: number;
  lat: number;
  lng: number;
  zoom: number;
}

/** Glass search bar over the map: pick an area/sub-area → zoom + scope everything. */
export default function SearchBar({
  summary,
  selection,
  onSelect,
}: {
  summary: DashboardSummary | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    if (!summary) return [];
    const bySlug = new Map(summary.areas.map((a) => [a.slug, a]));
    const out: Entry[] = [];
    for (const g of groupAreas(summary.areas)) {
      const members = g.children
        .map((c) => bySlug.get(c.slug))
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (!members.length) continue;
      const w = members.reduce((s, m) => s + m.count, 0);
      out.push({
        label: g.parent,
        slugs: g.children.map((c) => c.slug),
        count: g.count,
        lat: members.reduce((s, m) => s + m.lat * m.count, 0) / w,
        lng: members.reduce((s, m) => s + m.lng * m.count, 0) / w,
        zoom: 11,
      });
      if (g.children.length > 1) {
        for (const c of g.children) {
          const m = bySlug.get(c.slug);
          if (!m) continue;
          out.push({
            // "Paphos · Paphos" reads as a bug — the catch-all child shows as "Other".
            label: c.label === g.parent ? "Other" : c.label,
            sub: g.parent,
            slugs: [c.slug],
            count: c.count,
            lat: m.lat,
            lng: m.lng,
            zoom: 13,
          });
        }
      }
    }
    return out;
  }, [summary]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 10);
    return entries
      .filter((e) => e.label.toLowerCase().includes(q) || e.sub?.toLowerCase().includes(q))
      .slice(0, 10);
  }, [entries, query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (e: Entry) => {
    onSelect({ kind: "area", slugs: e.slugs, label: e.sub ? `${e.sub} · ${e.label}` : e.label, lat: e.lat, lng: e.lng, zoom: e.zoom });
    setQuery("");
    setOpen(false);
  };

  const activeLabel =
    selection.kind === "area" ? selection.label : selection.kind === "polygon" ? "Custom drawn area" : null;

  return (
    <div ref={boxRef} className="relative w-[340px] max-w-[calc(100vw-120px)]">
      <div className="glass-dark rounded-xl flex items-center gap-2.5 px-3.5 h-11">
        <Search size={15} style={{ color: UI.green }} className="shrink-0" />
        {activeLabel && !open ? (
          <button
            className="flex-1 flex items-center justify-between gap-2 text-left"
            onClick={() => setOpen(true)}
          >
            <span className="text-sm font-semibold truncate" style={{ color: UI.text }}>
              {activeLabel}
            </span>
          </button>
        ) : (
          <input
            value={query}
            autoFocus={open && !!activeLabel}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length) pick(results[0]);
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search area or sub-area…"
            className="flex-1 bg-transparent outline-none text-sm font-medium"
            style={{ color: UI.text }}
          />
        )}
        {(activeLabel || query) && (
          <button
            onClick={() => {
              onSelect({ kind: "all" });
              setQuery("");
              setOpen(false);
            }}
            className="shrink-0 p-1 rounded-md hover:bg-white/10 transition-colors"
            aria-label="Clear selection"
          >
            <X size={13} style={{ color: UI.muted }} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-12 left-0 right-0 glass-dark rounded-xl overflow-hidden py-1.5 max-h-[320px] overflow-y-auto ps-scroll">
          {results.map((e) => (
            <button
              key={e.slugs.join(",")}
              onClick={() => pick(e)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-white/[0.07] transition-colors"
            >
              <MapPin size={13} style={{ color: e.sub ? UI.oliveLight : UI.green }} className="shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block" style={{ color: UI.text }}>
                  {e.sub ? `${e.sub} · ${e.label}` : e.label}
                </span>
              </span>
              <span className="text-xs shrink-0" style={{ color: UI.faint }}>
                {e.count.toLocaleString("en-GB")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
