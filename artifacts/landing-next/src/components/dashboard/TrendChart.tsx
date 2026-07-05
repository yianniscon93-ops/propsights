"use client";

import type { OccMetric, WeeklyPoint } from "@/lib/dashboard/types";
import { UI } from "./tokens";

const W = 320;
const H = 88;
const PAD = 6;

export default function TrendChart({
  points,
  metric,
}: {
  points: WeeklyPoint[];
  metric: OccMetric;
}) {
  const series = points
    .map((p) => ({ week: p.weekStart, v: metric === "eff" ? p.effOcc : p.rawOcc }))
    .filter((p): p is { week: string; v: number } => p.v != null);

  if (series.length < 2) {
    return (
      <div
        className="h-24 flex items-center justify-center rounded-xl text-[11px]"
        style={{ background: UI.surface2, color: UI.faint }}
      >
        Not enough weekly history yet
      </div>
    );
  }

  const vals = series.map((p) => p.v);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const floor = Math.max(0, min - 8);
  const ceil = Math.min(100, max + 4);

  const xs = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const ys = (v: number) => H - 4 - ((v - floor) / Math.max(1, ceil - floor)) * (H - 14);
  const line = series.map((p, i) => `${xs(i)},${ys(p.v)}`).join(" ");
  const areaPts = `${xs(0)},${H} ${line} ${xs(series.length - 1)},${H}`;

  const fmtWeek = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const last = series[series.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ display: "block" }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={UI.green} stopOpacity="0.22" />
            <stop offset="100%" stopColor={UI.green} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD}
            x2={W - PAD}
            y1={H * f}
            y2={H * f}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
          />
        ))}
        <polygon points={areaPts} fill="url(#trendFill)" />
        <polyline
          points={line}
          fill="none"
          stroke={UI.green}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={xs(series.length - 1)} cy={ys(last.v)} r={3} fill={UI.green} stroke={UI.bg} strokeWidth={1.5} />
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[9px]" style={{ color: UI.faint }}>
          wk of {fmtWeek(series[0].week)}
        </span>
        <span className="text-[9px] font-semibold" style={{ color: UI.muted }}>
          latest {last.v.toFixed(1)}%
        </span>
        <span className="text-[9px]" style={{ color: UI.faint }}>
          wk of {fmtWeek(last.week)}
        </span>
      </div>
    </div>
  );
}
