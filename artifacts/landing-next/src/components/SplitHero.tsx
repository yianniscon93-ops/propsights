"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, BarChart3 } from "lucide-react";
import dynamic from "next/dynamic";
import { AREA_DATA } from "@/lib/areaData";
import type { Stage } from "./HeroSequence";

// Leaflet cannot run on the server — load only on the client.
const HeroSequence = dynamic(() => import("./HeroSequence"), { ssr: false });

const SEQUENCE_AREAS = ["Limassol", "Ayia Napa", "Paphos", "Protaras", "Larnaca", "Polis"];
// Shown until /api/dashboard/summary answers with the real total.
const TOTAL_LISTINGS_FALLBACK = "3,412+";
const AREA_COUNT = Object.keys(AREA_DATA).length;
const STAGES: Stage[] = ["map", "zoom", "draw", "market", "pricing"];
const STAGE_MS: Record<Stage, number> = {
  map: 2600,
  zoom: 2600,
  draw: 4800, // unhurried: 0.5s pause + 2.2s outline + settle on the result
  market: 4400, // includes the ~1.1s scroll-down into the dashboard
  pricing: 3800,
};

function useTypeTo(target: string) {
  const [display, setDisplay] = useState("");
  const curRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      if (cancelled) return;
      const cur = curRef.current;
      if (cur === target) return;

      let next: string;
      let delay: number;
      if (target.startsWith(cur)) {
        next = target.slice(0, cur.length + 1);
        delay = 70 + Math.random() * 50;
      } else {
        next = cur.slice(0, -1);
        delay = 35;
      }
      curRef.current = next;
      setDisplay(next);
      timer = setTimeout(step, delay);
    };

    timer = setTimeout(step, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target]);

  return display;
}

