"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import {
  PenLine,
  BarChart3,
  LineChart,
  Hexagon,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AREA_DATA, AREAS } from "@/lib/areaData";
import type { PointRow, PolygonCoords, PricingData, SelectionStats } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct, occupancyColor, TYPE_GROUP_LABELS } from "@/lib/dashboard/format";

export type Stage = "map" | "zoom" | "draw" | "market" | "pricing";

const CYPRUS_CENTER: [number, number] = [34.98, 33.25];
const CYPRUS_ZOOM = 8;
const AREA_ZOOM = 12;
const DRAW_ZOOM = 13;

// Scroll geometry: the inner page is map (one viewport) + dashboard panel
// (0.86 viewport) = 1.86 viewports tall. Scrolling down leaves a 14% sliver
// of the map visible above the panel — like a real mid-scroll dashboard.
const PAGE_H = "186%";
const MAP_H = `${(100 / 186) * 100}%`;
const DASH_H = `${(86 / 186) * 100}%`;
const SCROLL_Y = `-${(86 / 186) * 100}%`;

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

/** Which areas get a price pill at island zoom — the rest stay small dots
    so the east coast (Ayia Napa / Protaras / Kokkinochoria) doesn't pile up. */
const PILL_AREAS = new Set([
  "Limassol", "Ayia Napa", "Paphos", "Protaras", "Larnaca", "Polis", "Nicosia",
]);
// [dx, dy] px nudge for near-neighbour pills that would otherwise overlap.
const PILL_NUDGE: Record<string, [number, number]> = {
  Protaras: [12, -28],
  "Ayia Napa": [18, 26],
  Larnaca: [-12, -8],
};

/** Island-level price pill — self-centred via transform so widths can vary. */
function makePillIcon(area: string, rate: number, active: boolean) {
  const bg = active ? "#4A5E3A" : "rgba(255,255,255,0.95)";
  const color = active ? "#FFFFFF" : "#1A2014";
  const border = active ? "#3B4C2E" : "#D0D9C6";
  const [nx, ny] = PILL_NUDGE[area] ?? [0, 0];
  const html =
    `<span style="display:inline-flex;align-items:center;white-space:nowrap;transform:translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px));` +
    `padding:3px 9px;border-radius:9999px;background:${bg};color:${color};border:1px solid ${border};` +
    `font:600 10px/1.3 var(--font-inter),sans-serif;box-shadow:0 3px 10px rgba(20,30,15,0.28);cursor:pointer;">` +
    `${area} · €${rate}</span>`;
  return L.divIcon({ html, className: "ps-pin-wrap", iconSize: [0, 0], iconAnchor: [0, 0] });
}

function dotRadiusForZoom(z: number): number {
  return z >= 13 ? 4.5 : z >= 11 ? 3 : 2;
}

/**
 * Every listing as a canvas dot coloured by occupancy — the same visual as
 * the real dashboard map, but non-interactive (this is a demo backdrop).
 */
function HeroPointsLayer({ points }: { points: PointRow[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const renderer = L.canvas({ padding: 0.3 });
    const group = L.layerGroup();
    const markers: L.CircleMarker[] = [];
    const r = dotRadiusForZoom(map.getZoom());

    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lng], {
        renderer,
        radius: r,
        weight: 0.5,
        color: "#FFFFFF",
        fillColor: occupancyColor(p.effOccTodate),
        fillOpacity: 0.8,
        interactive: false,
      });
      group.addLayer(m);
      markers.push(m);
    }

    const onZoom = () => {
      const nr = dotRadiusForZoom(map.getZoom());
      for (const m of markers) m.setRadius(nr);
    };
    map.on("zoomend", onZoom);
    group.addTo(map);
    return () => {
      map.off("zoomend", onZoom);
      group.remove();
    };
  }, [map, points]);

  return null;
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
    // market/pricing: the map holds still while the page scrolls past it.
  }, [area, stage, map]);

  return null;
}

