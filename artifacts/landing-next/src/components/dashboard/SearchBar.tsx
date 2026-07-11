"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import type { AreaInfo, AreaType, Selection } from "@/lib/dashboard/types";
import { UI } from "./tokens";

const TYPE_LABEL: Record<AreaType, string> = {
  country: "Country",
  district: "District",
  municipality: "Municipality",
  community: "Community",
  quarter: "Quarter",
  parish: "Parish",
  tourist_area: "Tourist area",
};

/** Breadcrumb under a result: "Kato Paphos → Paphos District". */
function crumb(a: AreaInfo): string | null {
  if (a.areaType === "country" || a.areaType === "district") return null;
  return a.district ? `${TYPE_LABEL[a.areaType]} · ${a.district}` : TYPE_LABEL[a.areaType];
}

/**
 * Area search over dim_areas (all levels, incl. new district sub-areas).
 * Substring match on English + Greek names, ranked by listing count
 * (product decision 11 Jul 2026). Zero-listing areas are hidden.
 */
export default function SearchBar({
  areas,
  selection,
  onSelect,
}: {
  areas: AreaInfo[] | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!areas) return [];
    const pool = areas.filter((a) => a.listingCount > 0 && a.areaType !== "country");
    const q = query.trim().toLowerCase();
    const matched = q
      ? pool.filter(
          (a) =>
            a.nameEn.toLowerCase().includes(q) ||
            (a.nameEl ?? "").toLowerCase().includes(q) ||
            (a.district ?? "").toLowerCase().includes(q)
        )
      : pool;
    return [...matched].sort((a, b) => b.listingCount - a.listingCount).slice(0, 10);
  }, [areas, query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (a: AreaInfo) => {
    onSelect({ kind: "area", area: a });
    setQuery("");
    setOpen(false);
  };

  const activeLabel =
    selection.kind === "area"
      ? selection.area.nameEn
      : selection.kind === "polygon"
        ? "Custom drawn area"
        : null;

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
            placeholder="Search any area — town, resort, district…"
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
        <div className="absolute top-12 left-0 right-0 glass-dark rounded-xl overflow-hidden py-1.5 max-h-[340px] overflow-y-auto ps-scroll">
          {results.map((a) => {
            const sub = crumb(a);
            return (
              <button
                key={a.areaId}
                onClick={() => pick(a)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-white/[0.07] transition-colors"
              >
                <MapPin
                  size={13}
                  style={{ color: a.areaType === "district" ? UI.green : UI.oliveLight }}
                  className="shrink-0"
                />
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block" style={{ color: UI.text }}>
                    {a.nameEn}
                  </span>
                  {sub && (
                    <span className="text-[11px] block" style={{ color: UI.faint }}>
                      {sub}
                    </span>
                  )}
                </span>
                <span className="text-xs shrink-0" style={{ color: UI.faint }}>
                  {a.listingCount.toLocaleString("en-GB")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
