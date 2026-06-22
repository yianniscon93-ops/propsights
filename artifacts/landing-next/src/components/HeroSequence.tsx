"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { Building2, Star, MapPin, TrendingUp, PenLine } from "lucide-react";
import { AREA_DATA, AREAS } from "@/lib/areaData";

export type Stage = "map" | "zoom" | "draw" | "listings" | "dashboard";

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

const LISTING_TEMPLATES = [
  { name: "Seafront Apartment", kind: "Entire apartment", beds: 2, mult: 1.14, occ: 6 },
  { name: "Hillside Villa", kind: "Entire villa", beds: 3, mult: 1.46, occ: -3 },
  { name: "Town Centre Studio", kind: "Studio", beds: 1, mult: 0.79, occ: 2 },
];
const THUMBS = [
  "linear-gradient(135deg,#4A5E3A 0%,#8FCC80 100%)",
  "linear-gradient(135deg,#26331C 0%,#6B7B4F 100%)",
  "linear-gradient(135deg,#6B7B4F 0%,#A8C290 100%)",
];

function sampleListings(area: string) {
  const d = AREA_DATA[area];
  return LISTING_TEMPLATES.map((t, i) => ({
    id: i,
    name: t.name,
    kind: t.kind,
    beds: t.beds,
    rate: Math.round(d.rate * 1.12 * t.mult),
    occ: Math.max(42, Math.min(98, d.occupancy + 7 + t.occ)),
    rating: (4.72 + i * 0.07).toFixed(2),
    reviews: 38 + ((d.listings * (i + 3)) % 170),
  }));
}