const HOOD_BASE: [number, number][] = [
  [34, 34], [48, 28], [62, 31], [70, 42], [68, 56],
  [58, 66], [44, 68], [34, 58], [30, 46],
];

// Screen-space nudge per town so the demo polygon stays on land — the map
// centres on the town, but the coastline sits in a different direction in
// each one (e.g. Polis faces the sea to the north).
const HOOD_OFFSET: Record<string, [number, number]> = {
  Limassol: [-2, -12],
  "Ayia Napa": [-6, -12],
  Paphos: [8, -8],
  Protaras: [-10, -6],
  Larnaca: [-6, -12],
  Polis: [2, 10],
};

function hoodVerts(area: string): [number, number][] {
  const [dx, dy] = HOOD_OFFSET[area] ?? [0, -8];
  return HOOD_BASE.map(([x, y]) => [x + dx, y + dy]);
}

function pathOf(verts: [number, number][]): string {
  return "M" + verts.map(([x, y]) => `${x},${y}`).join(" L") + " Z";
}

// Draw choreography (seconds from entering the draw stage). The cursor leaves
// the Draw button, the outline follows it, handles pop as it passes.
const DRAW_START = 0.5;
const DRAW_DUR = 2.2;
const DRAW_END = DRAW_START + DRAW_DUR;

/**
 * Converts the on-screen demo polygon (percentages of the map container)
 * into real map coordinates once the draw-stage flyTo settles, so the
 * dashboard panel can query the production API for exactly that area.
 */
function PolygonProbe({
  stage,
  area,
  onPolygon,
}: {
  stage: Stage;
  area: string;
  onPolygon: (coords: PolygonCoords) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (stage !== "draw") return;
    let fired = false;
    const compute = () => {
      if (fired) return;
      fired = true;
      const size = map.getSize();
      const coords: PolygonCoords = hoodVerts(area).map(([x, y]) => {
        const ll = map.containerPointToLatLng(
          L.point((x / 100) * size.x, (y / 100) * size.y)
        );
        return [ll.lat, ll.lng];
      });
      onPolygon(coords);
    };
    map.once("moveend", compute);
    const t = setTimeout(compute, 1800); // fallback if the view never moves
    return () => {
      clearTimeout(t);
      map.off("moveend", compute);
    };
  }, [stage, area, map, onPolygon]);

  return null;
}

/** Planar shoelace area of a small lat/lng polygon, in km². */
function polygonKm2(coords: PolygonCoords): string {
  if (coords.length < 3) return "0.0";
  const R = 111320;
  const cosLat = Math.cos((coords[0][0] * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[(i + 1) % coords.length];
    area += lng1 * cosLat * R * (lat2 * R) - lng2 * cosLat * R * (lat1 * R);
  }
  return (Math.abs(area) / 2 / 1e6).toFixed(1);
}

function monthShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short" });
}

/** Up to n evenly spaced month labels for a date series, deduped. */
function sampleLabels(dates: string[], n: number): string[] {
  if (dates.length === 0) return [];
  const count = Math.min(n, dates.length);
  if (count === 1) return [monthShort(dates[0])];
  const labels = Array.from({ length: count }, (_, i) =>
    monthShort(dates[Math.round((i * (dates.length - 1)) / (count - 1))])
  );
  return labels.filter((l, i) => i === 0 || l !== labels[i - 1]);
}

