"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Building2,
  Calculator,
  Hexagon,
  LineChart,
  PenLine,
  SlidersHorizontal,
  Timer,
  X,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import type {
  AreaHealth,
  AreaInfo,
  DashboardSummary,
  InvestStats,
  ListingDetail,
  MarketResponse,
  OccWindow,
  PaceData,
  PointRow,
  PolygonCoords,
  PricingData,
  RentalStats,
  Selection,
} from "@/lib/dashboard/types";
import { DEFAULT_FILTERS, encodeFilters, type Filters } from "@/lib/dashboard/filters";
import { fmtDate, fmtInt } from "@/lib/dashboard/format";
import { FIRST_WEEK, clampRange, mondayOf, sundayOf } from "@/lib/dashboard/weeks";
import { UI } from "./tokens";
import FilterPanel from "./FilterPanel";
import SearchBar from "./SearchBar";
import MarketTab from "./MarketTab";
import PricingTab from "./PricingTab";
import PaceTab from "./PaceTab";
import BuyRentTab from "./BuyRentTab";
import CalculatorTab from "./CalculatorTab";
import HoverCard from "./HoverCard";
import DateRangeCalendar from "./DateRangeCalendar";
import Explain from "./Explain";

const MarketMap = dynamic(() => import("./MarketMap"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-full flex items-center justify-center text-sm"
      style={{ background: "#E8EDE3", color: "#697264" }}
    >
      Loading map…
    </div>
  ),
});

