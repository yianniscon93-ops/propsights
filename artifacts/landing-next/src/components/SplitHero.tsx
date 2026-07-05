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
const STAGES: Stage[] = ["map", "zoom", "draw", "market", "pricing"];
const STAGE_MS: Record<Stage, number> = {
  map: 2200,
  zoom: 2600,
  draw: 3400,
  market: 3800,
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

          <p className="text-base font-light mb-8 max-w-md" style={{ color: "#6E7D62", lineHeight: 1.7 }}>
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
              style={{ color: "#6E7D62", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              See the products
            </a>
          </div>
        </motion.div>
      </div>

      {/* ── Right: dark side ── */}
      <motion.div
        className="md:w-[44%] flex flex-col justify-center px-6 md:px-10 lg:px-14 py-20 md:py-0"
        style={{ background: "#141910", minHeight: "100vh" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <HeroSequence area={activeArea} stage={stage} onSelectArea={selectArea} />

        <div className="mt-6 pt-5 border-t" style={{ borderColor: "rgba(255,255,255,0.09)" }}>
          <p className="text-xs" style={{ color: "#828D74" }}>
            Based on {AREA_DATA[activeArea]?.listings.toLocaleString() ?? "—"} live listings ·
            {" "}PropSights updates every 48h
          </p>
        </div>
      </motion.div>
    </section>
  );
}
