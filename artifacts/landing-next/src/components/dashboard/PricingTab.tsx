"use client";

import { motion } from "framer-motion";
import type { PricingData, SelectionStats } from "@/lib/dashboard/types";
import { fmtEuro } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { BarsChart, LineAreaChart } from "./charts";

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtWeek = fmtDay;
const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" });

export default function PricingTab({
  pricing,
  stats,
}: {
  pricing: PricingData | null;
  stats: SelectionStats | null;
}) {
  // Next-30-days median from the (sampled) forward curve.
  const now = Date.now();
  const next30 =
    pricing?.forwardCurve
      .filter((p) => new Date(p.date).getTime() < now + 30 * 86400000)
      .map((p) => p.medianPrice)
      .filter((v): v is number => v != null) ?? [];
  const next30Med = next30.length
    ? [...next30].sort((a, b) => a - b)[Math.floor(next30.length / 2)]
    : null;

  // Peak forward month.
  const peakMonth = (pricing?.byMonth ?? [])
    .filter((m): m is { month: string; medianPrice: number } => m.medianPrice != null)
    .reduce<{ month: string; medianPrice: number } | null>(
      (a, b) => (a == null || b.medianPrice > a.medianPrice ? b : a),
      null
    );

  const cards = [
    { label: "Median rate · current", value: stats ? fmtEuro(stats.medianRate) : "—", accent: true },
    { label: "Average rate · current", value: stats ? fmtEuro(stats.avgRate) : "—" },
    { label: "Median rate · next 30d", value: fmtEuro(next30Med) },
    {
      label: "Peak forward month",
      value: peakMonth
        ? `${new Date(`${peakMonth.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long" })}`
        : "—",
      hint: peakMonth ? `median ${fmtEuro(peakMonth.medianPrice)}` : undefined,
    },
  ];

  return (
    <div>
      {/* KPI cards */}
      <motion.div
        key={pricing ? "loaded" : "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 xl:grid-cols-4 gap-2.5"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        {/* Forward curve */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: UI.text }}>
              Forward prices · next 6 months
            </p>
            <p className="text-xs" style={{ color: UI.muted }}>
              median nightly price by sampled date
            </p>
          </div>
          <LineAreaChart
            data={(pricing?.forwardCurve ?? []).map((p) => ({ x: p.date, y: p.medianPrice }))}
            yFmt={(v) => fmtEuro(v)}
            xFmt={fmtDay}
            height={110}
            emptyLabel="No forward pricing for this selection yet"
          />
        </div>

        {/* Weekly ADR trend */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: UI.text }}>
              Weekly median ADR
            </p>
            <p className="text-xs" style={{ color: UI.muted }}>
              realised, per week
            </p>
          </div>
          <LineAreaChart
            data={(stats?.weekly ?? []).map((w) => ({ x: w.weekStart, y: w.medianAdr }))}
            yFmt={(v) => fmtEuro(v)}
            xFmt={fmtWeek}
            height={110}
            emptyLabel="Not enough weekly history yet"
          />
        </div>

        {/* Price distribution */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: UI.text }}>
              Price distribution
            </p>
            <p className="text-xs" style={{ color: UI.muted }}>
              listings per €25 rate band
            </p>
          </div>
          <BarsChart
            data={(pricing?.distribution ?? []).map((d) => ({
              label: d.binStart >= 500 ? "€500+" : `€${d.binStart}`,
              value: d.count,
            }))}
            yFmt={(v) => `${v} listings`}
            height={110}
            labelEvery={4}
            emptyLabel="No rate data for this selection"
          />
        </div>

        {/* Forward price by month */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: UI.text }}>
              Forward price by month
            </p>
            <p className="text-xs" style={{ color: UI.muted }}>
              median nightly price
            </p>
          </div>
          <BarsChart
            data={(pricing?.byMonth ?? []).map((m) => ({
              label: fmtMonth(m.month),
              value: m.medianPrice,
            }))}
            yFmt={(v) => fmtEuro(v)}
            height={110}
            highlightMax
            emptyLabel="No forward pricing for this selection yet"
          />
        </div>
      </div>
    </div>
  );
}
