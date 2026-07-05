"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { PenLine, BarChart3, LineChart, ArrowRight } from "lucide-react";
import { AREA_DATA, AREAS } from "@/lib/areaData";

export type Stage = "map" | "zoom" | "draw" | "market" | "pricing";

const CYPRUS_CENTER: [number, number] = [34.98, 33.25];
const CYPRUS_ZOOM = 8;
const AREA_ZOOM = 12;
const DRAW_ZOOM = 13;

const NEIGHBOURHOODS: Record<string, string> = {
  Limassol: "Tourist Area",
  "Ayia Napa": "Nissi Bay",
  Paphos: "Kato Paphos",
  Protaras: "Fig Tree Bay",
  Larnaca: "Finikoudes",
  Polis: "Chrysochous Bay",
};
function hoodName(area: string) {
  return NEIGHBOURHOODS[area] ?? "Town Centre";
}
function hoodListingCount(area: string) {
  return Math.max(12, Math.round((AREA_DATA[area]?.listings ?? 40) * 0.34));
}
function hoodKm2(area: string) {
  return (0.6 + ((AREA_DATA[area]?.listings ?? 40) % 7) * 0.1).toFixed(1);
}

function useCountUp(target: number, trigger: unknown) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const dur = 700;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, trigger]);
  return val;
}

function makeMarkerIcon(active: boolean) {
  const s = active ? 18 : 11;
  return L.divIcon({
    html: `<span class="ps-pin${active ? " ps-pin-active" : ""}"></span>`,
    className: "ps-pin-wrap",
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
}

function MapController({ area, stage }: { area: string; stage: Stage }) {
  const map = useMap();

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    const d = AREA_DATA[area];
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (stage === "map") {
      if (reduce) map.setView(CYPRUS_CENTER, CYPRUS_ZOOM, { animate: false });
      else map.flyTo(CYPRUS_CENTER, CYPRUS_ZOOM, { duration: 1.3, easeLinearity: 0.25 });
    } else if (stage === "zoom" && d) {
      if (reduce) map.setView([d.lat, d.lng], AREA_ZOOM, { animate: false });
      else map.flyTo([d.lat, d.lng], AREA_ZOOM, { duration: 1.9, easeLinearity: 0.25 });
    } else if (stage === "draw" && d) {
      if (reduce) map.setView([d.lat, d.lng], DRAW_ZOOM, { animate: false });
      else map.flyTo([d.lat, d.lng], DRAW_ZOOM, { duration: 1.4, easeLinearity: 0.25 });
    }
  }, [area, stage, map]);

  return null;
}

const HOOD_VERTS: [number, number][] = [
  [34, 34], [48, 28], [62, 31], [70, 42], [68, 56],
  [58, 66], [44, 68], [34, 58], [30, 46],
];
const HOOD_PATH = "M" + HOOD_VERTS.map(([x, y]) => `${x},${y}`).join(" L") + " Z";
const DIM_PATH = "M0,0 H100 V100 H0 Z " + HOOD_PATH;

function DrawOverlay({ area }: { area: string }) {
  const reduce = useReducedMotion();
  const hood = hoodName(area);
  const km2 = hoodKm2(area);
  const listings = hoodListingCount(area);

  return (
    <motion.div
      key="draw"
      className="absolute inset-0 z-10"
      style={{ pointerEvents: "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <motion.path
          d={DIM_PATH}
          fillRule="evenodd"
          fill="#0C100A"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.85 }}
        />
        <motion.path
          d={HOOD_PATH}
          fill="#8FCC80"
          stroke="none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.18 }}
          transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.9 }}
        />
        <motion.path
          d={HOOD_PATH}
          fill="none"
          stroke="#1F2A16"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 1.3, ease: "easeInOut" }}
        />
        {HOOD_VERTS.map(([x, y], i) => (
          <motion.rect
            key={i}
            x={x - 1.4}
            y={y - 1.4}
            width={2.8}
            height={2.8}
            rx={0.6}
            fill="#FFFFFF"
            stroke="#4A5E3A"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : 0.6 + i * 0.06 }}
          />
        ))}
      </svg>

      <motion.div
        className="absolute top-3 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : 0.5 }}
      >
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap"
          style={{
            background: "#FFFFFF",
            color: "#1A2014",
            border: "1px solid #D0D9C6",
            boxShadow: "0 4px 14px rgba(20,30,15,0.18)",
          }}
        >
          <PenLine size={11} style={{ color: "#4A5E3A" }} />
          Custom area · {hood} · ~{km2} km² · {listings} listings
        </span>
      </motion.div>
    </motion.div>
  );
}


