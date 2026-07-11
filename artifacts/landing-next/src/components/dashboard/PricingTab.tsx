"use client";

import { motion } from "framer-motion";
import type { MarketResponse, PricingData } from "@/lib/dashboard/types";
import { fmtEuro, fmtPct } from "@/lib/dashboard/format";
import { currentWeekMonday } from "@/lib/dashboard/weeks";
import { UI } from "./tokens";
import { BarsChart, TrendChart } from "./charts";
import Explain, { StatLabel } from "./Explain";

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" });

const PREMIUM_LABEL: Record<string, string> = {
  has_pool: "Pool",
  has_sea_view: "Sea view",
  has_hot_tub: "Hot tub",
};
const MIN_SPLIT = 20; // suppress premiums when either side is thinner (contract 6.2)

export default function PricingTab({
  pricing,
  market,
}: {
  pricing: PricingData | null;
  market: MarketResponse | null;
}) {
  const snap = market?.snapshot ?? null;

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

  const peakMonth = (pricing?.byMonth ?? [])
    .filter((m): m is { month: string; medianPrice: number } => m.medianPrice != null)
    .reduce<{ month: string; medianPrice: number } | null>(
      (a, b) => (a == null || b.medianPrice > a.medianPrice ? b : a),
      null
    );

  const premiums = (pricing?.premiums ?? []).filter(
    (p) => p.withCount >= MIN_SPLIT && p.withoutCount >= MIN_SPLIT
  );

  const cards = [
    {
      id: "median_adr" as const,
      label: "Median rate · today",
      value: snap?.adrQuartiles ? fmtEuro(snap.adrQuartiles[1]) : "—",
      accent: true,
    },
    { id: "forward_rates" as const, label: "Median rate · next 30 days", value: fmtEuro(next30Med) },
    {
      id: "forward_rates" as const,
      label: "Peak forward month",
      value: peakMonth
        ? new Date(`${peakMonth.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long" })
        : "—",
      hint: peakMonth ? `median ${fmtEuro(peakMonth.medianPrice)}` : undefined,
    },
    {
      id: "quartiles" as const,
      label: "Middle-half range · today",
      value: snap?.adrQuartiles
        ? `${fmtEuro(snap.adrQuartiles[0])}–${fmtEuro(snap.adrQuartiles[2])}`
        : "—",
    },
  ];

  return (
    <div>
      <motion.div
        key={pricing ? "loaded" : "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 xl:grid-cols-4 gap-2.5"
      >
        {cards.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl px-4 py-3.5">
            <p className="font-display font-bold text-2xl leading-none" style={{ color: c.accent ? UI.green : UI.text }}>
              {c.value}
            </p>
            <p className="text-[11px] mt-2 uppercase tracking-wider font-medium flex items-center gap-1.5" style={{ color: UI.muted }}>
              {c.label}
              <Explain id={c.id} align="left" />
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
            <StatLabel id="forward_rates" align="left">
              Forward rates · next 6 months
            </StatLabel>
            <p className="text-[11px]" style={{ color: UI.faint }}>
              asking rates for available nights
            </p>
          </div>
          <TrendChart
            main={{
              label: "Median",
              color: UI.green,
              data: (pricing?.forwardCurve ?? []).map((p) => ({ x: p.date, y: p.medianPrice })),
            }}
            benchmarks={[
              {
                label: "Top quarter (p75)",
                color: "#C9B891",
                dashed: true,
                data: (pricing?.forwardCurve ?? []).map((p) => ({ x: p.date, y: p.p75 ?? null })),
              },
              {
                label: "Bottom quarter (p25)",
                color: UI.oliveLight,
                dashed: true,
                data: (pricing?.forwardCurve ?? []).map((p) => ({ x: p.date, y: p.p25 ?? null })),
              },
            ]}
            splitX="9999-12-31"
            yFmt={(v) => fmtEuro(v)}
            xFmt={fmtDay}
            height={120}
            emptyLabel="No forward pricing for this selection yet"
          />
        </div>

        {/* Weekly ADR trend from the market series */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="median_adr" align="left">
              Weekly median rate
            </StatLabel>
            <p className="text-[11px]" style={{ color: UI.faint }}>
              over your selected weeks
            </p>
          </div>
          <TrendChart
            main={{
              label: "Selection",
              color: UI.green,
              data: (market?.weekly ?? []).map((w) => ({ x: w.weekStart, y: w.medianAdr })),
            }}
            splitX={currentWeekMonday()}
            yFmt={(v) => fmtEuro(v)}
            xFmt={fmtDay}
            height={120}
            emptyLabel="Not enough weekly history yet"
          />
        </div>

        {/* Price distribution */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="quartiles" align="left">
              Price distribution
            </StatLabel>
            <p className="text-[11px]" style={{ color: UI.faint }}>
              listings per €25 rate band · today
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
            <StatLabel id="forward_rates" align="left">
              Forward rate by month
            </StatLabel>
            <p className="text-[11px]" style={{ color: UI.faint }}>
              median asking rate
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        {/* Rate by bedrooms */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="price_by_bedrooms" align="left">
              Median rate by bedrooms
            </StatLabel>
            <p className="text-[11px]" style={{ color: UI.faint }}>
              count per size in brackets · today
            </p>
          </div>
          <BarsChart
            data={(pricing?.byBedrooms ?? [])
              .filter((b) => b.count >= 5)
              .map((b) => ({ label: `${b.label} (${b.count})`, value: b.medianRate }))}
            yFmt={(v) => fmtEuro(v)}
            height={110}
            highlightMax
            emptyLabel="No rate data for this selection"
          />
        </div>

        {/* Occupancy by price band — the sweet spot */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="sweet_spot" align="left">
              Occupancy by price band
            </StatLabel>
            <p className="text-[11px]" style={{ color: UI.faint }}>
              median occupancy per €50 band · tallest = sweet spot
            </p>
          </div>
          <BarsChart
            data={(pricing?.occByPrice ?? []).map((b) => ({
              label: b.binStart >= 400 ? "€400+" : `€${b.binStart}–${b.binStart + 50}`,
              value: b.medianOcc,
            }))}
            yFmt={(v) => `${v.toFixed(0)}% booked`}
            height={110}
            highlightMax
            labelEvery={2}
            emptyLabel="Not enough listings for a price-band split"
          />
        </div>
      </div>

      {/* Amenity premiums */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <div className="flex items-center justify-between mb-4">
          <StatLabel id="amenity_premium" align="left">
            What amenities are worth here
          </StatLabel>
          <span className="text-[11px]" style={{ color: UI.faint }}>
            inside your current selection · today
          </span>
        </div>
        {premiums.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {premiums.map((p) => {
              const rateD =
                p.withMedianRate != null && p.withoutMedianRate != null && p.withoutMedianRate !== 0
                  ? (100 * (p.withMedianRate - p.withoutMedianRate)) / p.withoutMedianRate
                  : null;
              const occD =
                p.withMedianOcc != null && p.withoutMedianOcc != null
                  ? p.withMedianOcc - p.withoutMedianOcc
                  : null;
              return (
                <div key={p.key} className="rounded-xl p-4" style={{ border: `1px solid ${UI.border}` }}>
                  <p className="text-sm font-bold mb-2" style={{ color: UI.text }}>
                    {PREMIUM_LABEL[p.key] ?? p.key}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display font-bold text-xl" style={{ color: rateD != null && rateD >= 0 ? UI.green : "#D98B6A" }}>
                      {rateD != null ? `${rateD >= 0 ? "+" : ""}${rateD.toFixed(0)}%` : "—"}
                    </span>
                    <span className="text-[12px]" style={{ color: UI.muted }}>
                      on the nightly rate
                    </span>
                  </div>
                  <p className="text-[12px] mt-1" style={{ color: UI.muted }}>
                    {fmtEuro(p.withMedianRate)} with · {fmtEuro(p.withoutMedianRate)} without
                  </p>
                  {occD != null && (
                    <p className="text-[12px] mt-1.5" style={{ color: UI.muted }}>
                      Occupancy{" "}
                      <b style={{ color: occD >= 0 ? UI.green : "#D98B6A" }}>
                        {occD >= 0 ? "+" : ""}
                        {occD.toFixed(1)}pp
                      </b>{" "}
                      ({fmtPct(p.withMedianOcc)} vs {fmtPct(p.withoutMedianOcc)})
                    </p>
                  )}
                  <p className="text-[11px] mt-1.5" style={{ color: UI.faint }}>
                    {p.withCount.toLocaleString("en-GB")} with · {p.withoutCount.toLocaleString("en-GB")} without
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm" style={{ color: UI.faint }}>
            Not enough listings on both sides of an amenity split in this selection — widen the area
            to compare pool, sea-view and hot-tub premiums.
          </p>
        )}
        <p className="text-[11px] mt-3.5" style={{ color: UI.faint }}>
          Coming soon: weekend & holiday premiums and price-vs-lead-time dynamics.
        </p>
      </div>
    </div>
  );
}
