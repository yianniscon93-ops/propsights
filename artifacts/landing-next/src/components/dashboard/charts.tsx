"use client";

import { UI } from "./tokens";

/** Shared SVG charts for the dashboard — data-green on dark glass. */

const W = 320;

export function LineAreaChart({
  data,
  yFmt = (v) => v.toFixed(1),
  xFmt = (x) => x,
  height = 96,
  emptyLabel = "Not enough data yet",
}: {
  data: Array<{ x: string; y: number | null }>;
  yFmt?: (v: number) => string;
  xFmt?: (x: string) => string;
  height?: number;
  emptyLabel?: string;
}) {
  const series = data.filter((p): p is { x: string; y: number } => p.y != null);

  if (series.length < 2) {
    return (
      <div
        className="h-24 flex items-center justify-center rounded-xl text-sm"
        style={{ background: "rgba(255,255,255,0.04)", color: UI.faint }}
      >
        {emptyLabel}
      </div>
    );
  }

  const H = height;
  const PAD = 6;
  const vals = series.map((p) => p.y);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const floor = min - span * 0.15;
  const ceil = max + span * 0.08;

  const xs = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const ys = (v: number) => H - 4 - ((v - floor) / (ceil - floor)) * (H - 14);
  const line = series.map((p, i) => `${xs(i)},${ys(p.y)}`).join(" ");
  const areaPts = `${xs(0)},${H} ${line} ${xs(series.length - 1)},${H}`;
  const last = series[series.length - 1];
  const peak = series.reduce((a, b) => (b.y > a.y ? b : a));
  const gradId = `lac-${Math.round(max * 7 + min * 3 + series.length)}`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ display: "block", height }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={UI.green} stopOpacity="0.24" />
            <stop offset="100%" stopColor={UI.green} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.28, 0.55, 0.82].map((f) => (
          <line
            key={f}
            x1={PAD}
            x2={W - PAD}
            y1={H * f}
            y2={H * f}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}
        <polygon points={areaPts} fill={`url(#${gradId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={UI.green}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={xs(series.length - 1)}
          cy={ys(last.y)}
          r={3}
          fill={UI.green}
          stroke={UI.bg}
          strokeWidth={1.5}
        />
      </svg>
      <div className="flex justify-between items-baseline mt-1.5">
        <span className="text-[11px]" style={{ color: UI.faint }}>
          {xFmt(series[0].x)}
        </span>
        <span className="text-xs font-semibold" style={{ color: UI.text }}>
          latest <span style={{ color: UI.green }}>{yFmt(last.y)}</span>
          <span className="font-normal" style={{ color: UI.faint }}>
            {" "}
            · peak {yFmt(peak.y)}
          </span>
        </span>
        <span className="text-[11px]" style={{ color: UI.faint }}>
          {xFmt(last.x)}
        </span>
      </div>
    </div>
  );
}

export function BarsChart({
  data,
  yFmt = (v) => String(v),
  height = 96,
  highlightMax = false,
  labelEvery = 1,
  emptyLabel = "Not enough data yet",
}: {
  data: Array<{ label: string; value: number | null }>;
  yFmt?: (v: number) => string;
  height?: number;
  highlightMax?: boolean;
  /** Show every Nth x-label (sparse labels for dense histograms). */
  labelEvery?: number;
  emptyLabel?: string;
}) {
  const vals = data.map((d) => d.value ?? 0);
  const max = Math.max(...vals, 0);

  if (!data.length || max === 0) {
    return (
      <div
        className="h-24 flex items-center justify-center rounded-xl text-sm"
        style={{ background: "rgba(255,255,255,0.04)", color: UI.faint }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((d, i) => {
          const v = d.value ?? 0;
          const isMax = highlightMax && v === max;
          return (
            <div
              key={`${d.label}-${i}`}
              className="flex-1 rounded-t-[3px] transition-colors relative group"
              style={{
                height: `${Math.max(2, (100 * v) / max)}%`,
                background: isMax
                  ? UI.green
                  : "linear-gradient(180deg, rgba(143,204,128,0.75), rgba(74,94,58,0.55))",
              }}
              title={`${d.label}: ${yFmt(v)}`}
            />
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {data.map((d, i) => (
          <span
            key={`${d.label}-${i}`}
            className="flex-1 text-center text-[10px] truncate"
            style={{ color: UI.faint }}
          >
            {i % labelEvery === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