const SEASON = [0.62, 0.66, 0.74, 0.85, 0.95, 1.06, 1.16, 1.18, 1.04, 0.9, 0.72, 0.66];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Dark-glass tokens (inlined — no dependency on dashboard/tokens.ts)
const DT = {
  bg: "#0C100A",
  card: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.09)",
  text: "#EAF0DF",
  muted: "#ADB8A0",
  faint: "#828D74",
  green: "#8FCC80",
  olive: "#4A5E3A",
};

const TYPE_MIX = [
  { label: "Apartment", share: 52 },
  { label: "Villa", share: 31 },
  { label: "Studio", share: 17 },
];

// ── Shared SVG mini-chart helper ──────────────────────────────────────────

function MiniLineChart({
  series,
  gradId,
}: {
  series: number[];
  gradId: string;
}) {
  const W = 300; const H = 56; const PAD = 4;
  const maxV = Math.max(...series), minV = Math.min(...series);
  const span = maxV - minV;
  const floor = minV - span * 0.15, ceil = maxV + span * 0.08;
  const xs = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const ys = (v: number) => H - 2 - ((v - floor) / Math.max(1, ceil - floor)) * (H - 8);
  const linePts = series.map((v, i) => `${xs(i)},${ys(v)}`).join(" ");
  const areaPts = `${xs(0)},${H} ${linePts} ${xs(series.length - 1)},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={DT.green} stopOpacity="0.24" />
          <stop offset="100%" stopColor={DT.green} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.28, 0.55, 0.82].map((f) => (
        <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      ))}
      <motion.polygon points={areaPts} fill={`url(#${gradId})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.15 }} />
      <motion.polyline
        points={linePts} fill="none" stroke={DT.green} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.85, ease: "easeInOut" }}
      />
    </svg>
  );
}

// ── Market tab content ─────────────────────────────────────────────────────

