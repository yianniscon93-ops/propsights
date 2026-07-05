"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { PenLine, SlidersHorizontal, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import type {
  DashboardSummary,
  ListingDetail,
  OccMetric,
  OccWindow,
  PointRow,
  PolygonCoords,
  SelectionStats,
} from "@/lib/dashboard/types";
import { DEFAULT_FILTERS, encodeFilters, type Filters } from "@/lib/dashboard/filters";
import { fmtDate } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import FilterPanel from "./FilterPanel";
import StatsSection from "./StatsSection";
import HoverCard from "./HoverCard";

const MarketMap = dynamic(() => import("./MarketMap"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-full flex items-center justify-center text-xs"
      style={{ background: "#E8EDE3", color: "#697264" }}
    >
      Loading map…
    </div>
  ),
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DashboardClient() {
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [metric, setMetric] = useState<OccMetric>("eff");
  const [window_, setWindow] = useState<OccWindow>("todate");
  const [polygon, setPolygon] = useState<PolygonCoords | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [points, setPoints] = useState<PointRow[] | null>(null);
  const [stats, setStats] = useState<SelectionStats | null>(null);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const detailCache = useRef(new Map<string, ListingDetail>());

  const filtersKey = useMemo(() => encodeFilters(filters), [filters]);
  const debouncedFilters = useDebounced(filtersKey, 300);

  useEffect(() => {
    fetch("/api/dashboard/summary")
      .then((r) => r.json())
      .then(setSummary)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/dashboard/points?${debouncedFilters}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setPoints)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [debouncedFilters]);

  useEffect(() => {
    const ctrl = new AbortController();
    const params = Object.fromEntries(new URLSearchParams(debouncedFilters));
    fetch("/api/dashboard/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygon, filters: params }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(setStats)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [debouncedFilters, polygon]);

  // Hovered/pinned listing detail (with a small cache).
  const activeId = pinnedId ?? hoverId;
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    const cached = detailCache.current.get(activeId);
    if (cached) {
      setDetail(cached);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/dashboard/listing/${activeId}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: ListingDetail | null) => {
          if (d) {
            detailCache.current.set(d.id, d);
            setDetail(d);
          }
        })
        .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [activeId]);

  // Stable callbacks — PointsLayer rebuilds its 15k-dot canvas when these change.
  const handleHover = useCallback((id: string | null) => setHoverId(id), []);
  const handlePick = useCallback((id: string) => setPinnedId((p) => (p === id ? null : id)), []);
  const handlePolygonComplete = useCallback((poly: PolygonCoords) => {
    setPolygon(poly);
    setDrawing(false);
  }, []);
  const handleDrawCancel = useCallback(() => setDrawing(false), []);

  return (
    <div className="min-h-screen dash-bg" style={{ color: UI.text }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 h-14 flex items-center justify-between px-4 md:px-6 glass-dark border-x-0 border-t-0"
        style={{ borderRadius: 0 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #4A5E3A, #6B7B4F)" }}
            >
              <span className="text-white font-display text-sm font-bold">P</span>
            </div>
            <span className="font-display text-lg font-bold tracking-tight uppercase hidden sm:inline">
              <span style={{ color: UI.text }}>{BRAND.namePart1}</span>
              <span style={{ color: UI.oliveMid }}>{BRAND.namePart2}</span>
            </span>
          </Link>
          <span className="w-px h-5" style={{ background: UI.border }} />
          <span className="text-sm font-medium truncate" style={{ color: UI.muted }}>
            Market Dashboard · Cyprus STR
          </span>
        </div>

        <div className="flex items-center gap-3">
          {summary && (
            <span className="text-[11px] hidden md:inline" style={{ color: UI.muted }}>
              Data through {fmtDate(summary.todateEnd)}
            </span>
          )}
          {summary && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide"
              style={
                summary.source === "live"
                  ? { background: "rgba(143,204,128,0.12)", color: UI.green }
                  : { background: "rgba(168,194,144,0.1)", color: UI.oliveLight, border: `1px solid ${UI.border}` }
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${summary.source === "live" ? "animate-pulse" : ""}`}
                style={{ background: summary.source === "live" ? UI.green : UI.oliveLight }}
              />
              {summary.source === "live" ? "LIVE" : "DEMO DATA"}
            </span>
          )}
        </div>
      </header>

      {/* Map hero */}
      <section
        className="relative m-3 md:m-4 rounded-3xl overflow-hidden"
        style={{
          height: "min(68vh, 760px)",
          minHeight: 440,
          border: `1px solid ${UI.border}`,
          isolation: "isolate",
        }}
      >
        <MarketMap
          points={points ?? []}
          metric={metric}
          window_={window_}
          drawing={drawing}
          polygon={polygon}
          onHover={handleHover}
          onPick={handlePick}
          onPolygonComplete={handlePolygonComplete}
          onDrawCancel={handleDrawCancel}
        />

        {/* Floating filter panel (desktop) */}
        <div
          className="hidden lg:block absolute left-3 top-3 bottom-3 w-[280px] z-[900] glass-dark rounded-2xl overflow-y-auto ps-scroll"
        >
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            summary={summary}
            resultCount={points?.length ?? null}
          />
        </div>

        {/* Mobile filter toggle + drawer */}
        <button
          onClick={() => setMobileFilters(true)}
          className="lg:hidden absolute left-3 top-3 z-[900] glass-dark rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] font-semibold"
          style={{ color: UI.text }}
        >
          <SlidersHorizontal size={13} style={{ color: UI.green }} />
          Filters
        </button>
        {mobileFilters && (
          <div className="lg:hidden fixed inset-0 z-[1100] flex">
            <div
              className="absolute inset-0"
              style={{ background: "rgba(6,9,4,0.55)" }}
              onClick={() => setMobileFilters(false)}
            />
            <div className="relative glass-dark w-[300px] max-w-[85vw] h-full overflow-y-auto ps-scroll rounded-r-2xl">
              <button
                onClick={() => setMobileFilters(false)}
                className="absolute right-3 top-3 z-10 p-1"
                aria-label="Close filters"
              >
                <X size={16} style={{ color: UI.muted }} />
              </button>
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                summary={summary}
                resultCount={points?.length ?? null}
              />
            </div>
          </div>
        )}

        {/* Draw toolbar */}
        <div className="absolute right-3 top-3 z-[900] flex items-center gap-2">
          {!drawing && (
            <button
              onClick={() => {
                setDrawing(true);
                setPolygon(null);
                setPinnedId(null);
              }}
              className="glass-dark rounded-xl px-3.5 py-2 flex items-center gap-2 text-[11px] font-semibold transition-transform hover:scale-[1.03] active:scale-95"
              style={{ color: UI.text }}
            >
              <PenLine size={13} style={{ color: UI.green }} />
              {polygon ? "Redraw area" : "Draw area"}
            </button>
          )}
          {drawing && (
            <>
              <span className="glass-dark rounded-xl px-3 py-2 text-[10px]" style={{ color: UI.muted }}>
                Click to add points · double-click or ⏎ to finish · Esc to cancel
              </span>
              <button
                onClick={handleDrawCancel}
                className="glass-dark rounded-xl px-3 py-2 text-[11px] font-semibold"
                style={{ color: UI.oliveLight }}
              >
                Cancel
              </button>
            </>
          )}
          {!drawing && polygon && (
            <button
              onClick={() => setPolygon(null)}
              className="glass-dark rounded-xl px-3 py-2 flex items-center gap-1.5 text-[11px] font-semibold"
              style={{ color: UI.muted }}
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Listing hover/pin card */}
        <div className="absolute right-3 top-16 z-[950] pointer-events-none">
          <AnimatePresence>
            {detail && (
              <HoverCard
                key={detail.id}
                listing={detail}
                pinned={pinnedId != null}
                metric={metric}
                window_={window_}
                onClose={() => setPinnedId(null)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Occupancy legend */}
        <div className="absolute left-3 lg:left-[304px] bottom-3 z-[900] glass-light rounded-lg px-2.5 py-2">
          <p className="text-[9px] font-semibold mb-1" style={{ color: "#697264" }}>
            Occupancy
          </p>
          <div
            className="w-28 h-2 rounded-full"
            style={{ background: "linear-gradient(90deg,#D8DECB,#8FA36B,#4A5E3A,#26331C)" }}
          />
          <div className="flex justify-between mt-0.5">
            <span className="text-[8px]" style={{ color: "#9AA690" }}>40%</span>
            <span className="text-[8px]" style={{ color: "#9AA690" }}>95%</span>
          </div>
        </div>
      </section>

      {/* Stats for current selection */}
      <StatsSection
        stats={stats}
        hasPolygon={polygon != null}
        metric={metric}
        window_={window_}
        onMetric={setMetric}
        onWindow={setWindow}
        onClearPolygon={() => setPolygon(null)}
      />
    </div>
  );
}
