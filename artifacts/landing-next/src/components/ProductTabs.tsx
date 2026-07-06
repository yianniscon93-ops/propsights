"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { LayoutDashboard, TrendingUp, BarChart2, Sparkles, FileText, ArrowRight } from "lucide-react";

function DashboardVisual() {
  const rows = [
    { area: "Ayia Napa", occ: 81, rate: 165 },
    { area: "Protaras",  occ: 79, rate: 158 },
    { area: "Limassol",  occ: 74, rate: 142 },
    { area: "Paphos",    occ: 68, rate: 118 },
    { area: "Larnaca",   occ: 63, rate: 94  },
  ];
  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "#FFFFFF", borderColor: "#D0D9C6", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "#D0D9C6", background: "#F2F5EE" }}>
        <span className="text-xs font-semibold tracking-wide" style={{ color: "#1A2014" }}>MARKET OVERVIEW · CYPRUS</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(74,94,58,0.12)", color: "#4A5E3A" }}>LIVE</span>
      </div>
      <div className="p-5 space-y-3.5">
        {rows.map((r, i) => (
          <div key={r.area} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs" style={{ color: "#697264" }}>{r.area}</span>
            <div className="flex-1 h-2 rounded-full" style={{ background: "#EEF2E8" }}>
              <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #4A5E3A, #8FCC80)" }}
                initial={{ width: 0 }} whileInView={{ width: `${r.occ}%` }}
                transition={{ delay: i * 0.08, duration: 0.6 }} viewport={{ once: true }} />
            </div>
            <span className="text-xs font-bold w-8 text-right" style={{ color: "#4A5E3A" }}>{r.occ}%</span>
            <span className="text-xs w-10 text-right" style={{ color: "#697264" }}>€{r.rate}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingVisual() {
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const vals = [88, 94, 102, 98, 148, 185, 172];
  const max = 185;
  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "#FFFFFF", borderColor: "#D0D9C6", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "#D0D9C6", background: "#F2F5EE" }}>
        <span className="text-xs font-semibold tracking-wide" style={{ color: "#1A2014" }}>DYNAMIC PRICING · LIMASSOL</span>
        <span className="text-[10px] font-medium" style={{ color: "#697264" }}>This week</span>
      </div>
      <div className="p-5">
        <div className="flex items-end justify-between gap-1.5" style={{ height: 96 }}>
          {vals.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px]" style={{ color: "#697264" }}>€{v}</span>
              <motion.div className="w-full rounded-t"
                style={{ background: v > 130 ? "linear-gradient(180deg, #4A5E3A 0%, #8FCC80 100%)" : "#D0D9C6" }}
                initial={{ height: 0 }}
                whileInView={{ height: `${(v / max) * 76}px` }}
                transition={{ delay: i * 0.07, duration: 0.5 }} viewport={{ once: true }} />
              <span className="text-[9px]" style={{ color: "#697264" }}>{days[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs" style={{ color: "#697264" }}>Weekend premium: +89% · Driven by real demand signals</p>
      </div>
    </div>
  );
}

function MarketVisual() {
  const items = [
    { name: "Beachfront Villa 3br", occ: 82, rate: 178, trend: "+12%", up: true },
    { name: "Central Apt Studio",   occ: 61, rate: 95,  trend: "−3%",  up: false },
    { name: "Sea-view Suite 2br",   occ: 75, rate: 149, trend: "+7%",  up: true  },
    { name: "Garden Cottage",       occ: 55, rate: 82,  trend: "±0%",  up: null  },
  ];
  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "#FFFFFF", borderColor: "#D0D9C6", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "#D0D9C6", background: "#F2F5EE" }}>
        <span className="text-xs font-semibold tracking-wide" style={{ color: "#1A2014" }}>COMPETITIVE SET · AYIA NAPA</span>
        <span className="text-[10px] font-medium" style={{ color: "#697264" }}>14 comps</span>
      </div>
      <div>
        {items.map((item, i) => (
          <motion.div key={item.name}
            initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07 }} viewport={{ once: true }}
            className="flex items-center justify-between px-5 py-3 border-b last:border-0"
            style={{ borderColor: "#EEF2E8" }}>
            <div>
              <p className="text-xs font-medium" style={{ color: "#1A2014" }}>{item.name}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "#697264" }}>{item.occ}% occ · €{item.rate}/night</p>
            </div>
            <span className="text-xs font-bold px-2 py-0.5 rounded"
              style={{
                background: item.up === true ? "rgba(74,94,58,0.1)" : item.up === false ? "rgba(200,60,60,0.08)" : "rgba(0,0,0,0.05)",
                color: item.up === true ? "#4A5E3A" : item.up === false ? "#b33" : "#697264",
              }}>{item.trend}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function PredictionsVisual() {
  const hist = [55, 60, 64, 68, 72, 76, 78];
  const fut  = [78, 82, 85, 88, 84];
  const all  = [...hist, ...fut];
  const W = 300; const H = 120; const pad = 20;
  const xs = (i: number) => pad + (i / (all.length - 1)) * (W - pad * 2);
  const ys = (v: number) => H - pad - ((v - 50) / 42) * (H - pad * 2);
  const hPts = hist.map((v, i) => `${xs(i)},${ys(v)}`).join(" ");
  const fPts = [hist[hist.length - 1], ...fut].map((v, i) => `${xs(i + hist.length - 1)},${ys(v)}`).join(" ");
  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "#FFFFFF", borderColor: "#D0D9C6", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "#D0D9C6", background: "#F2F5EE" }}>
        <span className="text-xs font-semibold tracking-wide" style={{ color: "#1A2014" }}>OCCUPANCY FORECAST</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(74,94,58,0.12)", color: "#4A5E3A" }}>AI model</span>
      </div>
      <div className="px-5 py-4">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
          <defs>
            <linearGradient id="hGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4A5E3A" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#4A5E3A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polyline points={hPts} fill="none" stroke="#4A5E3A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={fPts} fill="none" stroke="#8FCC80" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
          {fut.map((v, i) => (
            <motion.circle key={i} cx={xs(i + hist.length)} cy={ys(v)} r="3.5" fill="#8FCC80"
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
              transition={{ delay: 0.4 + i * 0.1 }} viewport={{ once: true }} />
          ))}
        </svg>
        <div className="flex items-center gap-5 mt-1 text-[10px]" style={{ color: "#697264" }}>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded inline-block" style={{ background: "#4A5E3A" }} />Historical
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed inline-block" style={{ borderColor: "#8FCC80" }} />Forecast
          </span>
        </div>
      </div>
    </div>
  );
}

