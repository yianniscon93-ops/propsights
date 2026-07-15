"use client";

import { useState, type MouseEvent } from "react";
import { UI } from "./tokens";

/** Shared SVG charts for the dashboard — data-green on dark glass. */

const W = 320;

interface TipLine {
  label?: string;
  value: string;
  color?: string;
}

/** Hover tooltip shared by every chart — anchored at a % of the chart width. */
function ChartTip({ xPct, title, lines }: { xPct: number; title: string; lines: TipLine[] }) {
  const x = Math.min(86, Math.max(14, xPct));
  return (
    <div
      className="absolute z-20 pointer-events-none rounded-lg px-2.5 py-1.5 whitespace-nowrap"
      style={{
        left: `${x}%`,
        top: -4,
        transform: "translate(-50%, -100%)",
        background: "rgba(12,16,10,0.96)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
      }}
    >
      <p className="text-[11px] font-semibold" style={{ color: UI.text }}>
        {title}
      </p>
      {lines.map((l, i) => (
        <p key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: UI.muted }}>
          {l.color && (
            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: l.color }} />
          )}
          {l.label}
          <span className="font-semibold" style={{ color: l.color ?? UI.text }}>
            {l.value}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Map a mouse position to the nearest index of an n-point series drawn in the padded viewBox. */
function hoverIndex(e: MouseEvent<HTMLDivElement>, n: number, pad: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const fx = ((e.clientX - rect.left) / rect.width) * W;
  const g = (fx - pad) / (W - pad * 2);
  return Math.max(0, Math.min(n - 1, Math.round(g * (n - 1))));
}

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
  const [hover, setHover] = useState<number | null>(null);

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
      <div
        className="relative"
        onMouseMove={(e) => setHover(hoverIndex(e, series.length, PAD))}
        onMouseLeave={() => setHover(null)}
      >
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
        {hover != null && series[hover] && (
          <line
            x1={xs(hover)}
            x2={xs(hover)}
            y1={2}
            y2={H - 2}
            stroke="rgba(234,240,223,0.3)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <circle
          cx={xs(hover ?? series.length - 1)}
          cy={ys(series[hover ?? series.length - 1].y)}
          r={3}
          fill={UI.green}
          stroke={UI.bg}
          strokeWidth={1.5}
        />
      </svg>
      {hover != null && series[hover] && (
        <ChartTip
          xPct={(xs(hover) / W) * 100}
          title={xFmt(series[hover].x)}
          lines={[{ value: yFmt(series[hover].y) }]}
        />
      )}
      </div>
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
  const [hover, setHover] = useState<number | null>(null);

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

  const hoverX = hover != null ? xs$[hover] : null;
  const atX = (s: TrendSeries) =>
    hoverX != null ? (s.data.find((p) => p.x === hoverX)?.y ?? null) : null;
  const hoverLines: TipLine[] =
    hoverX != null
      ? all
          .map((s) => ({ s, v: atX(s) }))
          .filter((e): e is { s: TrendSeries; v: number } => e.v != null)
          .map(({ s, v }) => ({
            label: all.length > 1 ? s.label : undefined,
            value: yFmt(v),
            color: s.color,
          }))
      : [];

  return (
    <div>
      <div
        className="relative"
        onMouseMove={(e) => setHover(hoverIndex(e, xs$.length, PAD))}
        onMouseLeave={() => setHover(null)}
      >
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
        {hover != null && (
          <line
            x1={xs(hover)}
            x2={xs(hover)}
            y1={2}
            y2={H - 2}
            stroke="rgba(234,240,223,0.3)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hoverX != null &&
          all.map((s) => {
            const v = atX(s);
            return v != null ? (
              <circle key={s.label} cx={xs(hover!)} cy={ys(v)} r={3} fill={s.color} stroke={UI.bg} strokeWidth={1.5} />
            ) : null;
          })}
      </svg>
      {hoverX != null && hoverLines.length > 0 && (
        <ChartTip
          xPct={(xs(hover!) / W) * 100}
          title={`${xFmt(hoverX)}${splitIdx >= 0 && hover! >= splitIdx ? " · on the books" : ""}`}
          lines={hoverLines}
        />
      )}
      </div>
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
  const [hover, setHover] = useState<number | null>(null);
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
  const hv = hover != null ? data[hover] : null;
  return (
    <div>
      <div
        className="relative flex items-stretch gap-[3px]"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: half - 0.5, height: 1, background: "rgba(234,240,223,0.25)" }}
        />
        {data.map((d, i) => {
          const v = d.value;
          const h = v == null ? 0 : (Math.abs(v) / maxAbs) * (half - 4);
          const up = (v ?? 0) >= 0;
          return (
            <div key={`${d.label}-${i}`} className="flex-1 relative" onMouseEnter={() => setHover(i)}>
              {v != null && (
                <div
                  className="absolute left-0 right-0 rounded-[2px]"
                  style={{
                    height: Math.max(2, h),
                    ...(up ? { bottom: half } : { top: half }),
                    background: up
                      ? "linear-gradient(180deg, #8FCC80, rgba(143,204,128,0.5))"
                      : "linear-gradient(180deg, rgba(217,139,106,0.5), #D98B6A)",
                    filter: hover === i ? "brightness(1.25)" : undefined,
                  }}
                />
              )}
            </div>
          );
        })}
        {hv && hv.value != null && (
          <ChartTip
            xPct={((hover! + 0.5) / data.length) * 100}
            title={hv.label}
            lines={[
              {
                value: `${hv.value >= 0 ? "+" : ""}${yFmt(hv.value)}`,
                color: hv.value >= 0 ? UI.green : "#D98B6A",
              },
            ]}
          />
        )}
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

export interface StackSegment {
  key: string;
  label: string;
  color: string;
}

/** 100%-stacked columns — e.g. stay-length mix per month. */
export function StackedBars({
  data,
  segments,
  height = 110,
  emptyLabel = "Not enough data yet",
}: {
  /** values are shares that already sum to ~100 per row. */
  data: Array<{ label: string; values: Record<string, number> }>;
  segments: StackSegment[];
  height?: number;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) {
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
      <div className="relative flex items-end gap-[5px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const total = segments.reduce((s, seg) => s + (d.values[seg.key] ?? 0), 0) || 1;
          return (
            <div
              key={d.label}
              className="flex-1 h-full flex flex-col-reverse rounded-[3px] overflow-hidden"
              style={{ filter: hover === i ? "brightness(1.2)" : undefined }}
              onMouseEnter={() => setHover(i)}
            >
              {segments.map((seg) => (
                <div
                  key={seg.key}
                  style={{
                    height: `${(100 * (d.values[seg.key] ?? 0)) / total}%`,
                    background: seg.color,
                  }}
                />
              ))}
            </div>
          );
        })}
        {hover != null && data[hover] && (
          <ChartTip
            xPct={((hover + 0.5) / data.length) * 100}
            title={data[hover].label}
            lines={segments.map((seg) => ({
              label: seg.label,
              value: `${(data[hover].values[seg.key] ?? 0).toFixed(0)}%`,
              color: seg.color,
            }))}
          />
        )}
      </div>
      <div className="flex gap-[5px] mt-1.5">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[10px] truncate" style={{ color: UI.faint }}>
            {d.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
        {segments.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1.5 text-[11px]" style={{ color: UI.muted }}>
            <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: seg.color }} />
            {seg.label}
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
  showValues = false,
  emptyLabel = "Not enough data yet",
}: {
  data: Array<{ label: string; value: number | null }>;
  yFmt?: (v: number) => string;
  height?: number;
  highlightMax?: boolean;
  /** Show every Nth x-label (sparse labels for dense histograms). */
  labelEvery?: number;
  /** Print each bar's value above it — only for charts with ~12 bars or fewer. */
  showValues?: boolean;
  emptyLabel?: string;
}) {
  const vals = data.map((d) => d.value ?? 0);
  const max = Math.max(...vals, 0);
  const [hover, setHover] = useState<number | null>(null);

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

  // With values on, bars top out below 100% so the label row always fits.
  const cap = showValues ? 82 : 100;

  return (
    <div>
      <div className="relative flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const v = d.value ?? 0;
          const isMax = highlightMax && v === max;
          const pct = Math.max(2, (cap * v) / max);
          const bar = (
            <div
              className="rounded-t-[3px] transition-colors"
              style={{
                height: `${pct}%`,
                background: isMax
                  ? UI.green
                  : "linear-gradient(180deg, rgba(143,204,128,0.75), rgba(74,94,58,0.55))",
                filter: hover === i ? "brightness(1.25)" : undefined,
              }}
            />
          );
          return (
            <div
              key={`${d.label}-${i}`}
              className="flex-1 relative h-full flex flex-col justify-end"
              onMouseEnter={() => setHover(i)}
            >
              {showValues && d.value != null && (
                <span
                  className="absolute left-0 right-0 text-center text-[10px] font-medium whitespace-nowrap"
                  style={{
                    bottom: `calc(${pct}% + 3px)`,
                    color: isMax ? UI.green : UI.muted,
                    fontWeight: isMax ? 600 : 500,
                  }}
                >
                  {yFmt(v)}
                </span>
              )}
              {bar}
            </div>
          );
        })}
        {hover != null && data[hover]?.value != null && (
          <ChartTip
            xPct={((hover + 0.5) / data.length) * 100}
            title={data[hover].label}
            lines={[{ value: yFmt(data[hover].value!) }]}
          />
        )}
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
