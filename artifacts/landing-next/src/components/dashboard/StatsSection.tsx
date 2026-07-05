"use client";

import { motion } from "framer-motion";
import { Hexagon, Star, X } from "lucide-react";
import type { OccMetric, OccWindow, SelectionStats } from "@/lib/dashboard/types";
import { occOf } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct, occupancyColor, TYPE_GROUP_LABELS } from "@/lib/dashboard/format";
import { areaLabel } from "@/lib/dashboard/areas";
import { UI } from "./tokens";
import TrendChart from "./TrendChart";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg p-0.5 gap-0.5 glass-card">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors whitespace-nowrap"
            style={
              active
                ? { background: UI.olive, color: "#FFFFFF" }
                : { background: "transparent", color: UI.muted }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function StatsSection({
  stats,
  hasPolygon,
  metric,
  window_,
  onMetric,
  onWindow,
  onClearPolygon,
}: {
  stats: SelectionStats | null;
  hasPolygon: boolean;
  metric: OccMetric;
  window_: OccWindow;
  onMetric: (m: OccMetric) => void;
  onWindow: (w: OccWindow) => void;
  onClearPolygon: () => void;
}) {
  const occ = stats ? occOf(stats, metric, window_) : null;
  const noise =
    stats == null
      ? null
      : window_ === "todate"
        ? (stats.rawOccTodate ?? 0) - (stats.effOccTodate ?? 0)
        : (stats.rawOccFwd60 ?? 0) - (stats.effOccFwd60 ?? 0);

  const mixTotal = stats?.typeMix.reduce((s, m) => s + m.count, 0) ?? 0;

  const cards = [
    { label: "Listings", value: stats ? fmtInt(stats.listingCount) : "—" },
    {
      label: `${metric === "eff" ? "Effective" : "Raw"} occupancy`,
      value: fmtPct(occ),
      accent: true,
    },
    { label: "Booking pace · next 60d", value: stats ? fmtPct(stats.effOccFwd60) : "—" },
    { label: "Median rate", value: stats ? fmtEuro(stats.medianRate) : "—" },
    { label: "Average rate", value: stats ? fmtEuro(stats.avgRate) : "—" },
    {
      label: "Calendar noise",
      value: noise != null && stats?.listingCount ? `${noise.toFixed(1)} pts` : "—",
      hint: "raw − effective",
    },
    { label: "Superhost share", value: stats ? fmtPct(stats.superhostShare) : "—" },
  ];

  return (
    <section className="px-3 md:px-4 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2.5 py-3.5">
        <span className="flex items-center gap-2">
          <Hexagon size={14} style={{ color: UI.green }} />
          <h2 className="font-display font-bold text-lg uppercase tracking-wide" style={{ color: UI.text }}>
            {hasPolygon ? "Drawn area" : "All of Cyprus"}
          </h2>
        </span>
        {hasPolygon && (
          <button
            onClick={onClearPolygon}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold transition-colors hover:bg-white/10"
            style={{ color: UI.muted, border: `1px solid ${UI.border}` }}
          >
            <X size={10} /> Clear area
          </button>
        )}
        {!hasPolygon && (
          <span className="text-[11px]" style={{ color: UI.faint }}>
            — draw an area on the map to zoom the numbers in
          </span>
        )}
        <div className="flex-1" />
        <Segmented
          value={metric}
          onChange={onMetric}
          options={[
            { value: "eff", label: "Effective" },
            { value: "raw", label: "Raw" },
          ]}
        />
        <Segmented
          value={window_}
          onChange={onWindow}
          options={[
            { value: "todate", label: "Season to date" },
            { value: "fwd60", label: "Next 60 days" },
          ]}
        />
      </div>

      {/* KPI cards */}
      <motion.div
        key={`${hasPolygon}-${stats?.listingCount ?? "loading"}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2"
      >
        {cards.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl px-3.5 py-3">
            <p
              className="font-display font-bold text-xl leading-none"
              style={{ color: c.accent ? UI.green : UI.text }}
            >
              {c.value}
            </p>
            <p className="text-[9px] mt-1.5 uppercase tracking-wider" style={{ color: UI.muted }}>
              {c.label}
            </p>
            {"hint" in c && c.hint && (
              <p className="text-[9px]" style={{ color: UI.faint }}>
                {c.hint}
              </p>
            )}
          </div>
        ))}
      </motion.div>

      {/* Trend + mix + top listings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mt-2">
        <div className="glass-card rounded-2xl p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: UI.muted }}>
              Weekly {metric === "eff" ? "effective" : "raw"} occupancy
            </p>
            {stats && stats.weekly.length > 0 && stats.weekly[stats.weekly.length - 1].medianAdr != null && (
              <p className="text-[9px]" style={{ color: UI.faint }}>
                latest median ADR {fmtEuro(stats.weekly[stats.weekly.length - 1].medianAdr)}
              </p>
            )}
          </div>
          <TrendChart points={stats?.weekly ?? []} metric={metric} />
        </div>

        <div className="glass-card rounded-2xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: UI.muted }}>
            Property mix
          </p>
          <div className="flex flex-col gap-2.5">
            {(stats?.typeMix ?? []).map((m) => {
              const share = mixTotal ? (100 * m.count) / mixTotal : 0;
              return (
                <div key={m.group}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px]" style={{ color: UI.text }}>
                      {TYPE_GROUP_LABELS[m.group]}
                    </span>
                    <span className="text-[10px] font-semibold" style={{ color: UI.muted }}>
                      {fmtInt(m.count)} · {share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg,#4A5E3A,#8FCC80)" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${share}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>
              );
            })}
            {!stats?.typeMix.length && (
              <p className="text-[11px]" style={{ color: UI.faint }}>
                No listings in selection.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Top listings */}
      <div className="glass-card rounded-2xl p-4 mt-2">
        <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: UI.muted }}>
          Top listings · by effective occupancy
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {(stats?.topListings ?? []).map((l) => {
            const lo = occOf(l, metric, window_);
            return (
              <div
                key={l.id}
                className="rounded-xl p-3 transition-colors hover:bg-white/[0.04]"
                style={{ border: `1px solid ${UI.border}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold leading-snug" style={{ color: UI.text }}>
                    {l.name}
                  </p>
                  <span
                    className="w-2 h-2 rounded-full shrink-0 mt-1"
                    style={{ background: occupancyColor(lo) }}
                  />
                </div>
                <p className="text-[9px] mt-1" style={{ color: UI.muted }}>
                  {areaLabel(l.areaSlug)} · {l.propertyType ?? "—"} · {l.bedrooms ?? "—"} bed
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] font-bold" style={{ color: UI.green }}>
                    {fmtPct(lo)}
                  </span>
                  <span className="text-[10px]" style={{ color: UI.muted }}>
                    {fmtEuro(l.nightlyRate)}/n
                    {l.rating != null && (
                      <>
                        {" · "}
                        <Star size={8} fill={UI.oliveLight} color={UI.oliveLight} className="inline -mt-px" />{" "}
                        {l.rating.toFixed(2)}
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          {!stats?.topListings.length && (
            <p className="text-[11px]" style={{ color: UI.faint }}>
              Nothing to show yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
