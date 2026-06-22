import { useRef, useEffect, useState } from "react";
import { useInView } from "framer-motion";

function useCountUp(target: number, active: boolean) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    setVal(0);
    let start: number | null = null;
    const duration = 900;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * target));
      if (p < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [active, target]);
  return val;
}

const STATS = [
  { value: 3412, suffix: "+", label: "Listings tracked" },
  { value: 12,   suffix: "",  label: "Cyprus districts" },
  { value: 48,   suffix: "h", label: "Data refresh cycle" },
  { value: 2,    suffix: "+ yrs", label: "Historical data" },
];

function Stat({ stat, active, delay }: { stat: typeof STATS[0]; active: boolean; delay: number }) {
  const val = useCountUp(stat.value, active);
  return (
    <div className="text-center px-6 py-2"
      style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="font-display font-bold leading-none mb-1"
        style={{ fontSize: "clamp(1.8rem,4vw,2.5rem)", color: "#FFFFFF", transition: `opacity 0.4s ${delay}ms` }}>
        {val.toLocaleString()}{stat.suffix}
      </p>
      <p className="text-xs font-medium" style={{ color: "#6E7D62" }}>{stat.label}</p>
    </div>
  );
}

export default function CredibilityStrip() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <section id="credibility" ref={ref}
      className="py-10 border-y"
      style={{ background: "#0C100A", borderColor: "rgba(255,255,255,0.06)" }}>
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4">
        {STATS.map((s, i) => (
          <Stat key={s.label} stat={s} active={inView} delay={i * 100} />
        ))}
      </div>
    </section>
  );
}