function DrawOverlay({
  area,
  km2,
  listingCount,
}: {
  area: string;
  km2: string | null;
  listingCount: number | null;
}) {
  const reduce = useReducedMotion();
  const hood = hoodName(area);
  const verts = hoodVerts(area);
  const hoodPath = pathOf(verts);
  const dimPath = "M0,0 H100 V100 H0 Z " + hoodPath;
  const n = verts.length;

  // Cursor path: from the Draw button (top centre) down to the first vertex,
  // then around the outline in sync with the stroke animation.
  const cursorX = ["52%", ...verts.map(([x]) => `${x}%`)];
  const cursorY = ["7%", ...verts.map(([, y]) => `${y}%`)];
  const cursorTimes = [0, ...verts.map((_, i) => (DRAW_START + (i / (n - 1)) * DRAW_DUR) / DRAW_END)];

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
          d={dimPath}
          fillRule="evenodd"
          fill="#0C100A"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : DRAW_END + 0.1 }}
        />
        <motion.path
          d={hoodPath}
          fill="#8FCC80"
          stroke="none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.18 }}
          transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : DRAW_END + 0.15 }}
        />
        {/* No non-scaling-stroke here: combined with a stretched viewBox it
            breaks the pathLength dash animation into disconnected segments. */}
        <motion.path
          d={hoodPath}
          fill="none"
          stroke="#1F2A16"
          strokeWidth={0.45}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : DRAW_DUR, delay: reduce ? 0 : DRAW_START, ease: "easeInOut" }}
        />
        {verts.map(([x, y], i) => (
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
            transition={{
              duration: reduce ? 0 : 0.18,
              delay: reduce ? 0 : DRAW_START + (i / (n - 1)) * DRAW_DUR,
            }}
          />
        ))}
      </svg>

      {/* Drawing cursor — leaves the Draw button and traces the outline */}
      {!reduce && (
        <motion.div
          className="absolute z-20"
          style={{ translateX: "-50%", translateY: "-50%" }}
          initial={{ left: "52%", top: "7%", opacity: 0 }}
          animate={{ left: cursorX, top: cursorY, opacity: [0, 1, 1, 0] }}
          transition={{
            left: { duration: DRAW_END, times: cursorTimes, ease: "easeInOut" },
            top: { duration: DRAW_END, times: cursorTimes, ease: "easeInOut" },
            opacity: { duration: DRAW_END + 0.25, times: [0, 0.08, 0.93, 1] },
          }}
        >
          <span
            className="block w-3 h-3 rounded-full"
            style={{
              background: "#FFFFFF",
              border: "2.5px solid #4A5E3A",
              boxShadow: "0 0 0 4px rgba(143,204,128,0.35), 0 2px 8px rgba(20,30,15,0.4)",
            }}
          />
        </motion.div>
      )}

      {/* Completion chip sits at the bottom of the map so it stays visible in
          the map sliver once the page has scrolled down to the dashboard. */}
      <motion.div
        className="absolute bottom-2.5 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : DRAW_END + 0.35 }}
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
          Custom area · {hood} · ~{km2 ?? "…"} km² ·{" "}
          {listingCount != null ? `${fmtInt(listingCount)} listings` : "counting…"}
        </span>
      </motion.div>
    </motion.div>
  );
}


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

