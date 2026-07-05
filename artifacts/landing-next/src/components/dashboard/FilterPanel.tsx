"use client";

import { useMemo, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import type { DashboardSummary } from "@/lib/dashboard/types";
import { AMENITIES, countActive, DEFAULT_FILTERS, type Filters } from "@/lib/dashboard/filters";
import { TYPE_GROUP_LABELS, type TypeGroup } from "@/lib/dashboard/format";
import { groupAreas } from "@/lib/dashboard/areas";
import { UI } from "./tokens";

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[10px] font-semibold"
      style={{ background: UI.olive, color: "#FFFFFF" }}
    >
      {label}
      <button
        onClick={onClear}
        className="rounded-full p-0.5 hover:bg-white/20 transition-colors"
        aria-label={`Clear ${label}`}
      >
        <X size={10} />
      </button>
    </span>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-3 mt-3" style={{ borderColor: UI.border }}>
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setOpen(!open)}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5"
          style={{ color: UI.text }}
        >
          {title}
          {badge != null && badge > 0 && (
            <span
              className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
              style={{ background: UI.green, color: UI.bg }}
            >
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          size={13}
          style={{
            color: UI.muted,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.2s",
          }}
        />
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

function Check({
  checked,
  label,
  sub,
  onChange,
}: {
  checked: boolean;
  label: string;
  sub?: string;
  onChange: () => void;
}) {
  return (
    <button onClick={onChange} className="w-full flex items-center gap-2 py-1 group text-left">
      <span
        className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 transition-colors"
        style={{
          background: checked ? UI.green : "transparent",
          border: `1px solid ${checked ? UI.green : "rgba(255,255,255,0.25)"}`,
        }}
      >
        {checked && (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M1 4 L3 6 L7 1.5" stroke={UI.bg} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span
        className="text-[11px] flex-1 truncate transition-colors group-hover:text-white"
        style={{ color: checked ? UI.text : UI.muted }}
      >
        {label}
      </span>
      {sub && (
        <span className="text-[9px] shrink-0" style={{ color: UI.faint }}>
          {sub}
        </span>
      )}
    </button>
  );
}

const toggle = <T,>(arr: T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export default function FilterPanel({
  filters,
  onChange,
  summary,
  resultCount,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  summary: DashboardSummary | null;
  resultCount: number | null;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [expandedParents, setExpandedParents] = useState<string[]>([]);

  const areaGroups = useMemo(() => groupAreas(summary?.areas ?? []), [summary]);
  const active = countActive(filters);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const chips: Array<{ label: string; clear: () => void }> = [];
  if (filters.areas.length)
    chips.push({ label: `${filters.areas.length} area${filters.areas.length > 1 ? "s" : ""}`, clear: () => set({ areas: [] }) });
  for (const t of filters.types)
    chips.push({ label: TYPE_GROUP_LABELS[t], clear: () => set({ types: toggle(filters.types, t) }) });
  if (filters.minBeds > 0) chips.push({ label: `${filters.minBeds}+ beds`, clear: () => set({ minBeds: 0 }) });
  if (filters.priceMin != null || filters.priceMax != null)
    chips.push({
      label: `€${filters.priceMin ?? 0}–${filters.priceMax != null ? `€${filters.priceMax}` : "∞"}`,
      clear: () => set({ priceMin: null, priceMax: null }),
    });
  if (filters.superhost) chips.push({ label: "Superhost", clear: () => set({ superhost: false }) });
  if (filters.guestFav) chips.push({ label: "Guest favourite", clear: () => set({ guestFav: false }) });
  if (filters.entireOnly) chips.push({ label: "Entire place", clear: () => set({ entireOnly: false }) });
  if (filters.minRating != null)
    chips.push({ label: `★ ${filters.minRating}+`, clear: () => set({ minRating: null }) });
  if (filters.beachMax != null)
    chips.push({ label: `Beach ≤ ${filters.beachMax}min`, clear: () => set({ beachMax: null }) });
  for (const a of filters.amenities) {
    const label = AMENITIES.find((x) => x.key === a)?.label ?? a;
    chips.push({ label, clear: () => set({ amenities: toggle(filters.amenities, a) }) });
  }

  const amenityGroups = useMemo(() => {
    const m = new Map<string, typeof AMENITIES>();
    for (const a of AMENITIES) {
      if (!m.has(a.group)) m.set(a.group, []);
      m.get(a.group)!.push(a);
    }
    return [...m.entries()];
  }, []);

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]"
          style={{ color: UI.text }}
        >
          <SlidersHorizontal size={13} style={{ color: UI.green }} />
          Filter
        </span>
        <span className="text-[10px] font-semibold" style={{ color: UI.muted }}>
          {resultCount != null ? `${resultCount.toLocaleString("en-GB")} results` : "…"}
        </span>
      </div>

      {/* Active chips */}
      {active > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px]" style={{ color: UI.muted }}>
              Active filters
            </span>
            <button
              className="text-[10px] font-semibold hover:underline"
              style={{ color: UI.green }}
              onClick={() => onChange({ ...DEFAULT_FILTERS })}
            >
              Reset all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <Chip key={`${c.label}-${i}`} label={c.label} onClear={c.clear} />
            ))}
          </div>
        </div>
      )}

      {/* Areas */}
      <Section title="Area" badge={filters.areas.length}>
        <div className="flex flex-col">
          {areaGroups.map((g) => {
            const childSlugs = g.children.map((c) => c.slug);
            const selectedCount = childSlugs.filter((s) => filters.areas.includes(s)).length;
            const allSelected = selectedCount === childSlugs.length && childSlugs.length > 0;
            const expanded = expandedParents.includes(g.parent);
            return (
              <div key={g.parent}>
                <div className="flex items-center">
                  <div className="flex-1">
                    <Check
                      checked={allSelected || (childSlugs.length === 1 && selectedCount === 1)}
                      label={g.parent}
                      sub={g.count.toLocaleString("en-GB")}
                      onChange={() =>
                        set({
                          areas: allSelected || selectedCount > 0
                            ? filters.areas.filter((s) => !childSlugs.includes(s))
                            : [...filters.areas, ...childSlugs],
                        })
                      }
                    />
                  </div>
                  {g.children.length > 1 && (
                    <button
                      onClick={() => setExpandedParents((e) => toggle(e, g.parent))}
                      className="p-1"
                      aria-label={`Expand ${g.parent}`}
                    >
                      <ChevronDown
                        size={11}
                        style={{
                          color: UI.faint,
                          transform: expanded ? "rotate(180deg)" : "none",
                          transition: "transform 0.2s",
                        }}
                      />
                    </button>
                  )}
                </div>
                {expanded &&
                  g.children.map((c) => (
                    <div key={c.slug} className="pl-5">
                      <Check
                        checked={filters.areas.includes(c.slug)}
                        label={c.label}
                        sub={c.count.toLocaleString("en-GB")}
                        onChange={() => set({ areas: toggle(filters.areas, c.slug) })}
                      />
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Property type */}
      <Section title="Property type" badge={filters.types.length}>
        {(Object.keys(TYPE_GROUP_LABELS) as TypeGroup[]).map((t) => (
          <Check
            key={t}
            checked={filters.types.includes(t)}
            label={TYPE_GROUP_LABELS[t]}
            onChange={() => set({ types: toggle(filters.types, t) })}
          />
        ))}
      </Section>

      {/* Bedrooms */}
      <Section title="Bedrooms">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3, 4].map((n) => {
            const activeBed = filters.minBeds === n;
            return (
              <button
                key={n}
                onClick={() => set({ minBeds: n })}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                style={
                  activeBed
                    ? { background: UI.olive, color: "#FFFFFF" }
                    : { background: "rgba(255,255,255,0.05)", color: UI.muted }
                }
              >
                {n === 0 ? "Any" : `${n}+`}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Nightly rate */}
      <Section title="Nightly rate">
        <div className="flex items-center gap-2">
          {(["priceMin", "priceMax"] as const).map((k, i) => (
            <div key={k} className="flex-1 flex items-center gap-1 rounded-lg px-2 py-1.5"
              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${UI.border}` }}>
              <span className="text-[10px]" style={{ color: UI.faint }}>€</span>
              <input
                type="number"
                min={0}
                placeholder={i === 0 ? "min" : "max"}
                value={filters[k] ?? ""}
                onChange={(e) =>
                  set({ [k]: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })
                }
                className="w-full bg-transparent outline-none text-[11px]"
                style={{ color: UI.text }}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* Advanced */}
      <div className="border-t mt-3 pt-3" style={{ borderColor: UI.border }}>
        <button
          onClick={() => setAdvanced(!advanced)}
          className="w-full flex items-center justify-between py-1"
        >
          <span className="text-[11px] font-bold" style={{ color: UI.green }}>
            Advanced filters
          </span>
          <ChevronDown
            size={13}
            style={{
              color: UI.green,
              transform: advanced ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
        </button>

        {advanced && (
          <div className="mt-2">
            <Check
              checked={filters.superhost}
              label="Superhost only"
              onChange={() => set({ superhost: !filters.superhost })}
            />
            <Check
              checked={filters.guestFav}
              label="Guest favourite only"
              onChange={() => set({ guestFav: !filters.guestFav })}
            />
            <Check
              checked={filters.entireOnly}
              label="Entire place only"
              onChange={() => set({ entireOnly: !filters.entireOnly })}
            />

            <p className="text-[10px] font-bold uppercase tracking-wider mt-3 mb-1" style={{ color: UI.muted }}>
              Minimum rating
            </p>
            <div className="flex gap-1.5">
              {[4.0, 4.5, 4.8].map((r) => {
                const on = filters.minRating === r;
                return (
                  <button
                    key={r}
                    onClick={() => set({ minRating: on ? null : r })}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                    style={on ? { background: UI.olive, color: "#FFF" } : { background: "rgba(255,255,255,0.05)", color: UI.muted }}
                  >
                    ★ {r}+
                  </button>
                );
              })}
            </div>

            <p className="text-[10px] font-bold uppercase tracking-wider mt-3 mb-1" style={{ color: UI.muted }}>
              Beach within
            </p>
            <div className="flex gap-1.5">
              {[10, 20, 30].map((m) => {
                const on = filters.beachMax === m;
                return (
                  <button
                    key={m}
                    onClick={() => set({ beachMax: on ? null : m })}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                    style={on ? { background: UI.olive, color: "#FFF" } : { background: "rgba(255,255,255,0.05)", color: UI.muted }}
                  >
                    {m} min
                  </button>
                );
              })}
            </div>

            {amenityGroups.map(([group, items]) => (
              <div key={group}>
                <p className="text-[10px] font-bold uppercase tracking-wider mt-3 mb-1" style={{ color: UI.muted }}>
                  {group}
                </p>
                {items.map((a) => (
                  <Check
                    key={a.key}
                    checked={filters.amenities.includes(a.key)}
                    label={a.label}
                    onChange={() => set({ amenities: toggle(filters.amenities, a.key) })}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