export default function SplitHero() {
  const [areaIdx, setAreaIdx] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [manualArea, setManualArea] = useState<string | null>(null);
  const [totalListings, setTotalListings] = useState<number | null>(null);

  // Real total from the serving layer (falls back to the static claim).
  useEffect(() => {
    fetch("/api/dashboard/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { totalListings?: number } | null) => {
        if (d?.totalListings) setTotalListings(d.totalListings);
      })
      .catch(() => {});
  }, []);

  const activeArea = manualArea ?? SEQUENCE_AREAS[areaIdx];
  const stage = STAGES[stageIdx];
  const typed = useTypeTo(activeArea);

  useEffect(() => {
    const id = setTimeout(() => {
      if (stageIdx < STAGES.length - 1) {
        setStageIdx(stageIdx + 1);
      } else {
        setStageIdx(0);
        setManualArea(null);
        setAreaIdx((i) => (i + 1) % SEQUENCE_AREAS.length);
      }
    }, STAGE_MS[stage]);
    return () => clearTimeout(id);
  }, [stageIdx, areaIdx, manualArea, stage]);

  function selectArea(a: string) {
    setManualArea(a);
    setStageIdx(0);
  }

  return (
    <section className="min-h-screen flex flex-col md:flex-row">
      {/* ── Left: dark side ── */}
      <div
        className="flex-1 md:w-[56%] flex flex-col justify-center px-8 md:px-16 lg:px-20 pt-28 pb-16 md:py-0"
        style={{ background: "#0C100A", minHeight: "100vh" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
            style={{ background: "rgba(74,94,58,0.15)", border: "1px solid rgba(74,94,58,0.3)" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "#8FCC80" }}
            />
            <span className="text-xs font-medium" style={{ color: "#8FCC80" }}>
              Live · Updated every 48 hours
            </span>
          </div>

          <h1
            className="font-display font-bold uppercase mb-7"
            style={{
              fontSize: "clamp(2.8rem,6vw,5.4rem)",
              color: "#FFFFFF",
              letterSpacing: "-0.01em",
              lineHeight: 0.92,
            }}
          >
            Rental
            <br />
            intelligence,
            <br />
            <span style={{ color: "#8FCC80" }}>down to the</span>
            <br />
            <span style={{ color: "#8FCC80" }}>street.</span>
          </h1>

          <p className="text-base mb-8 max-w-md" style={{ color: "#ADB8A0", lineHeight: 1.7 }}>
            Real occupancy, nightly rates, and revenue for every Cyprus rental market — then draw a
            custom area to drill all the way down to a single neighbourhood or street.
          </p>

          {/* Typewriter search bar */}
          <div className="relative mb-8 max-w-md rounded-xl transition-shadow focus-within:ring-2 focus-within:ring-[#8FCC80]/70">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="#6E7D62" strokeWidth="1.5" />
                <path d="M11 11L14 14" stroke="#6E7D62" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>

            <div
              className="absolute inset-0 flex items-center px-4 pl-10 pointer-events-none z-10 rounded-xl"
              style={{ background: "#141910" }}
            >
              <span className="text-sm font-medium" style={{ color: "#D0DCC0" }}>
                {typed}
              </span>
              <span className="cursor-blink ml-0.5 text-sm" style={{ color: "#8FCC80" }}>
                |
              </span>
            </div>

            <select
              value={activeArea}
              onChange={(e) => selectArea(e.target.value)}
              aria-label="Select a Cyprus area"
              className="w-full pl-10 pr-10 py-4 rounded-xl text-sm font-medium appearance-none focus:outline-none transition-all"
              style={{
                background: "#141910",
                border: "1.5px solid rgba(255,255,255,0.1)",
                color: "transparent",
                cursor: "pointer",
              }}
            >
              {Object.keys(AREA_DATA).map((a) => (
                <option key={a} value={a} style={{ background: "#141910", color: "#D0DCC0" }}>
                  {a}
                </option>
              ))}
            </select>

            <ChevronDown
              size={14}
              className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "#6E7D62" }}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href="#access"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "#4A5E3A" }}
            >
              Get Access <ArrowRight size={14} />
            </a>
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium transition-all hover:text-white"
              style={{ color: "#8FCC80", border: "1px solid rgba(143,204,128,0.25)" }}
            >
              <BarChart3 size={14} /> Try dashboard
            </a>
            <a
              href="#products"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium transition-all hover:text-white"
              style={{ color: "#ADB8A0", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              See the products
            </a>
          </div>
        </motion.div>
      </div>

      {/* ── Right: dark side ── */}
      <motion.div
        className="md:w-[44%] flex flex-col justify-center px-6 md:px-10 lg:px-14 pt-24 pb-16 md:pt-24 md:pb-10"
        style={{ background: "#141910", minHeight: "100vh" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        {/* Demo intro — same display voice as the main headline */}
        <div className="mb-5">
          <h2
            className="font-display font-bold uppercase"
            style={{
              fontSize: "clamp(1.5rem,2.4vw,2.2rem)",
              color: "#FFFFFF",
              letterSpacing: "-0.01em",
              lineHeight: 0.95,
            }}
          >
            The dashboard, <span style={{ color: "#8FCC80" }}>working live.</span>
          </h2>
          <p className="text-sm mt-3 max-w-lg" style={{ color: "#ADB8A0", lineHeight: 1.65 }}>
            Draw any boundary on the map and the numbers rebuild for just the listings inside
            it — occupancy, booking pace, and forward prices for the exact streets you care about.
          </p>
        </div>

        <HeroSequence area={activeArea} stage={stage} onSelectArea={selectArea} />

        {/* The one thing to do next — large and unmissable */}
        <a
          href="/dashboard"
          className="mt-5 flex items-center justify-center gap-2.5 w-full py-4 rounded-2xl font-display font-bold uppercase tracking-wide text-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: "linear-gradient(135deg,#4A5E3A,#6B7B4F)",
            color: "#FFFFFF",
            boxShadow: "0 14px 36px -14px rgba(143,204,128,0.4)",
          }}
        >
          Try the dashboard for yourself <ArrowRight size={20} />
        </a>

        {/* Data credentials — big numbers, not small print */}
        <div
          className="mt-5 pt-4 border-t grid grid-cols-3 gap-4"
          style={{ borderColor: "rgba(255,255,255,0.09)" }}
        >
          {[
            {
              val: totalListings ? totalListings.toLocaleString("en-GB") : TOTAL_LISTINGS_FALLBACK,
              label: "Live listings",
              accent: true,
            },
            { val: "48h", label: "Data refresh", accent: false },
            { val: String(AREA_COUNT), label: "Areas covered", accent: false },
          ].map((s) => (
            <div key={s.label}>
              <p
                className="font-display font-bold text-2xl leading-none"
                style={{ color: s.accent ? "#8FCC80" : "#FFFFFF" }}
              >
                {s.val}
              </p>
              <p
                className="text-[11px] mt-1.5 uppercase tracking-wider font-semibold"
                style={{ color: "#ADB8A0" }}
              >
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