function ReportsVisual() {
  const rows = [
    { label: "Revenue this week",  val: "€3,240", delta: "+12%",   up: true  },
    { label: "Occupancy rate",     val: "78%",     delta: "+3pp",   up: true  },
    { label: "Avg booking value",  val: "€162",    delta: "−€8",    up: false },
    { label: "Market position",    val: "Top 18%", delta: "↑2",     up: true  },
  ];
  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "#FFFFFF", borderColor: "#D0D9C6", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
      <div className="px-5 py-3.5 flex items-center justify-between" style={{ background: "#1A2014" }}>
        <div>
          <p className="text-xs font-semibold tracking-wide text-white">WEEKLY REPORT</p>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Week 26 · Limassol portfolio</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded font-medium" style={{ background: "rgba(143,204,128,0.15)", color: "#8FCC80" }}>PDF ready</span>
      </div>
      <div>
        {rows.map((r, i) => (
          <motion.div key={r.label}
            initial={{ opacity: 0, x: 10 }} whileInView={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07 }} viewport={{ once: true }}
            className="flex items-center justify-between px-5 py-3 border-b last:border-0"
            style={{ borderColor: "#EEF2E8" }}>
            <p className="text-xs" style={{ color: "#697264" }}>{r.label}</p>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base" style={{ color: "#1A2014" }}>{r.val}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: r.up ? "rgba(74,94,58,0.1)" : "rgba(200,60,60,0.08)", color: r.up ? "#4A5E3A" : "#b33" }}>
                {r.delta}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  {
    id: "dashboard",
    name: "Dashboard",
    Icon: LayoutDashboard,
    num: "01",
    headline: "Full market visibility,\nin one view.",
    body: "Every listing in every Cyprus district — occupancy, nightly rate, booking velocity, and gross yield. Updated every 48 hours. No sampling, no extrapolation.",
    Visual: DashboardVisual,
  },
  {
    id: "pricing",
    name: "Dynamic Pricing",
    Icon: TrendingUp,
    num: "02",
    headline: "The right rate,\nnot last week's average.",
    body: "Day-by-day demand signals let you price ahead of the market. When demand spikes, you'll know before competitors do — and adjust before you lose revenue.",
    Visual: PricingVisual,
  },
  {
    id: "market",
    name: "Market Analysis",
    Icon: BarChart2,
    num: "03",
    headline: "See who's winning\n— and why.",
    body: "Every active listing in your competitive set: what they charge, how full they are, and where the gaps are. Built for Cyprus, where the market moves by micro-area.",
    Visual: MarketVisual,
  },
  {
    id: "predictions",
    name: "Predictions",
    Icon: Sparkles,
    num: "04",
    headline: "Know next month\nbefore it happens.",
    body: "Econometric models trained on Cyprus-specific booking patterns predict occupancy and revenue weeks in advance. Plan your calendar — don't react to it.",
    Visual: PredictionsVisual,
  },
  {
    id: "reports",
    name: "Property Reports",
    Icon: FileText,
    num: "05",
    headline: "Your portfolio numbers,\nready to share.",
    body: "A weekly PDF every Monday. Revenue, occupancy, market position, and next-week pricing guidance — formatted cleanly for owners, investors, and partners.",
    Visual: ReportsVisual,
  },
];

export default function ProductTabs() {
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const tab = TABS[active];

  return (
    <section id="products" ref={ref} className="py-24 px-6" style={{ background: "#FFFFFF" }}>
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-14"
        >
          <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: "#4A5E3A" }}>
            Five products. One subscription.
          </p>
          <h2
            className="font-display font-bold uppercase"
            style={{ fontSize: "clamp(2.2rem,5vw,3.5rem)", color: "#1A2014", lineHeight: 1.0, letterSpacing: "-0.01em" }}
          >
            Everything you need to
            <br />
            <span style={{ color: "#4A5E3A" }}>understand your market.</span>
          </h2>
        </motion.div>

        <div className="flex gap-0 border-b mb-14 overflow-x-auto" style={{ borderColor: "#D0D9C6" }}>
          {TABS.map((t, i) => {
            const Icon = t.Icon;
            const isActive = active === i;
            return (
              <button
                key={t.id}
                onClick={() => setActive(i)}
                className="relative flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-all"
                style={{ color: isActive ? "#1A2014" : "#697264" }}
              >
                <Icon size={14} />
                <span>{t.name}</span>
                {isActive && (
                  <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ background: "#4A5E3A" }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="grid md:grid-cols-2 gap-12 lg:gap-20 items-center"
          >
            <div>
              <div className="flex items-center gap-3 mb-6">
                <span className="font-mono text-xs" style={{ color: "#D0D9C6" }}>{tab.num}</span>
                <div className="h-px flex-1 max-w-8" style={{ background: "#D0D9C6" }} />
                <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#4A5E3A" }}>
                  {tab.name}
                </span>
              </div>
              <h3
                className="font-display font-bold uppercase leading-none mb-6"
                style={{ fontSize: "clamp(2rem,4.5vw,3.2rem)", color: "#1A2014", whiteSpace: "pre-line", letterSpacing: "-0.01em" }}
              >
                {tab.headline}
              </h3>
              <p className="text-base leading-relaxed mb-8" style={{ color: "#4C5546" }}>
                {tab.body}
              </p>
              {tab.id === "dashboard" && (
                <a
                  href="/dashboard"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold mb-4 transition-all hover:opacity-90"
                  style={{ background: "#4A5E3A", color: "#FFFFFF" }}
                >
                  Try the market comparison tool <ArrowRight size={14} />
                </a>
              )}
              <a
                href="#access"
                className="inline-flex items-center gap-2 text-sm font-semibold transition-all hover:gap-3"
                style={{ color: "#4A5E3A" }}
              >
                Get access <ArrowRight size={14} />
              </a>
            </div>

            <div>
              <tab.Visual />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
