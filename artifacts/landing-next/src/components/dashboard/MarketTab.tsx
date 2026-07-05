"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { OccMetric, OccWindow, SelectionStats } from "@/lib/dashboard/types";
import { occOf } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct, occupancyColor, TYPE_GROUP_LABELS } from "@/lib/dashboard/format";
import { areaLabel } from "@/lib/dashboard/areas";
import { UI } from "./tokens";
import { LineAreaChart } from "./charts";

const fmtWeek = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function MarketTab({
  stats,
  metric,
  window_,
}: {
  stats: SelectionStats | null;
  metric: OccMetric;
  window_: OccWindow;
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
    <div>
      {/* KPI cards */}
      <motion.div
        key={stats?.listingCount ?? "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5"
      >
        {cards.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl px-4 py-3.5">
            <p
              className="font-display font-bold text-2xl leading-none"
              style={{ color: c.accent ? UI.green : UI.text }}
            >
              {c.value}
            </p>
            <p className="text-[11px] mt-2 uppercase tracking-wider font-medium" style={{ color: UI.muted }}>
              {c.label}
            </p>
            {"hint" in c && c.hint && (
              <p className="text-[11px]" style={{ color: UI.faint }}>
                {c.hint}
              </p>
            )}
          </div>
        ))}
      </motion.div>

      {/* Trend + mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mt-2.5">
        <div className="glass-card rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: UI.text }}>
              Weekly {metric === "eff" ? "effective" : "raw"} occupancy
            </p>
            {stats && stats.weekly.length > 0 && stats.weekly[stats.weekly.length - 1].medianAdr != null && (
              <p className="text-xs" style={{ color: UI.muted }}>
                latest median ADR{" "}
                <span className="font-semibold" style={{ color: UI.text }}>
                  {fmtEuro(stats.weekly[stats.weekly.length - 1].medianAdr)}
                </span>
              </p>
            )}
          </div>
          <LineAreaChart
            data={(stats?.weekly ?? []).map((w) => ({
              x: w.weekStart,
              y: metric === "eff" ? w.effOcc : w.rawOcc,
            }))}
            yFmt={(v) => `${v.toFixed(1)}%`}
            xFmt={fmtWeek}
            height={110}
            emptyLabel="Not enough weekly history yet"
          />
        </div>

        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-wider mb-3.5" style={{ color: UI.text }}>
            Property mix
          </p>
          <div className="flex flex-col gap-3">
            {(stats?.typeMix ?? []).map((m) => {
              const share = mixTotal ? (100 * m.count) / mixTotal : 0;
              return (
                <div key={m.group}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium" style={{ color: UI.text }}>
                      {TYPE_GROUP_LABELS[m.group]}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: UI.muted }}>
                      {fmtInt(m.count)} · {share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
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
              <p className="text-sm" style={{ color: UI.faint }}>
                No listings in selection.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Top listings */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <p className="text-xs font-bold uppercase tracking-wider mb-3.5" style={{ color: UI.text }}>
          Top listings · by effective occupancy
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {(stats?.topListings ?? []).map((l) => {
            const lo = occOf(l, metric, window_);
            return (
              <div
                key={l.id}
                className="rounded-xl p-3.5 transition-colors hover:bg-white/[0.05]"
                style={{ border: `1px solid ${UI.border}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug" style={{ color: UI.text }}>
                    {l.name}
                  </p>
                  <span
                    className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                    style={{ background: occupancyColor(lo) }}
                  />
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: UI.muted }}>
                  {areaLabel(l.areaSlug)} · {l.propertyType ?? "—"} · {l.bedrooms ?? "—"} bed
                </p>
                <div className="flex items-center justify-between mt-2.5">
                  <span className="text-sm font-bold" style={{ color: UI.green }}>
                    {fmtPct(lo)}
                  </span>
                  <span className="text-xs" style={{ color: UI.muted }}>
                    {fmtEuro(l.nightlyRate)}/n
                    {l.rating != null && (
                      <>
                        {" · "}
                        <Star size={9} fill={UI.oliveLight} color={UI.oliveLight} className="inline -mt-px" />{" "}
                        {l.rating.toFixed(2)}
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          {!stats?.topListings.length && (
            <p className="text-sm" style={{ color: UI.faint }}>
              Nothing to show yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