type TabId = "market" | "pricing" | "pace" | "buyrent" | "calc";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg p-0.5 gap-0.5 glass-card">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap"
            style={
              active
                ? { background: UI.olive, color: "#FFFFFF" }
                : { background: "transparent", color: UI.muted }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Fly-to zoom from a dim_areas search radius. */
function zoomForRadius(km: number | null): number {
  if (km == null) return 12;
  return Math.max(9, Math.min(14, Math.round(13.5 - Math.log2(Math.max(1, km)))));
}

export default function DashboardClient() {
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  const [window_, setWindow] = useState<OccWindow>("todate");
  const [drawing, setDrawing] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [tab, setTab] = useState<TabId>("market");

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [areas, setAreas] = useState<AreaInfo[] | null>(null);
  const [points, setPoints] = useState<PointRow[] | null>(null);
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [invest, setInvest] = useState<InvestStats | null>(null);
  const [rentals, setRentals] = useState<RentalStats | null>(null);
  const [pace, setPace] = useState<PaceData | null>(null);
  const [health, setHealth] = useState<AreaHealth | null>(null);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const detailCache = useRef(new Map<string, ListingDetail>());

  // Date range picked at day level (Airbnb-style calendar); the data
  // aggregates by whole ISO weeks (Cyprus time) underneath. Bounds come
  // from sync_meta: first covered Monday → Sunday of the last forward week.
  const maxWeek = summary?.fwdEnd ? mondayOf(summary.fwdEnd) : FIRST_WEEK;
  const maxDay = sundayOf(maxWeek);
  const [dayRange, setDayRange] = useState<[string, string] | null>(null);
  const effectiveDays = useMemo<[string, string]>(() => {
    const r = dayRange ?? [FIRST_WEEK, maxDay];
    let [from, to] = r;
    if (from < FIRST_WEEK) from = FIRST_WEEK;
    if (to > maxDay) to = maxDay;
    if (to < from) to = from;
    return [from, to];
  }, [dayRange, maxDay]);
  const effectiveRange = useMemo<[string, string]>(
    () => clampRange(effectiveDays[0], effectiveDays[1], FIRST_WEEK, maxWeek),
    [effectiveDays, maxWeek]
  );

  const polygon = selection.kind === "polygon" ? selection.coords : null;
  const filtersKey = useMemo(() => encodeFilters(filters), [filters]);
  const debouncedFilters = useDebounced(filtersKey, 300);

  const selectionPayload = useMemo(
    () =>
      selection.kind === "area"
        ? { kind: "area" as const, areaId: selection.area.areaId }
        : selection.kind === "polygon"
          ? { kind: "polygon" as const, coords: selection.coords }
          : { kind: "all" as const },
    [selection]
  );

  useEffect(() => {
    fetch("/api/dashboard/summary")
      .then((r) => r.json())
      .then(setSummary)
      .catch(console.error);
    fetch("/api/dashboard/areas")
      .then((r) => r.json())
      .then(setAreas)
      .catch(console.error);
    // Area health is island-wide and selection-independent — one fetch.
    fetch("/api/dashboard/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(console.error);
  }, []);

  // Map dots: attribute filters only — the selection is drawn on top.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/dashboard/points?${debouncedFilters}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setPoints)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [debouncedFilters]);

  // The market payload drives the Market overview + Pricing tabs.
  useEffect(() => {
    const ctrl = new AbortController();
    const params = Object.fromEntries(new URLSearchParams(debouncedFilters));
    fetch("/api/dashboard/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selection: selectionPayload,
        filters: params,
        weekStart: effectiveRange[0],
        weekEnd: effectiveRange[1],
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(setMarket)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [debouncedFilters, selectionPayload, effectiveRange]);

  // Pricing data only when the pricing tab is (or has been) open.
  const [pricingWanted, setPricingWanted] = useState(false);
  useEffect(() => {
    if (tab === "pricing") setPricingWanted(true);
  }, [tab]);
  useEffect(() => {
    if (!pricingWanted) return;
    const ctrl = new AbortController();
    const params = Object.fromEntries(new URLSearchParams(debouncedFilters));
    setPricing(null);
    fetch("/api/dashboard/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        polygon,
        filters: params,
        areaId: selection.kind === "area" ? selection.area.areaId : null,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(setPricing)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [debouncedFilters, polygon, pricingWanted, selection]);

  // Buy & Rent / calculator / pace: all follow the selection AND the
  // attribute filters, fetched once their tab first opens.
  const [investWanted, setInvestWanted] = useState(false);
  const [rentalsWanted, setRentalsWanted] = useState(false);
  const [paceWanted, setPaceWanted] = useState(false);
  useEffect(() => {
    if (tab === "buyrent" || tab === "calc") setInvestWanted(true);
    if (tab === "buyrent") setRentalsWanted(true);
    if (tab === "pace") setPaceWanted(true);
  }, [tab]);

  // Shared body: selection (polygon or named area) + attribute filters.
  const scopeBody = useMemo(() => {
    const params = Object.fromEntries(new URLSearchParams(debouncedFilters));
    return JSON.stringify({
      polygon,
      areaId: selection.kind === "area" ? selection.area.areaId : null,
      filters: params,
    });
  }, [polygon, selection, debouncedFilters]);

  useEffect(() => {
    if (!paceWanted) return;
    const ctrl = new AbortController();
    setPace(null);
    fetch("/api/dashboard/pace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: scopeBody,
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(setPace)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [scopeBody, paceWanted]);
  useEffect(() => {
    if (!investWanted) return;
    const ctrl = new AbortController();
    setInvest(null);
    fetch("/api/dashboard/invest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: scopeBody,
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(setInvest)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [scopeBody, investWanted]);
  useEffect(() => {
    if (!rentalsWanted) return;
    const ctrl = new AbortController();
    setRentals(null);
    fetch("/api/dashboard/rentals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: scopeBody,
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(setRentals)
      .catch((e: Error) => e.name !== "AbortError" && console.error(e));
    return () => ctrl.abort();
  }, [scopeBody, rentalsWanted]);

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

  // Stable callbacks — PointsLayer rebuilds its canvas when these change.
  const handleHover = useCallback((id: string | null) => setHoverId(id), []);
  const handlePick = useCallback((id: string) => setPinnedId((p) => (p === id ? null : id)), []);
  const handleAreaPick = useCallback((a: AreaInfo) => setSelection({ kind: "area", area: a }), []);
  const handlePolygonComplete = useCallback((poly: PolygonCoords) => {
    setSelection({ kind: "polygon", coords: poly });
    setDrawing(false);
  }, []);
  const handleDrawCancel = useCallback(() => setDrawing(false), []);

  const focus =
    selection.kind === "area" && selection.area.lat != null && selection.area.lng != null
      ? {
          lat: selection.area.lat,
          lng: selection.area.lng,
          zoom: zoomForRadius(selection.area.radiusKm),
        }
      : null;

  const selectionLabel =
    selection.kind === "all"
      ? "All of Cyprus"
      : selection.kind === "area"
        ? selection.area.nameEn
        : "Drawn area";

  const selectionCount =
    market?.snapshot?.listings ??
    market?.weekly.at(-1)?.listings ??
    (selection.kind === "area" ? selection.area.listingCount : null);

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: "market", label: "Market overview", icon: <BarChart3 size={14} /> },
    { id: "pricing", label: "Pricing", icon: <LineChart size={14} /> },
    { id: "pace", label: "Booking pace", icon: <Timer size={14} /> },
    { id: "buyrent", label: "Buy & Rent", icon: <Building2 size={14} /> },
    { id: "calc", label: "Revenue calculator", icon: <Calculator size={14} /> },
  ];

  return (
    <div className="min-h-screen dash-bg" style={{ color: UI.text }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 h-14 flex items-center justify-between px-4 md:px-6 glass-dark"
        style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}
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
            Market Dashboard · Cyprus
          </span>
        </div>

        <div className="flex items-center gap-3">
          {summary && (
            <span className="text-xs hidden md:flex items-center gap-1.5" style={{ color: UI.muted }}>
              Calendars through {fmtDate(summary.todateEnd)}
              {summary.bookingsThrough && <> · bookings to {fmtDate(summary.bookingsThrough)}</>}
              <Explain id="freshness" align="right" />
            </span>
          )}
          {summary && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide"
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
        className="relative m-3 md:m-4 mb-0 rounded-3xl overflow-hidden"
        style={{
          height: "min(64vh, 720px)",
          minHeight: 440,
          border: `1px solid ${UI.border}`,
          isolation: "isolate",
        }}
      >
        <MarketMap
          points={points ?? []}
          areas={areas ?? []}
          window_={window_}
          drawing={drawing}
          polygon={polygon}
          focus={focus}
          onHover={handleHover}
          onPick={handlePick}
          onAreaPick={handleAreaPick}
          onPolygonComplete={handlePolygonComplete}
          onDrawCancel={handleDrawCancel}
        />

        {/* Search + draw toolbar (top-centre) */}
        <div className="absolute left-1/2 -translate-x-1/2 top-3 z-[950] flex items-center gap-2">
          <SearchBar areas={areas} selection={selection} onSelect={setSelection} />
          {!drawing ? (
            <button
              onClick={() => {
                setDrawing(true);
                setPinnedId(null);
              }}
              className="glass-dark rounded-xl px-4 h-11 flex items-center gap-2 text-sm font-semibold transition-transform hover:scale-[1.03] active:scale-95 whitespace-nowrap"
              style={{ color: UI.text }}
            >
              <PenLine size={14} style={{ color: UI.green }} />
              {polygon ? "Redraw" : "Draw area"}
            </button>
          ) : (
            <button
              onClick={handleDrawCancel}
              className="glass-dark rounded-xl px-4 h-11 flex items-center gap-2 text-sm font-semibold whitespace-nowrap"
              style={{ color: UI.oliveLight }}
            >
              <X size={14} /> Cancel
            </button>
          )}
        </div>
        {drawing && (
          <div className="absolute left-1/2 -translate-x-1/2 top-16 z-[940]">
            <span className="glass-dark rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap" style={{ color: UI.text }}>
              Click to add points · double-click or ⏎ to finish · Esc to cancel
            </span>
          </div>
        )}

        {/* Floating filter panel (desktop) — hugs content, scrolls when tall */}
        <div className="hidden lg:block absolute left-3 top-3 w-[280px] max-h-[calc(100%-1.5rem)] z-[900] glass-dark rounded-2xl overflow-y-auto ps-scroll">
          <FilterPanel filters={filters} onChange={setFilters} resultCount={points?.length ?? null} />
        </div>

        {/* Mobile filter toggle + drawer */}
        <button
          onClick={() => setMobileFilters(true)}
          className="lg:hidden absolute left-3 top-3 z-[900] glass-dark rounded-xl px-3 h-11 flex items-center gap-2 text-xs font-semibold"
          style={{ color: UI.text }}
        >
          <SlidersHorizontal size={14} style={{ color: UI.green }} />
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
              <FilterPanel filters={filters} onChange={setFilters} resultCount={points?.length ?? null} />
            </div>
          </div>
        )}

        {/* Listing hover/pin card */}
        <div className="absolute right-3 top-16 z-[930] pointer-events-none">
          <AnimatePresence>
            {detail && (
              <HoverCard
                key={detail.id}
                listing={detail}
                pinned={pinnedId != null}
                window_={window_}
                onClose={() => setPinnedId(null)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Occupancy legend + map-colour window toggle */}
        <div className="absolute left-3 lg:left-[304px] bottom-3 z-[900] glass-light rounded-lg px-3 py-2">
          <p className="text-[10px] font-semibold mb-1" style={{ color: "#4C5546" }}>
            Occupancy · {window_ === "todate" ? "season to date" : "next 60 days"}
          </p>
          <div
            className="w-28 h-2 rounded-full"
            style={{ background: "linear-gradient(90deg,#D8DECB,#8FA36B,#4A5E3A,#26331C)" }}
          />
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px]" style={{ color: "#69725F" }}>40%</span>
            <span className="text-[9px]" style={{ color: "#69725F" }}>95%</span>
          </div>
        </div>
      </section>

      {/* Context bar: selection + week range + map window */}
      <div className="px-3 md:px-4 mt-3 flex flex-wrap items-center gap-2.5">
        <span className="flex items-center gap-2">
          <Hexagon size={15} style={{ color: UI.green }} />
          <h2 className="font-display font-bold text-xl uppercase tracking-wide" style={{ color: UI.text }}>
            {selectionLabel}
          </h2>
        </span>
        {selectionCount != null && (
          <span className="text-sm" style={{ color: UI.muted }}>
            {fmtInt(selectionCount)} listings
          </span>
        )}
        {selection.kind !== "all" && (
          <button
            onClick={() => setSelection({ kind: "all" })}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: UI.muted, border: `1px solid ${UI.border}` }}
          >
            <X size={11} /> Clear selection
          </button>
        )}
        <div className="flex-1" />
        <DateRangeCalendar min={FIRST_WEEK} max={maxDay} value={effectiveDays} onChange={setDayRange} />
        <Segmented
          value={window_}
          onChange={setWindow}
          options={[
            { value: "todate", label: "Map: season" },
            { value: "fwd60", label: "Map: next 60d" },
          ]}
        />
      </div>

      {/* Tabs */}
      <div className="px-3 md:px-4 mt-3">
        <div className="flex items-center gap-1.5 border-b overflow-x-auto" style={{ borderColor: UI.border }}>
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-colors whitespace-nowrap"
                style={
                  active
                    ? {
                        color: UI.text,
                        background: "rgba(255,255,255,0.05)",
                        borderBottom: `2px solid ${UI.green}`,
                        marginBottom: -1,
                      }
                    : { color: UI.muted, borderBottom: "2px solid transparent", marginBottom: -1 }
                }
              >
                <span style={{ color: active ? UI.green : UI.faint }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-3 md:px-4 py-4 pb-12">
        {tab === "market" && <MarketTab market={market} health={health} />}
        {tab === "pricing" && <PricingTab pricing={pricing} market={market} />}
        {tab === "pace" && <PaceTab pace={pace} />}
        {tab === "buyrent" && (
          <BuyRentTab invest={invest} rentals={rentals} market={market} selection={selection} />
        )}
        {tab === "calc" && (
          <CalculatorTab invest={invest} market={market} selection={selection} />
        )}
      </div>
    </div>
  );
}