function ListingsView({ area }: { area: string }) {
  const hood = hoodName(area);
  const listings = sampleListings(area);
  return (
    <motion.div
      key="listings"
      className="absolute inset-0 z-10 flex flex-col p-4 md:p-5"
      style={{ background: "#FFFFFF" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin size={13} style={{ color: "#4A5E3A" }} className="shrink-0" />
          <span className="text-xs font-semibold truncate" style={{ color: "#1A2014" }}>
            {hood}
          </span>
          <span className="text-[10px] shrink-0" style={{ color: "#9AA690" }}>
            · {area}
          </span>
        </div>
        <span className="text-[11px] font-medium shrink-0" style={{ color: "#697264" }}>
          {hoodListingCount(area)} listings
        </span>
      </div>

      <div className="flex-1 flex flex-col gap-2.5 min-h-0">
        {listings.map((l, i) => (
          <motion.div
            key={l.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + i * 0.12, duration: 0.35 }}
            className="flex-1 flex items-center gap-3 rounded-xl p-2.5 border"
            style={{ borderColor: "#E4EADB", background: "#FFFFFF" }}
          >
            <div
              className="w-16 h-16 rounded-lg shrink-0 flex items-center justify-center"
              style={{ background: THUMBS[i] }}
            >
              <Building2 size={22} color="rgba(255,255,255,0.85)" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold truncate" style={{ color: "#1A2014" }}>
                  {l.name}
                </p>
                <span className="flex items-center gap-0.5 shrink-0">
                  <Star size={11} fill="#4A5E3A" color="#4A5E3A" />
                  <span className="text-[11px] font-semibold" style={{ color: "#1A2014" }}>
                    {l.rating}
                  </span>
                </span>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: "#697264" }}>
                {l.kind} · {l.beds} bed · {l.reviews} reviews
              </p>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px]" style={{ color: "#697264" }}>
                  <span className="font-semibold" style={{ color: "#4A5E3A" }}>
                    {l.occ}%
                  </span>{" "}
                  occupancy
                </span>
                <span className="font-display font-bold text-sm" style={{ color: "#1A2014" }}>
                  €{l.rate}
                  <span className="text-[10px] font-normal" style={{ color: "#697264" }}>
                    {" "}/night
                  </span>
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

const SEASON = [0.62, 0.66, 0.74, 0.85, 0.95, 1.06, 1.16, 1.18, 1.04, 0.9, 0.72, 0.66];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function DashboardView({ area }: { area: string }) {
  const d = AREA_DATA[area];
  const hood = hoodName(area);

  const cityOcc = d.occupancy;
  const cityRate = d.rate;
  const hoodOcc = Math.min(98, d.occupancy + 7);
  const hoodRate = Math.round(d.rate * 1.12);
  const monthly = Math.round((hoodRate * 30 * hoodOcc) / 100);
  const listings = hoodListingCount(area);
  const occDelta = hoodOcc - cityOcc;

  const occ = useCountUp(hoodOcc, area);
  const rate = useCountUp(hoodRate, area);
  const mon = useCountUp(monthly, area);

  const series = SEASON.map((m) => Math.min(98, Math.round(hoodOcc * m)));
  const W = 300;
  const H = 64;
  const pad = 4;
  const maxV = Math.max(...series);
  const floor = Math.min(...series) - 8;
  const xs = (i: number) => pad + (i / (series.length - 1)) * (W - pad * 2);
  const ys = (v: number) => H - 3 - ((v - floor) / Math.max(1, maxV - floor)) * (H - 10);
  const linePts = series.map((v, i) => `${xs(i)},${ys(v)}`).join(" ");
  const areaPts = `${xs(0)},${H} ${linePts} ${xs(series.length - 1)},${H}`;

  const adrMax = Math.round(hoodRate * 1.15);
  const comps = [
    { label: "Occupancy", hood: `${hoodOcc}%`, city: `${cityOcc}%`, pct: hoodOcc, cityPct: cityOcc, max: 100 },
    { label: "Median ADR", hood: `€${hoodRate}`, city: `€${cityRate}`, pct: hoodRate, cityPct: cityRate, max: adrMax },
  ];

  return (
    <motion.div
      key="dashboard"
      className="absolute inset-0 z-10 flex flex-col p-4 md:p-5"
      style={{ background: "#FFFFFF" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-end justify-between mb-3.5 shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.16em] uppercase truncate" style={{ color: "#697264" }}>
            {hood} · {area}
          </p>
          <div className="flex items-end gap-1.5 mt-0.5 leading-none">
            <span
              className="font-display font-bold leading-none"
              style={{ fontSize: "clamp(2.6rem,6.5vw,3.6rem)", color: "#1A2014" }}
            >
              {occ}
            </span>
            <span className="font-display font-bold text-2xl mb-1" style={{ color: "#4A5E3A" }}>
              %
            </span>
            <span
              className="flex items-center gap-0.5 text-[10px] font-bold mb-2 px-1.5 py-0.5 rounded"
              style={{ background: "rgba(74,94,58,0.12)", color: "#4A5E3A" }}
            >
              <TrendingUp size={10} /> +{occDelta} vs {area}
            </span>
          </div>
          <p className="text-[11px]" style={{ color: "#697264" }}>
            average occupancy
          </p>
        </div>
        <span
          className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full shrink-0"
          style={{ background: "rgba(74,94,58,0.12)", color: "#4A5E3A" }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#8FCC80" }} />
          LIVE
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 shrink-0">
        {[
          { label: "Median ADR", val: `€${rate}` },
          { label: "Est. monthly", val: `€${mon.toLocaleString()}` },
          { label: "Active listings", val: listings.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="rounded-lg p-2.5" style={{ background: "#F2F5EE", border: "1px solid #E4EADB" }}>
            <p className="font-display font-bold text-base" style={{ color: "#1A2014" }}>
              {s.val}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "#697264" }}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      <div className="flex-1 rounded-xl p-3 flex flex-col min-h-0 mb-3" style={{ background: "#F2F5EE", border: "1px solid #E4EADB" }}>
        <div className="flex items-center justify-between mb-1.5 shrink-0">
          <p className="text-[10px] font-semibold" style={{ color: "#697264" }}>
            Occupancy · by month
          </p>
          <p className="text-[9px]" style={{ color: "#9AA690" }}>
            Peak Jul–Aug
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" style={{ display: "block" }}>
            <defs>
              <linearGradient id="seasonFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4A5E3A" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#4A5E3A" stopOpacity="0" />
              </linearGradient>
            </defs>
            <motion.polygon
              points={areaPts}
              fill="url(#seasonFill)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            />
            <motion.polyline
              points={linePts}
              fill="none"
              stroke="#4A5E3A"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: "easeInOut" }}
            />
          </svg>
        </div>
        <div className="flex justify-between mt-1 shrink-0">
          {MONTHS.map((m, i) => (
            <span key={i} className="text-[8px]" style={{ color: "#9AA690" }}>
              {m}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 shrink-0">
        {comps.map((c) => (
          <div key={c.label} className="rounded-lg p-2.5" style={{ background: "#F2F5EE", border: "1px solid #E4EADB" }}>
            <p className="text-[10px] font-semibold mb-1.5" style={{ color: "#1A2014" }}>
              {c.label}
            </p>
            <div className="relative h-1.5 rounded-full" style={{ background: "#E4EADB" }}>
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: "linear-gradient(90deg,#4A5E3A,#8FCC80)" }}
                initial={{ width: 0 }}
                animate={{ width: `${(c.pct / c.max) * 100}%` }}
                transition={{ duration: 0.6, delay: 0.25 }}
              />
              <span
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full"
                style={{ left: `${(c.cityPct / c.max) * 100}%`, background: "#697264" }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] font-bold" style={{ color: "#4A5E3A" }}>
                {c.hood}
              </span>
              <span className="text-[9px]" style={{ color: "#9AA690" }}>
                {area} {c.city}
              </span>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function caption(stage: Stage, area: string) {
  switch (stage) {
    case "map": return "Scanning all of Cyprus";
    case "zoom": return `Zooming into ${area}`;
    case "draw": return `Outlining ${hoodName(area)}`;
    case "listings": return `${hoodListingCount(area)} listings in ${hoodName(area)}`;
    case "dashboard": return `${hoodName(area)} insights`;
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
    { id: "listings", label: "Listings" },
    { id: "dashboard", label: "Dashboard" },
  ];
  const activeStep = steps.findIndex((s) => s.id === stage);

  return (
    <div className="w-full">
      <div
        className="rounded-2xl overflow-hidden border"
        style={{
          borderColor: "#D0D9C6",
          boxShadow: "0 18px 50px -20px rgba(20,30,15,0.35)",
          isolation: "isolate",
        }}
      >
        {/* Chrome bar */}
        <div
          className="flex items-center gap-2 px-4 h-9 border-b"
          style={{ background: "#F2F5EE", borderColor: "#D0D9C6" }}
        >
          <div className="flex gap-1.5">
            {["#E0786B", "#E4C06A", "#7DBE6B"].map((c) => (
              <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
            ))}
          </div>
          <div className="flex-1 flex justify-center">
            <span
              className="text-[10px] font-medium px-3 py-0.5 rounded-md"
              style={{ background: "#FFFFFF", color: "#697264", border: "1px solid #E4EADB" }}
            >
              propsights.app/{slug}
            </span>
          </div>
          <span className="flex items-center gap-1 text-[9px] font-semibold" style={{ color: "#4A5E3A" }}>
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
            {stage === "listings" && <ListingsView key="listings" area={area} />}
            {stage === "dashboard" && <DashboardView key="dashboard" area={area} />}
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
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "#E4EADB" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "#4A5E3A" }}
                  animate={{ width: done ? "100%" : "0%" }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <span
                className="text-[10px] font-medium transition-colors"
                style={{ color: i === activeStep ? "#1A2014" : "#9AA690" }}
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