function KpiRow({ kpis }: { kpis: Array<{ label: string; val: string; accent: boolean }> }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 p-2 shrink-0">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-xl px-2 py-2" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
          <p className="font-display font-bold text-sm leading-none" style={{ color: k.accent ? DT.green : DT.text }}>{k.val}</p>
          <p className="text-[9px] mt-1.5 uppercase tracking-wide font-medium" style={{ color: DT.muted }}>{k.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Market tab content — real numbers for the drawn polygon ───────────────

function MarketContent({ stats }: { stats: SelectionStats }) {
  const occTarget = Math.round(stats.effOccTodate ?? 0);
  const occ = useCountUp(occTarget, stats);

  const weekly = stats.weekly.filter((w) => w.effOcc != null);
  const series = weekly.map((w) => w.effOcc as number);
  const labels = sampleLabels(weekly.map((w) => w.weekStart), 5);
  const lastAdr = [...weekly].reverse().find((w) => w.medianAdr != null)?.medianAdr ?? null;

  const mixTotal = stats.typeMix.reduce((s, m) => s + m.count, 0);
  const mix = stats.typeMix.filter((m) => m.count > 0).slice(0, 3);

  const kpis = [
    { label: "Listings", val: fmtInt(stats.listingCount), accent: false },
    { label: "Occupancy", val: stats.effOccTodate != null ? `${occ}%` : "—", accent: true },
    { label: "Next 60d", val: fmtPct(stats.effOccFwd60), accent: false },
    { label: "Median ADR", val: fmtEuro(stats.medianRate), accent: false },
  ];

  return (
    <>
      <KpiRow kpis={kpis} />

      {/* Weekly effective occupancy */}
      <div className="flex-1 mx-2 rounded-xl p-2.5 flex flex-col min-h-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
        <div className="flex items-center justify-between mb-1 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: DT.muted }}>Weekly occupancy</p>
          <p className="text-[9px]" style={{ color: DT.faint }}>latest ADR {fmtEuro(lastAdr)}</p>
        </div>
        <div className="flex-1 min-h-0">
          {series.length >= 2 ? (
            <MiniLineChart series={series} gradId="heroMktFill" />
          ) : (
            <p className="text-[10px] mt-2" style={{ color: DT.faint }}>Not enough weekly history</p>
          )}
        </div>
        <div className="flex justify-between mt-1 shrink-0">
          {labels.map((m, i) => <span key={i} className="text-[8px]" style={{ color: DT.faint }}>{m}</span>)}
        </div>
      </div>

      {/* Property mix */}
      <div className="mx-2 mt-1.5 rounded-xl p-2 shrink-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: DT.muted }}>Property mix</p>
        <div className="flex flex-col gap-1">
          {mix.map((m) => {
            const share = mixTotal ? Math.round((100 * m.count) / mixTotal) : 0;
            return (
              <div key={m.group}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-[10px]" style={{ color: DT.text }}>{TYPE_GROUP_LABELS[m.group]}</span>
                  <span className="text-[10px]" style={{ color: DT.muted }}>{share}%</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg,#4A5E3A,#8FCC80)" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${share}%` }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Pricing tab content — real forward prices for the drawn polygon ───────

function PricingContent({ stats, pricing }: { stats: SelectionStats; pricing: PricingData }) {
  const byMonth = pricing.byMonth
    .filter((m): m is { month: string; medianPrice: number } => m.medianPrice != null)
    .slice(0, 6);
  const fwdSeries = byMonth.map((m) => m.medianPrice);
  const fwdLabels = byMonth.map((m) => monthShort(`${m.month}-01T00:00:00Z`));

  const now = Date.now();
  const next30 = pricing.forwardCurve
    .filter((p) => new Date(p.date).getTime() < now + 30 * 86400000)
    .map((p) => p.medianPrice)
    .filter((v): v is number => v != null);
  const next30Med = next30.length
    ? [...next30].sort((a, b) => a - b)[Math.floor(next30.length / 2)]
    : null;

  const peak = byMonth.reduce<{ month: string; medianPrice: number } | null>(
    (a, b) => (a == null || b.medianPrice > a.medianPrice ? b : a),
    null
  );
  const peakLabel = peak
    ? new Date(`${peak.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long" })
    : "—";

  const adrSeries = stats.weekly.map((w) => w.medianAdr).filter((v): v is number => v != null);
  const adrMax = Math.max(...adrSeries, 1);
  const barMax = Math.max(...fwdSeries, 1);

  const kpis = [
    { label: "Median rate", val: fmtEuro(stats.medianRate), accent: true },
    { label: "Average rate", val: fmtEuro(stats.avgRate), accent: false },
    { label: "Next 30d median", val: fmtEuro(next30Med), accent: false },
    { label: "Peak month", val: peakLabel, accent: false },
  ];

  return (
    <>
      <KpiRow kpis={kpis} />

      {/* Forward prices */}
      <div className="flex-1 mx-2 rounded-xl p-2.5 flex flex-col min-h-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
        <div className="flex items-center justify-between mb-1 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: DT.muted }}>Forward prices · next 6 months</p>
          <p className="text-[9px]" style={{ color: DT.faint }}>median nightly</p>
        </div>
        <div className="flex-1 min-h-0">
          {fwdSeries.length >= 2 ? (
            <MiniLineChart series={fwdSeries} gradId="heroPriceFill" />
          ) : (
            <p className="text-[10px] mt-2" style={{ color: DT.faint }}>No forward pricing yet</p>
          )}
        </div>
        <div className="flex justify-between mt-1 shrink-0">
          {fwdLabels.map((m, i) => <span key={i} className="text-[8px]" style={{ color: DT.faint }}>{m}</span>)}
        </div>
      </div>

      {/* Weekly ADR + forward by month */}
      <div className="grid grid-cols-2 gap-1.5 mx-2 mt-1.5 shrink-0">
        <div className="rounded-xl p-2.5" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: DT.muted }}>Weekly ADR</p>
          <div className="flex items-end gap-0.5" style={{ height: 36 }}>
            {adrSeries.map((v, i) => (
              <motion.div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ background: v === adrMax ? DT.green : "rgba(143,204,128,0.45)" }}
                initial={{ height: 0 }}
                animate={{ height: `${(v / adrMax) * 36}px` }}
                transition={{ duration: 0.4, delay: i * 0.03 }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl p-2.5" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: DT.muted }}>By month</p>
          <div className="flex items-end gap-0.5" style={{ height: 36 }}>
            {fwdSeries.map((v, i) => (
              <motion.div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ background: v === barMax ? DT.green : "rgba(143,204,128,0.45)" }}
                initial={{ height: 0 }}
                animate={{ height: `${(v / barMax) * 36}px` }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {fwdLabels.map((m, i) => <span key={i} className="text-[8px]" style={{ color: DT.faint }}>{m[0]}</span>)}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Dashboard panel — mirrors the real page below the map ─────────────────

function SkeletonContent() {
  return (
    <div className="flex-1 flex flex-col animate-pulse min-h-0 pb-2">
      <div className="grid grid-cols-4 gap-1.5 p-2 shrink-0">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl h-12" style={{ background: DT.card, border: `1px solid ${DT.border}` }} />
        ))}
      </div>
      <div className="flex-1 mx-2 rounded-xl min-h-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }} />
      <div className="mx-2 mt-1.5 rounded-xl h-16 shrink-0" style={{ background: DT.card, border: `1px solid ${DT.border}` }} />
    </div>
  );
}

function DashboardPanel({
  tab,
  live,
  stats,
  pricing,
}: {
  tab: "market" | "pricing";
  live: boolean;
  stats: SelectionStats | null;
  pricing: PricingData | null;
}) {
  const tabs = [
    { id: "market" as const, label: "Market overview", icon: <BarChart3 size={10} /> },
    { id: "pricing" as const, label: "Pricing", icon: <LineChart size={10} /> },
  ];

  return (
    <div className="relative flex flex-col overflow-hidden" style={{ height: DASH_H, background: DT.bg }}>
      {/* Context bar — selection + metric toggle, like the real dashboard */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 shrink-0">
        <Hexagon size={12} style={{ color: DT.green }} />
        <span className="font-display font-bold text-sm uppercase tracking-wide leading-none" style={{ color: DT.text }}>
          Drawn area
        </span>
        <span className="text-[10px]" style={{ color: DT.muted }}>
          {stats ? `${fmtInt(stats.listingCount)} listings` : "…"}
        </span>
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold"
          style={{ color: DT.muted, border: `1px solid ${DT.border}` }}
        >
          <X size={9} /> Clear
        </span>
        <div className="flex-1" />
        <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: DT.card, border: `1px solid ${DT.border}` }}>
          <span className="px-2 py-1 rounded-md text-[9px] font-semibold" style={{ background: DT.olive, color: "#FFFFFF" }}>
            Effective
          </span>
          <span className="px-2 py-1 rounded-md text-[9px] font-semibold" style={{ color: DT.faint }}>
            Raw
          </span>
        </div>
      </div>

      {/* Tab bar — driven by stage, not interactive */}
      <div className="flex items-center px-3 border-b shrink-0" style={{ borderColor: DT.border }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <div
              key={t.id}
              className="relative flex items-center gap-1 px-3 py-2 text-[11px] font-semibold"
              style={{ color: active ? DT.text : DT.faint }}
            >
              <span style={{ color: active ? DT.green : DT.faint }}>{t.icon}</span>
              {t.label}
              {active && (
                <motion.span
                  layoutId="heroTabLine"
                  className="absolute inset-x-0 -bottom-px h-0.5"
                  style={{ background: DT.green }}
                />
              )}
            </div>
          );
        })}
        <span className="flex items-center gap-1 px-3 py-2 text-[11px] font-medium select-none" style={{ color: DT.faint }}>
          <Plus size={10} /> More soon
        </span>
      </div>

      {/* Tab content — skeleton until the polygon stats arrive, so charts
          draw themselves as the page scrolls into view */}
      {live && stats ? (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="flex-1 flex flex-col overflow-hidden pb-2"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
          >
            {tab === "market" ? (
              <MarketContent stats={stats} />
            ) : pricing ? (
              <PricingContent stats={stats} pricing={pricing} />
            ) : (
              <SkeletonContent />
            )}
          </motion.div>
        </AnimatePresence>
      ) : (
        <SkeletonContent />
      )}
    </div>
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
  const reduce = useReducedMotion();
  const scrolled = stage === "market" || stage === "pricing";
  const drawVisible = stage === "draw" || scrolled;
  const slug = area.toLowerCase().replace(/\s+/g, "-");

  // Real numbers for the drawn area, fetched from the same API the full
  // dashboard uses (live DB when configured, deterministic demo otherwise).
  const [stats, setStats] = useState<SelectionStats | null>(null);
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [km2, setKm2] = useState<string | null>(null);
  const [points, setPoints] = useState<PointRow[]>([]);

  // Every listing as an occupancy-coloured dot, once per page load.
  useEffect(() => {
    fetch("/api/dashboard/points")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: PointRow[]) => Array.isArray(d) && setPoints(d))
      .catch(() => {});
  }, []);

  const handlePolygon = useCallback((coords: PolygonCoords) => {
    setKm2(polygonKm2(coords));
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygon: coords, filters: {} }),
    };
    fetch("/api/dashboard/stats", opts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SelectionStats | null) => d && setStats(d))
      .catch(() => {});
    fetch("/api/dashboard/pricing", opts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PricingData | null) => d && setPricing(d))
      .catch(() => {});
  }, []);

  // New area, new cycle — drop the previous polygon's numbers.
  useEffect(() => {
    if (stage === "map" || stage === "zoom") {
      setStats(null);
      setPricing(null);
      setKm2(null);
    }
  }, [stage]);

  const steps: { id: Stage; label: string }[] = [
    { id: "map", label: "Scan" },
    { id: "zoom", label: "Zoom" },
    { id: "draw", label: "Draw" },
    { id: "market", label: "Market" },
    { id: "pricing", label: "Pricing" },
  ];
  const activeStep = steps.findIndex((s) => s.id === stage);

  return (
    <div className="w-full relative">
      {/* Ambient glow behind the frame */}
      <div
        aria-hidden
        className="absolute -inset-8 pointer-events-none"
        style={{
          background:
            "radial-gradient(55% 45% at 75% 12%, rgba(143,204,128,0.14), transparent 70%), radial-gradient(45% 40% at 10% 90%, rgba(107,123,79,0.18), transparent 70%)",
          filter: "blur(30px)",
        }}
      />

      <div
        className="relative rounded-2xl overflow-hidden border"
        style={{
          borderColor: "rgba(255,255,255,0.09)",
          boxShadow:
            "0 24px 70px -24px rgba(143,204,128,0.22), 0 18px 50px -20px rgba(0,0,0,0.55)",
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
              propsights.app/dashboard/{slug}
            </span>
          </div>
          <span className="w-10" />
        </div>

        {/* Sticky dashboard header — stays put while the page scrolls under it */}
        <div
          className="flex items-center justify-between px-3 h-9 border-b relative z-30"
          style={{ background: "#0E130B", borderColor: DT.border }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#4A5E3A,#6B7B4F)" }}>
              <span className="text-white font-display text-[10px] font-bold">P</span>
            </div>
            <span className="text-[11px] font-medium truncate" style={{ color: DT.muted }}>
              Market Dashboard · Cyprus STR
            </span>
          </div>
          <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(143,204,128,0.12)", color: DT.green }}>
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: DT.green }} />
            LIVE
          </span>
        </div>

        {/* Scroll viewport — the whole dashboard page moves inside it */}
        <div
          className="relative overflow-hidden"
          style={{ height: "clamp(380px, 44vh, 520px)", background: DT.bg }}
        >
          <motion.div
            className="absolute inset-x-0 top-0 will-change-transform"
            style={{ height: PAGE_H }}
            animate={{ y: scrolled ? SCROLL_Y : "0%" }}
            transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* ── Map section ── */}
            <div className="relative" style={{ height: MAP_H, background: "#E8EDE3" }}>
              {/* isolate Leaflet's internal z-indexes so overlays can sit above */}
              <div className="absolute inset-0" style={{ isolation: "isolate" }}>
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
                <HeroPointsLayer points={points} />
                {AREAS.map((a) => {
                  const d = AREA_DATA[a];
                  return (
                    <Marker
                      key={a}
                      position={[d.lat, d.lng]}
                      icon={
                        stage === "map" && PILL_AREAS.has(a)
                          ? makePillIcon(a, d.rate, a === area)
                          : makeMarkerIcon(stage !== "map" && a === area)
                      }
                      zIndexOffset={a === area ? 1000 : PILL_AREAS.has(a) ? 500 : 0}
                      eventHandlers={{ click: () => onSelectArea(a) }}
                    />
                  );
                })}
                <MapController area={area} stage={stage} />
                <PolygonProbe stage={stage} area={area} onPolygon={handlePolygon} />
              </MapContainer>
              </div>

              <AnimatePresence>
                {drawVisible && (
                  <DrawOverlay
                    key={`draw-${area}`}
                    area={area}
                    km2={km2}
                    listingCount={stats?.listingCount ?? null}
                  />
                )}
              </AnimatePresence>

              {/* Search + draw toolbar, like the real map hero */}
              <div className="absolute left-1/2 -translate-x-1/2 top-2.5 z-20 flex items-center gap-1.5 pointer-events-none">
                <span className="glass-dark rounded-lg pl-2.5 pr-3 h-8 flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color: DT.text }}>
                  <Search size={11} style={{ color: DT.faint }} />
                  {area}
                </span>
                <span
                  className="glass-dark rounded-lg px-3 h-8 flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap"
                  style={
                    stage === "draw"
                      ? { color: DT.green, boxShadow: "0 0 0 1.5px rgba(143,204,128,0.55)" }
                      : { color: DT.text }
                  }
                >
                  <PenLine size={11} style={{ color: DT.green }} />
                  {stage === "draw" ? "Drawing…" : "Draw area"}
                </span>
              </div>

              {/* Filters chip (stand-in for the real filter panel) */}
              <div className="absolute left-2.5 top-2.5 z-20 pointer-events-none">
                <span className="glass-dark rounded-lg px-2.5 h-8 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: DT.text }}>
                  <SlidersHorizontal size={11} style={{ color: DT.green }} />
                  Filters
                </span>
              </div>

              {/* Drawing instructions */}
              <AnimatePresence>
                {stage === "draw" && (
                  <motion.div
                    className="absolute left-1/2 -translate-x-1/2 top-12 z-20 pointer-events-none"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <span className="glass-dark rounded-lg px-3 py-1.5 text-[10px] font-medium whitespace-nowrap" style={{ color: DT.muted }}>
                      Click to add points · ⏎ to finish
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Narrative caption — only while exploring the map */}
              {(stage === "map" || stage === "zoom") && (
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

            {/* ── Dashboard panel below the map ── */}
            <DashboardPanel
              tab={stage === "pricing" ? "pricing" : "market"}
              live={scrolled}
              stats={stats}
              pricing={pricing}
            />
          </motion.div>
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
                className="text-[11px] font-semibold uppercase tracking-wider transition-colors"
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
