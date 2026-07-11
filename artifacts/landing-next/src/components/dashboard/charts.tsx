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

export interface TrendSeries {
  label: string;
  color: string;
  dashed?: boolean;
  data: Array<{ x: string; y: number | null }>;
}

/**
 * Weekly trend with the contract's realized / "on the books" split: weeks
 * from `splitX` onward sit in a shaded forward region. Optional thin
 * benchmark lines share the x-axis (same week range).
 */
export function TrendChart({
  main,
  benchmarks = [],
  splitX,
  yFmt = (v) => v.toFixed(1),
  xFmt = (x) => x,
  height = 120,
  emptyLabel = "Not enough data yet",
}: {
  main: TrendSeries;
  benchmarks?: TrendSeries[];
  /** First week that is NOT realized (current Cyprus week). */
  splitX: string;
  yFmt?: (v: number) => string;
  xFmt?: (x: string) => string;
  height?: number;
  emptyLabel?: string;
}) {
  const xs$ = main.data.map((p) => p.x);
  const all = [main, ...benchmarks];
  const vals = all.flatMap((s) => s.data.map((p) => p.y)).filter((v): v is number => v != null);

  if (xs$.length < 2 || vals.length < 2) {
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
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const floor = min - span * 0.15;
  const ceil = max + span * 0.1;
  const xi = new Map(xs$.map((x, i) => [x, i]));
  const xs = (i: number) => PAD + (i / (xs$.length - 1)) * (W - PAD * 2);
  const ys = (v: number) => H - 4 - ((v - floor) / (ceil - floor)) * (H - 16);

  const linePts = (s: TrendSeries) =>
    s.data
      .filter((p): p is { x: string; y: number } => p.y != null && xi.has(p.x))
      .map((p) => `${xs(xi.get(p.x)!)},${ys(p.y)}`)
      .join(" ");

  // Forward ("on the books") region starts at the first week >= splitX.
  const splitIdx = xs$.findIndex((x) => x >= splitX);
  const splitPx = splitIdx >= 0 ? xs(splitIdx) : null;

  const mainSeries = main.data.filter((p): p is { x: string; y: number } => p.y != null);
  const last = mainSeries[mainSeries.length - 1];
  const gradId = `tc-${Math.round(max * 7 + min * 3 + xs$.length)}`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ display: "block", height }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={main.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={main.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {splitPx != null && (
          <>
            <rect x={splitPx} y={0} width={W - PAD - splitPx} height={H} fill="rgba(255,255,255,0.045)" />
            <line x1={splitPx} x2={splitPx} y1={2} y2={H - 2} stroke="rgba(234,240,223,0.35)" strokeWidth={1} strokeDasharray="3 3" />
          </>
        )}
        {[0.28, 0.55, 0.82].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {mainSeries.length >= 2 && (
          <polygon
            points={`${xs(xi.get(mainSeries[0].x)!)},${H} ${linePts(main)} ${xs(xi.get(last.x)!)},${H}`}
            fill={`url(#${gradId})`}
          />
        )}
        {benchmarks.map((b) => (
          <polyline
            key={b.label}
            points={linePts(b)}
            fill="none"
            stroke={b.color}
            strokeWidth={1.3}
            strokeDasharray={b.dashed ? "4 3" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.8}
          />
        ))}
        <polyline
          points={linePts(main)}
          fill="none"
          stroke={main.color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {last && <circle cx={xs(xi.get(last.x)!)} cy={ys(last.y)} r={3} fill={main.color} stroke={UI.bg} strokeWidth={1.5} />}
      </svg>
      <div className="flex justify-between items-baseline mt-1.5">
        <span className="text-[11px]" style={{ color: UI.faint }}>
          {xFmt(xs$[0])}
        </span>
        {splitPx != null ? (
          <span className="text-[11px] font-medium" style={{ color: UI.muted }}>
            ← realized · on the books →
          </span>
        ) : (
          last && (
            <span className="text-xs font-semibold" style={{ color: UI.text }}>
              latest <span style={{ color: main.color }}>{yFmt(last.y)}</span>
            </span>
          )
        )}
        <span className="text-[11px]" style={{ color: UI.faint }}>
          {xFmt(xs$[xs$.length - 1])}
        </span>
      </div>
      {benchmarks.length > 0 && (
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: UI.muted }}>
            <span className="w-3 h-[2.5px] rounded-full inline-block" style={{ background: main.color }} />
            {main.label}
          </span>
          {benchmarks.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5 text-[11px]" style={{ color: UI.muted }}>
              <span
                className="w-3 h-[2px] rounded-full inline-block"
                style={{ background: b.color, opacity: 0.85 }}
              />
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Diverging weekly bars around a zero line — e.g. selection occupancy
 * minus benchmark. Positive = above the market, negative = below.
 */
export function GapBars({
  data,
  yFmt = (v) => v.toFixed(1),
  height = 110,
  labelEvery = 4,
  emptyLabel = "Not enough data yet",
}: {
  data: Array<{ label: string; value: number | null }>;
  yFmt?: (v: number) => string;
  height?: number;
  labelEvery?: number;
  emptyLabel?: string;
}) {
  const vals = data.map((d) => d.value).filter((v): v is number => v != null);
  if (vals.length < 2) {
    return (
      <div
        className="h-24 flex items-center justify-center rounded-xl text-sm"
        style={{ background: "rgba(255,255,255,0.04)", color: UI.faint }}
      >
        {emptyLabel}
      </div>
    );
  }
  const maxAbs = Math.max(...vals.map(Math.abs), 0.1);
  const half = height / 2;
  return (
    <div>
      <div className="relative flex items-stretch gap-[3px]" style={{ height }}>
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: half - 0.5, height: 1, background: "rgba(234,240,223,0.25)" }}
        />
        {data.map((d, i) => {
          const v = d.value;
          const h = v == null ? 0 : (Math.abs(v) / maxAbs) * (half - 4);
          const up = (v ?? 0) >= 0;
          return (
            <div key={`${d.label}-${i}`} className="flex-1 relative" title={v != null ? `${d.label}: ${v >= 0 ? "+" : ""}${yFmt(v)}` : d.label}>
              {v != null && (
                <div
                  className="absolute left-0 right-0 rounded-[2px]"
                  style={{
                    height: Math.max(2, h),
                    ...(up ? { bottom: half } : { top: half }),
                    background: up
                      ? "linear-gradient(180deg, #8FCC80, rgba(143,204,128,0.5))"
                      : "linear-gradient(180deg, rgba(217,139,106,0.5), #D98B6A)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`} className="flex-1 text-center text-[10px] truncate" style={{ color: UI.faint }}>
            {i % labelEvery === 0 ? d.label : ""}
          </span>
        ))}
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