function MarketContent({ area }: { area: string }) {
  const d = AREA_DATA[area];
  const hoodOcc = Math.min(98, d.occupancy + 7);
  const hoodRate = Math.round(d.rate * 1.12);
  const listings = hoodListingCount(area);
  const fwd60 = Math.round(hoodOcc * 0.88);
  const occ = useCountUp(hoodOcc, area);

  const occSeries = SEASON.map((m) => Math.min(98, Math.round(hoodOcc * m)));

  const kpis = [
    { label: "Listings", val: listings.toLocaleString(), accent: false },
    { label: "Occupancy", val: `${occ}%`, accent: true },
    { label: "Next 60d", val: `${fwd60}%`, accent: false },
    { label: "Median ADR", val: `€${hoodRate}`, accent: false },
  ];

  return (
    <>
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-1.5 p-2 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl px-2 py-2" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
            <p className="font-display font-bold text-sm leading-none" style={{ color: k.accent ? DT.green : DT.text }}>{k.val}</p>
            <p className="text-[9px] mt-1.5 uppercase tracking-wide font-medium" style={{ color: DT.muted }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Weekly occupancy chart */}
      <div className="flex-1 mx-2 rounded-xl p-2.5 flex flex-col min-h-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
        <div className="flex items-center justify-between mb-1 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: DT.muted }}>Weekly occupancy</p>
          <p className="text-[9px]" style={{ color: DT.faint }}>Peak Jul–Aug</p>
        </div>
        <div className="flex-1 min-h-0">
          <MiniLineChart series={occSeries} gradId="heroMktFill" />
        </div>
        <div className="flex justify-between mt-1 shrink-0">
          {MONTHS.map((m, i) => <span key={i} className="text-[8px]" style={{ color: DT.faint }}>{m}</span>)}
        </div>
      </div>

      {/* Property mix */}
      <div className="mx-2 mt-1.5 rounded-xl p-2.5 shrink-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: DT.muted }}>Property mix</p>
        <div className="flex flex-col gap-1.5">
          {TYPE_MIX.map((m) => (
            <div key={m.label}>
              <div className="flex justify-between mb-0.5">
                <span className="text-[10px]" style={{ color: DT.text }}>{m.label}</span>
                <span className="text-[10px]" style={{ color: DT.muted }}>{m.share}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg,#4A5E3A,#8FCC80)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${m.share}%` }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Pricing tab content ────────────────────────────────────────────────────

// Forward prices: seasonal multipliers for next 6 months (Jul–Dec)
const FWD_MULT = [1.28, 1.32, 1.18, 1.05, 0.88, 0.82];
const FWD_MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Weekly ADR trend (12 weeks)
const ADR_MULT = [0.85, 0.88, 0.92, 0.98, 1.05, 1.18, 1.32, 1.35, 1.20, 1.04, 0.90, 0.82];

function PricingContent({ area }: { area: string }) {
  const d = AREA_DATA[area];
  const hoodRate = Math.round(d.rate * 1.12);
  const avgRate = Math.round(hoodRate * 1.08);
  const next30Rate = Math.round(hoodRate * FWD_MULT[0]);

  const fwdSeries = FWD_MULT.map((m) => Math.round(hoodRate * m));
  const adrSeries = ADR_MULT.map((m) => Math.round(hoodRate * m));

  const kpis = [
    { label: "Median rate", val: `€${hoodRate}`, accent: true },
    { label: "Average rate", val: `€${avgRate}`, accent: false },
    { label: "Next 30d median", val: `€${next30Rate}`, accent: false },
    { label: "Peak month", val: "August", accent: false },
  ];

  // Bar chart for forward prices by month
  const barMax = Math.max(...fwdSeries);

  return (
    <>
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-1.5 p-2 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl px-2 py-2" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
            <p className="font-display font-bold text-sm leading-none" style={{ color: k.accent ? DT.green : DT.text }}>{k.val}</p>
            <p className="text-[9px] mt-1.5 uppercase tracking-wide font-medium" style={{ color: DT.muted }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Forward prices line chart */}
      <div className="flex-1 mx-2 rounded-xl p-2.5 flex flex-col min-h-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
        <div className="flex items-center justify-between mb-1 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: DT.muted }}>Forward prices · next 6 months</p>
          <p className="text-[9px]" style={{ color: DT.faint }}>median nightly</p>
        </div>
        <div className="flex-1 min-h-0">
          <MiniLineChart series={fwdSeries} gradId="heroPriceFill" />
        </div>
        <div className="flex justify-between mt-1 shrink-0">
          {FWD_MONTHS.map((m, i) => <span key={i} className="text-[8px]" style={{ color: DT.faint }}>{m}</span>)}
        </div>
      </div>

      {/* Weekly ADR + price distribution side by side */}
      <div className="grid grid-cols-2 gap-1.5 mx-2 mt-1.5 shrink-0">
        {/* Weekly ADR bars */}
        <div className="rounded-xl p-2.5" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: DT.muted }}>Weekly ADR</p>
          <div className="flex items-end gap-0.5" style={{ height: 36 }}>
            {adrSeries.map((v, i) => {
              const isPeak = v === Math.max(...adrSeries);
              return (
                <motion.div
                  key={i}
                  className="flex-1 rounded-t-sm"
                  style={{ background: isPeak ? DT.green : "rgba(143,204,128,0.45)" }}
                  initial={{ height: 0 }}
                  animate={{ height: `${(v / Math.max(...adrSeries)) * 36}px` }}
                  transition={{ duration: 0.4, delay: i * 0.04 }}
                />
              );
            })}
          </div>
        </div>

        {/* Forward price by month bars */}
        <div className="rounded-xl p-2.5" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: DT.muted }}>By month</p>
          <div className="flex items-end gap-0.5" style={{ height: 36 }}>
            {fwdSeries.map((v, i) => {
              const isPeak = v === barMax;
              return (
                <motion.div
                  key={i}
                  className="flex-1 rounded-t-sm"
                  style={{ background: isPeak ? DT.green : "rgba(143,204,128,0.45)" }}
                  initial={{ height: 0 }}
                  animate={{ height: `${(v / barMax) * 36}px` }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            {FWD_MONTHS.map((m, i) => <span key={i} className="text-[8px]" style={{ color: DT.faint }}>{m[0]}</span>)}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Dashboard shell — wraps header + tabs + content ────────────────────────

function DashboardShell({
  area,
  tab,
  motionKey,
}: {
  area: string;
  tab: "market" | "pricing";
  motionKey: string;
}) {
  const tabs = [
    { id: "market" as const, label: "Market overview", icon: <BarChart3 size={10} /> },
    { id: "pricing" as const, label: "Pricing", icon: <LineChart size={10} /> },
  ];

  return (
    <motion.div
      key={motionKey}
      className="absolute inset-0 z-10 flex flex-col overflow-hidden"
      style={{ background: DT.bg }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Mini header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: DT.border }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#4A5E3A,#6B7B4F)" }}>
            <span className="text-white font-display text-[10px] font-bold">P</span>
          </div>
          <span className="text-[11px] font-medium truncate" style={{ color: DT.muted }}>Market Dashboard · {area}</span>
        </div>
        <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(143,204,128,0.12)", color: DT.green }}>
          <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: DT.green }} />LIVE
        </span>
      </div>

      {/* Tab bar — driven by stage, not interactive */}
      <div className="flex items-center px-3 border-b shrink-0" style={{ borderColor: DT.border }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <div
              key={t.id}
              className="flex items-center gap-1 px-3 py-2 text-[11px] font-semibold"
              style={active
                ? { color: DT.text, borderBottom: `2px solid ${DT.green}`, marginBottom: -1 }
                : { color: DT.faint, borderBottom: "2px solid transparent", marginBottom: -1 }}
            >
              <span style={{ color: active ? DT.green : DT.faint }}>{t.icon}</span>
              {t.label}
            </div>
          );
        })}
      </div>

      {/* Tab content — animates on switch */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          className="flex-1 flex flex-col overflow-hidden"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
        >
          {tab === "market" ? <MarketContent area={area} /> : <PricingContent area={area} />}
        </motion.div>
      </AnimatePresence>

      {/* CTA */}
      <div className="px-2 py-2 shrink-0">
        <a
          href="/dashboard"
          className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
          style={{ background: DT.olive, color: "#FFFFFF" }}
        >
          Open full dashboard <ArrowRight size={11} />
        </a>
      </div>
    </motion.div>
  );
}

function caption(stage: Stage, area: string) {
  switch (stage) {
    case "map": return "Scanning all of Cyprus";
    case "zoom": return `Zooming into ${area}`;
    case "draw": return `Outlining ${hoodName(area)}`;
    case "market": return `Market overview · ${hoodName(area)}`;
    case "pricing": return `Pricing intelligence · ${hoodName(area)}`;
  }
}

export default function HeroSequence({
  area,
  stage,
  onSelectArea,
}: {
  area: string;
  stage: Stage;
  onSelectArea: (a: string) => void;
}) {
  const mapVisible = stage === "map" || stage === "zoom" || stage === "draw";
  const slug = area.toLowerCase().replace(/\s+/g, "-");
  const steps: { id: Stage; label: string }[] = [
    { id: "map", label: "Scan" },
    { id: "zoom", label: "Zoom" },
    { id: "draw", label: "Draw" },
    { id: "market", label: "Market" },
    { id: "pricing", label: "Pricing" },
  ];
  const activeStep = steps.findIndex((s) => s.id === stage);

  return (
    <div className="w-full">
      <div
        className="rounded-2xl overflow-hidden border"
        style={{
          borderColor: "rgba(255,255,255,0.09)",
          boxShadow: "0 18px 50px -20px rgba(0,0,0,0.5)",
          isolation: "isolate",
        }}
      >
        {/* Chrome bar */}
        <div
          className="flex items-center gap-2 px-4 h-9 border-b"
          style={{ background: "#141910", borderColor: "rgba(255,255,255,0.09)" }}
        >
          <div className="flex gap-1.5">
            {["#E0786B", "#E4C06A", "#7DBE6B"].map((c) => (
              <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
            ))}
          </div>
          <div className="flex-1 flex justify-center">
            <span
              className="text-[10px] font-medium px-3 py-0.5 rounded-md"
              style={{ background: "rgba(255,255,255,0.07)", color: "#ADB8A0", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              propsights.app/{slug}
            </span>
          </div>
          <span className="flex items-center gap-1 text-[9px] font-semibold" style={{ color: "#8FCC80" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#8FCC80" }} />
            LIVE
          </span>
        </div>

        {/* Stage screen */}
        <div className="relative" style={{ height: "clamp(440px, 64vh, 640px)", background: "#E8EDE3" }}>
          <div
            className="absolute inset-0 transition-opacity duration-500"
            style={{
              opacity: mapVisible ? 1 : 0,
              pointerEvents: mapVisible ? "auto" : "none",
              isolation: "isolate",
            }}
          >
            <MapContainer
              center={CYPRUS_CENTER}
              zoom={CYPRUS_ZOOM}
              zoomControl={false}
              attributionControl={true}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              keyboard={false}
              style={{ width: "100%", height: "100%", background: "#E8EDE3" }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                attribution="&copy; OpenStreetMap &copy; CARTO"
                subdomains="abcd"
              />
              {AREAS.map((a) => {
                const d = AREA_DATA[a];
                return (
                  <Marker
                    key={a}
                    position={[d.lat, d.lng]}
                    icon={makeMarkerIcon(a === area)}
                    zIndexOffset={a === area ? 1000 : 0}
                    eventHandlers={{ click: () => onSelectArea(a) }}
                  />
                );
              })}
              <MapController area={area} stage={stage} />
            </MapContainer>
          </div>

          <AnimatePresence mode="wait">
            {stage === "draw" && <DrawOverlay key="draw" area={area} />}
            {stage === "market" && (
              <DashboardShell key={`market-${area}`} area={area} tab="market" motionKey={`market-${area}`} />
            )}
            {stage === "pricing" && (
              <DashboardShell key={`pricing-${area}`} area={area} tab="pricing" motionKey={`pricing-${area}`} />
            )}
          </AnimatePresence>

          {mapVisible && (
            <div className="absolute left-3 bottom-3 z-20 pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.span
                  key={stage}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
                  style={{ background: "#4A5E3A", color: "#FFFFFF", boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#8FCC80" }} />
                  {caption(stage, area)}
                </motion.span>
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-1.5 mt-4">
        {steps.map((s, i) => {
          const done = i <= activeStep;
          return (
            <div key={s.id} className="flex-1 flex flex-col gap-1.5">
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "#4A5E3A" }}
                  animate={{ width: done ? "100%" : "0%" }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <span
                className="text-[10px] font-medium transition-colors"
                style={{ color: i === activeStep ? "#EAF0DF" : "#828D74" }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
