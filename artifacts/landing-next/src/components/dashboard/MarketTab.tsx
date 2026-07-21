"use client";

import { motion } from "framer-motion";
import { Info } from "lucide-react";
import type { AreaHealth, MarketResponse, WeeklyRow } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct, TYPE_GROUP_LABELS } from "@/lib/dashboard/format";
import { AMENITIES } from "@/lib/dashboard/filters";
import { CY_EVENTS, eventsInWeek } from "@/lib/dashboard/events";
import { currentWeekMonday } from "@/lib/dashboard/weeks";
import type { ExplainerId } from "@/lib/dashboard/explain";
import { UI } from "./tokens";
import { TrendChart, BarsChart, GapBars, LineAreaChart, type TrendSeries } from "./charts";
import Explain, { StatLabel } from "./Explain";

const fmtWeek = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const AMENITY_LABEL = new Map(AMENITIES.map((a) => [a.key, a.label]));
const NEG = "#D98B6A"; // warm terracotta for declines — no cool tones

type MetricKey = "effOcc" | "medianAdr" | "revpar" | "bookings" | "listings";

function metricOf(w: WeeklyRow | undefined, m: MetricKey): number | null {
  return w ? (w[m] as number | null) : null;
}

/** Range aggregates: averages for rates/occupancy/volumes-per-listing, totals for raw volumes.
 * Occupancy is weighted by weekly listing counts so big weeks count more. */
function aggregate(rows: WeeklyRow[]) {
  const nums = (k: keyof WeeklyRow) =>
    rows.map((r) => r[k] as number | null).filter((v): v is number => v != null);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const sum = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) : null);
  const occRows = rows.filter((r) => r.effOcc != null);
  const occW = occRows.reduce((s, r) => s + (r.listings ?? 1), 0);
  const avgListings = mean(nums("listings"));
  const totalBookings = sum(nums("bookings"));
  const hasRevEst = rows.some((r) => r.revenueEst != null);
  const totalRevEst = hasRevEst ? sum(nums("revenueEst")) : null;
  return {
    listings: avgListings,
    effOcc: occW ? occRows.reduce((s, r) => s + r.effOcc! * (r.listings ?? 1), 0) / occW : null,
    medianAdr: mean(nums("medianAdr")),
    revpar: mean(nums("revpar")),
    bookings: totalBookings,
    bookingsPerListing:
      totalBookings != null && avgListings ? totalBookings / avgListings : null,
    revenueEst: totalRevEst,
    revenuePerListing:
      totalRevEst != null && avgListings ? totalRevEst / avgListings : null,
  };
}

function DeltaBadge({ delta, fmt, suffix }: { delta: number | null; fmt: (v: number) => string; suffix?: string }) {
  if (delta == null)
    return (
      <span className="text-[11px]" style={{ color: UI.faint }}>
        —
      </span>
    );
  const up = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md"
      style={{
        color: up ? UI.green : NEG,
        background: up ? "rgba(143,204,128,0.1)" : "rgba(217,139,106,0.1)",
      }}
    >
      {up ? "▲" : "▼"} {fmt(Math.abs(delta))}
      {suffix}
    </span>
  );
}

export default function MarketTab({
  market,
  health,
}: {
  market: MarketResponse | null;
  health: AreaHealth | null;
}) {
  const cur = currentWeekMonday();
  const weekly = market?.weekly ?? [];
  const realized = weekly.filter((w) => w.weekStart < cur);
  // KPIs aggregate over the completed weeks inside the picked range so
  // they respond to the calendar. All-forward ranges show booking pace.
  const scope = realized.length ? realized : weekly;
  const kpiIsForward = realized.length === 0 && weekly.length > 0;
  const agg = aggregate(scope);
  // WoW badge: the two most recent completed weeks inside the scope. In
  // forward mode there is no "change" — later weeks simply have less on the
  // books yet — so the badge is suppressed entirely.
  const kpiWeek = scope.at(-1);
  const prevWeek = !kpiIsForward && scope.length >= 2 ? scope.at(-2) : undefined;

  const kpis: Array<{
    id: ExplainerId;
    label: string;
    value: string;
    delta: number | null;
    deltaFmt: (v: number) => string;
    deltaSuffix?: string;
    accent?: boolean;
    explainAlign?: "left" | "center" | "right";
  }> = [
    {
      id: "listings",
      label: "Listings tracked",
      value: fmtInt(agg.listings),
      delta: null,
      deltaFmt: fmtInt,
    },
    {
      id: kpiIsForward ? "on_the_books" : "eff_occ",
      label: kpiIsForward ? "Occupancy · on the books" : "Occupancy",
      value: fmtPct(agg.effOcc),
      delta:
        prevWeek && metricOf(kpiWeek, "effOcc") != null && metricOf(prevWeek, "effOcc") != null
          ? metricOf(kpiWeek, "effOcc")! - metricOf(prevWeek, "effOcc")!
          : null,
      deltaFmt: (v) => v.toFixed(1),
      deltaSuffix: "pp",
      accent: true,
    },
    {
      id: "median_adr",
      label: "Median nightly rate",
      value: fmtEuro(agg.medianAdr != null ? Math.round(agg.medianAdr) : null),
      delta:
        prevWeek && metricOf(kpiWeek, "medianAdr") != null && metricOf(prevWeek, "medianAdr") != null
          ? metricOf(kpiWeek, "medianAdr")! - metricOf(prevWeek, "medianAdr")!
          : null,
      deltaFmt: (v) => fmtEuro(Math.round(v)),
    },
    {
      id: "revpar",
      label: "RevPAR",
      value: fmtEuro(agg.revpar != null ? Math.round(agg.revpar) : null),
      delta:
        prevWeek && metricOf(kpiWeek, "revpar") != null && metricOf(prevWeek, "revpar") != null
          ? metricOf(kpiWeek, "revpar")! - metricOf(prevWeek, "revpar")!
          : null,
      deltaFmt: (v) => fmtEuro(Math.round(v)),
    },
    {
      id: "bookings",
      label: "Avg bookings / listing",
      value: agg.bookingsPerListing != null ? agg.bookingsPerListing.toFixed(1) : "—",
      delta:
        prevWeek && metricOf(kpiWeek, "bookings") != null && metricOf(prevWeek, "bookings") != null &&
        kpiWeek?.listings && prevWeek?.listings
          ? metricOf(kpiWeek, "bookings")! / kpiWeek.listings - metricOf(prevWeek, "bookings")! / prevWeek.listings
          : null,
      deltaFmt: (v) => v.toFixed(2),
    },
  ];
  if (agg.revenuePerListing != null) {
    kpis.push({
      id: "revenue_est",
      label: "Avg est. revenue / listing",
      value: fmtEuro(Math.round(agg.revenuePerListing)),
      delta:
        prevWeek?.revenueEst != null && kpiWeek?.revenueEst != null &&
        kpiWeek?.listings && prevWeek?.listings
          ? kpiWeek.revenueEst / kpiWeek.listings - prevWeek.revenueEst / prevWeek.listings
          : null,
      deltaFmt: (v) => fmtEuro(Math.round(v)),
      explainAlign: "right",
    });
  }

  // Delta chips vs benchmarks (same filters — decision 11 Jul 2026),
  // aggregated over the same weeks as the KPIs.
  const scopeWeeks = new Set(scope.map((w) => w.weekStart));
  const chips = (market?.benchmarks ?? [])
    .map((b) => {
      const bAgg = aggregate(b.weekly.filter((w) => scopeWeeks.has(w.weekStart)));
      const occD = agg.effOcc != null && bAgg.effOcc != null ? agg.effOcc - bAgg.effOcc : null;
      const adrD =
        agg.medianAdr != null && bAgg.medianAdr != null && bAgg.medianAdr !== 0
          ? (100 * (agg.medianAdr - bAgg.medianAdr)) / bAgg.medianAdr
          : null;
      if (occD == null && adrD == null) return null;
      return { label: b.label, occD, adrD };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);

  // Gap chart vs the closest benchmark (district when available, else island).
  const gapBench = market?.benchmarks?.[0] ?? null;
  const gapData = gapBench
    ? weekly.map((w) => {
        const bw = gapBench.weekly.find((x) => x.weekStart === w.weekStart);
        return {
          label: fmtWeek(w.weekStart),
          value: w.effOcc != null && bw?.effOcc != null ? Math.round((w.effOcc - bw.effOcc) * 10) / 10 : null,
          // School-holiday ranges span too many bars to mark — point events only.
          events: eventsInWeek(w.weekStart).filter((e) => e.kind !== "school"),
        };
      })
    : [];

  // Strongest & weakest completed weeks in range.
  const ranked = [...realized].filter((w) => w.effOcc != null).sort((a, b) => b.effOcc! - a.effOcc!);
  const bestWeeks = ranked.slice(0, 3);
  const worstWeeks = ranked.length > 3 ? ranked.slice(-3).reverse() : [];

  const benchSeries = (metric: MetricKey): TrendSeries[] =>
    (market?.benchmarks ?? []).slice(0, 2).map((b, i) => ({
      label: b.label,
      color: i === 0 ? UI.oliveLight : "#C9B891",
      dashed: i !== 0,
      data: b.weekly.map((w) => ({ x: w.weekStart, y: w[metric] as number | null })),
    }));

  const mainSeries = (metric: MetricKey, label: string): TrendSeries => ({
    label,
    color: UI.green,
    data: weekly.map((w) => ({ x: w.weekStart, y: w[metric] as number | null })),
  });

  const snap = market?.snapshot ?? null;
  const mixTotal = snap?.typeMix.reduce((s, m) => s + m.count, 0) ?? 0;
  const bedTotal = snap?.bedrooms.reduce((s, b) => s + b.count, 0) ?? 0;

  return (
    <div>
      {market?.filtersIgnored && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 mb-2.5 text-[13px]"
          style={{ background: "rgba(217,139,106,0.08)", border: "1px solid rgba(217,139,106,0.25)", color: UI.text }}
        >
          <Info size={15} style={{ color: NEG }} className="shrink-0" />
          Attribute filters aren&apos;t available yet for this small area type — showing all its
          listings instead. Pick a town, resort or district to filter.
        </div>
      )}

      {/* KPI cards — latest completed week in the picked range, with WoW */}
      <motion.div
        key={kpiWeek?.weekStart ?? "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5"
      >
        {kpis.map((c) => (
          <div key={c.label} className="glass-card rounded-2xl px-4 py-3.5">
            <div className="flex items-center justify-between gap-1">
              <p className="font-display font-bold text-2xl leading-none" style={{ color: c.accent ? UI.green : UI.text }}>
                {c.value}
              </p>
              <DeltaBadge delta={c.delta} fmt={c.deltaFmt} suffix={c.deltaSuffix} />
            </div>
            <p className="text-[11px] mt-2 uppercase tracking-wider font-medium flex items-center gap-1.5" style={{ color: UI.muted }}>
              {c.label}
              <Explain id={c.id} align={c.explainAlign ?? "left"} />
            </p>
          </div>
        ))}
      </motion.div>
      {scope.length > 0 && (
        <p className="text-[11px] mt-1.5 flex items-center gap-1.5" style={{ color: UI.faint }}>
          {kpiIsForward
            ? `On the books across ${scope.length} upcoming ${scope.length === 1 ? "week" : "weeks"}`
            : `Across ${scope.length} completed ${scope.length === 1 ? "week" : "weeks"} (${fmtWeek(scope[0].weekStart)} – ${fmtWeek(scope[scope.length - 1].weekStart)})`}
          {" "}· averages for rates, occupancy & per-listing volumes
          <Explain id="range_agg" align="left" />
          {prevWeek && (
            <>
              · badge = change in the latest week
              <Explain id="wow" align="left" />
            </>
          )}
        </p>
      )}

      {/* Delta chips vs district & island */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: UI.muted }}>
            Compared to
            <Explain id="vs_benchmark" align="left" />
          </span>
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs glass-card"
            >
              <span className="font-semibold" style={{ color: UI.text }}>
                {c.label}
              </span>
              {c.occD != null && (
                <span className="font-bold" style={{ color: c.occD >= 0 ? UI.green : NEG }}>
                  {c.occD >= 0 ? "+" : ""}
                  {c.occD.toFixed(1)}pp occupancy
                </span>
              )}
              {c.adrD != null && (
                <span className="font-bold" style={{ color: c.adrD >= 0 ? UI.green : NEG }}>
                  {c.adrD >= 0 ? "+" : ""}
                  {c.adrD.toFixed(0)}% rate
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Trends — split at the current week (realized | on the books) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mt-2.5">
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="eff_occ" align="left">
              Weekly occupancy
            </StatLabel>
            <span className="text-[11px] flex items-center gap-1.5" style={{ color: UI.faint }}>
              % · dots &amp; shading mark events
              <Explain id="event_overlay" align="right" />
            </span>
          </div>
          <TrendChart
            main={mainSeries("effOcc", "Selection")}
            benchmarks={benchSeries("effOcc")}
            splitX={cur}
            yFmt={(v) => `${v.toFixed(1)}%`}
            xFmt={fmtWeek}
            events={CY_EVENTS}
            emptyLabel="No weekly data in this range"
          />
        </div>
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="median_adr" align="left">
              Weekly median rate
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              € / night
            </span>
          </div>
          <TrendChart
            main={mainSeries("medianAdr", "Selection")}
            benchmarks={benchSeries("medianAdr")}
            splitX={cur}
            yFmt={(v) => fmtEuro(v)}
            xFmt={fmtWeek}
            events={CY_EVENTS}
            emptyLabel="No weekly data in this range"
          />
        </div>
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="bookings" align="left">
              Weekly bookings
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              detected
            </span>
          </div>
          <TrendChart
            main={mainSeries("bookings", "Selection")}
            benchmarks={[]}
            splitX={cur}
            yFmt={(v) => fmtInt(v)}
            xFmt={fmtWeek}
            events={CY_EVENTS}
            emptyLabel="No weekly data in this range"
          />
        </div>
      </div>

      {/* Gap vs benchmark + strongest/weakest weeks */}
      {(gapBench || bestWeeks.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mt-2.5">
          {gapBench && (
            <div className="glass-card rounded-2xl p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <StatLabel id="benchmark_gap" align="left">
                  Occupancy gap vs {gapBench.label}
                </StatLabel>
                <span className="text-[11px]" style={{ color: UI.faint }}>
                  percentage points per week · above zero = you outperform
                </span>
              </div>
              <GapBars
                data={gapData}
                yFmt={(v) => `${v.toFixed(1)}pp`}
                emptyLabel="No overlapping weeks to compare"
              />
            </div>
          )}
          {bestWeeks.length > 0 && (
            <div className={`glass-card rounded-2xl p-5 ${gapBench ? "" : "lg:col-span-3"}`}>
              <div className="mb-3">
                <StatLabel id="best_weeks" align="left">
                  Strongest & weakest weeks
                </StatLabel>
              </div>
              {gapBench ? (
                <div className="flex flex-col gap-1.5">
                  {bestWeeks.map((w) => (
                    <WeekRow key={w.weekStart} w={w} tone="best" />
                  ))}
                  {worstWeeks.length > 0 && (
                    <>
                      <div className="h-px my-1" style={{ background: UI.border }} />
                      {worstWeeks.map((w) => (
                        <WeekRow key={w.weekStart} w={w} tone="worst" />
                      ))}
                    </>
                  )}
                </div>
              ) : (
                // Full-width card (no benchmark column): strongest and weakest
                // side by side so rows don't stretch across the whole page.
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-1.5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: UI.green }}>
                      Strongest
                    </p>
                    {bestWeeks.map((w) => (
                      <WeekRow key={w.weekStart} w={w} tone="best" />
                    ))}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: NEG }}>
                      Weakest
                    </p>
                    {worstWeeks.map((w) => (
                      <WeekRow key={w.weekStart} w={w} tone="worst" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Supply-shift context for the trends (contract §5) */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <div className="flex items-center justify-between mb-3">
          <StatLabel id="listing_count_trend" align="left">
            Listings tracked per week
          </StatLabel>
          <span className="text-[11px]" style={{ color: UI.faint }}>
            read occupancy moves together with supply
          </span>
        </div>
        <TrendChart
          main={mainSeries("listings", "Selection")}
          benchmarks={[]}
          splitX={cur}
          yFmt={(v) => fmtInt(v)}
          xFmt={fmtWeek}
          height={72}
          emptyLabel="No weekly data in this range"
        />
      </div>

      {/* Current-state snapshot: distribution + supply mix */}
      {snap && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mt-2.5">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <StatLabel id="quartiles" align="left">
                Price & occupancy spread
              </StatLabel>
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: "rgba(255,255,255,0.06)", color: UI.muted }}
              >
                today <Explain id="current_state" align="right" />
              </span>
            </div>
            <QuartileBar
              label="Nightly rate"
              q={snap.adrQuartiles}
              fmt={(v) => fmtEuro(Math.round(v))}
            />
            <div className="mt-5">
              <QuartileBar label="Occupancy" q={snap.occQuartiles} fmt={(v) => `${v.toFixed(0)}%`} />
            </div>
            <p className="text-[12px] mt-5 flex items-center gap-1.5" style={{ color: UI.muted }}>
              Superhost share{" "}
              <span className="font-bold" style={{ color: UI.text }}>
                {fmtPct(snap.superhostShare)}
              </span>
              <Explain id="superhost" align="left" />
            </p>
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <StatLabel id="supply_mix" align="left">
                Bedrooms
              </StatLabel>
              <span className="text-[11px]" style={{ color: UI.faint }}>
                {fmtInt(bedTotal)} listings
              </span>
            </div>
            <BarsChart
              data={snap.bedrooms.map((b) => ({ label: b.label, value: b.count }))}
              yFmt={(v) => fmtInt(v)}
              height={110}
              highlightMax
              showValues
              emptyLabel="No listings in selection"
            />
            <div className="mt-4 flex flex-col gap-2.5">
              {snap.typeMix.map((m) => {
                const share = mixTotal ? (100 * m.count) / mixTotal : 0;
                return (
                  <div key={m.group}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium" style={{ color: UI.text }}>
                        {TYPE_GROUP_LABELS[m.group]}
                      </span>
                      <span className="text-[11px] font-semibold" style={{ color: UI.muted }}>
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
            </div>
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <StatLabel id="supply_mix" align="left">
                Amenities
              </StatLabel>
              <span className="text-[11px]" style={{ color: UI.faint }}>
                % of listings that have it
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {snap.amenities.slice(0, 8).map((a) => (
                <div key={a.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium" style={{ color: UI.text }}>
                      {AMENITY_LABEL.get(a.key) ?? a.key}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: UI.muted }}>
                      {a.share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg,#6B7B4F,#A8C290)", width: `${a.share}%` }}
                    />
                  </div>
                </div>
              ))}
              {!snap.amenities.length && (
                <p className="text-sm" style={{ color: UI.faint }}>
                  No amenity data for this selection.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Area health — island-wide district league + supply dynamics */}
      {health && health.districts.length > 0 && (
        <>
          <div className="glass-card rounded-2xl p-5 mt-2.5">
            <div className="flex items-center justify-between mb-3">
              <StatLabel id="composite_score" align="left">
                District league — all of Cyprus
              </StatLabel>
              <span className="text-[11px]" style={{ color: UI.faint }}>
                last 4 completed weeks · doesn&apos;t follow your selection
              </span>
            </div>
            <div className="overflow-x-auto ps-scroll">
              <table className="w-full text-left" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {["District", "Score", "Listings", "Occupancy", "RevPAR", "Bookings WoW×4", "New / gone · 90d", "Absorption"].map((h, i) => (
                      <th
                        key={h}
                        className="text-[10px] uppercase tracking-wider font-semibold py-2 pr-4 whitespace-nowrap"
                        style={{ color: UI.faint, borderBottom: `1px solid ${UI.border}` }}
                      >
                        {h}
                        {i === 7 && (
                          <span className="ml-1 normal-case">
                            <Explain id="absorption" align="right" />
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {health.districts.map((d) => (
                    <tr key={d.areaId}>
                      <td className="py-2.5 pr-4 text-[13px] font-semibold whitespace-nowrap" style={{ color: UI.text, borderBottom: `1px solid ${UI.border}` }}>
                        {d.district.replace(" District", "")}
                      </td>
                      <td className="py-2.5 pr-4" style={{ borderBottom: `1px solid ${UI.border}` }}>
                        <span className="inline-flex items-center gap-2">
                          <span className="font-display font-bold text-[15px]" style={{ color: UI.green }}>
                            {d.score ?? "—"}
                          </span>
                          <span className="w-14 h-1.5 rounded-full overflow-hidden inline-block" style={{ background: "rgba(255,255,255,0.07)" }}>
                            <span
                              className="h-full block rounded-full"
                              style={{ width: `${d.score ?? 0}%`, background: "linear-gradient(90deg,#4A5E3A,#8FCC80)" }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                        {fmtInt(d.listings)}
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] font-semibold whitespace-nowrap" style={{ color: UI.text, borderBottom: `1px solid ${UI.border}` }}>
                        {fmtPct(d.effOcc)}
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                        {fmtEuro(d.revpar)}
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] font-semibold whitespace-nowrap" style={{ color: (d.bookingsGrowth ?? 0) >= 0 ? UI.green : NEG, borderBottom: `1px solid ${UI.border}` }}>
                        {d.bookingsGrowth != null ? `${d.bookingsGrowth >= 0 ? "+" : ""}${d.bookingsGrowth.toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                        {d.newListings90d != null ? `+${fmtInt(d.newListings90d)}` : "—"}
                        {" / "}
                        {d.delisted90d != null ? `−${fmtInt(d.delisted90d)}` : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] whitespace-nowrap" style={{ color: UI.text, borderBottom: `1px solid ${UI.border}` }}>
                        {fmtPct(d.absorption90d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] mt-3" style={{ color: UI.faint }}>
              Score blends occupancy (40%), RevPAR (30%), booking growth (15%) and new-listing
              absorption (15%) — the inputs are all in the table, so form your own view.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <StatLabel id="ramp_up" align="left">
                  New-listing ramp-up
                </StatLabel>
                <span className="text-[11px]" style={{ color: UI.faint }}>
                  occupancy by weeks since launch · listings started in the last 6 months
                </span>
              </div>
              <LineAreaChart
                data={health.rampUp.map((r) => ({ x: `wk ${r.week}`, y: r.effOcc }))}
                yFmt={(v) => `${v.toFixed(0)}%`}
                height={110}
                emptyLabel="Not enough newly launched listings yet"
              />
            </div>
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <StatLabel id="churn" align="left">
                  Supply churn — net new listings
                </StatLabel>
                <span className="text-[11px]" style={{ color: UI.faint }}>
                  per month · above zero = supply growing
                </span>
              </div>
              <GapBars
                data={health.churn.map((c) => ({
                  label: new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" }),
                  value: c.added - c.removed,
                }))}
                yFmt={(v) => `${fmtInt(v)} net`}
                labelEvery={1}
                emptyLabel="Not enough tracking history yet"
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                {health.churn.map((c) => (
                  <span key={c.month} className="text-[11px]" style={{ color: UI.faint }}>
                    {new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" })}
                    {": "}
                    <b style={{ color: UI.green }}>+{fmtInt(c.added)}</b> /{" "}
                    <b style={{ color: NEG }}>−{fmtInt(c.removed)}</b>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One row of the strongest/weakest-weeks card. */
function WeekRow({ w, tone }: { w: WeeklyRow; tone: "best" | "worst" }) {
  const color = tone === "best" ? UI.green : NEG;
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[12.5px] font-semibold w-16 shrink-0" style={{ color: UI.text }}>
        {fmtWeek(w.weekStart)}
      </span>
      <span className="text-[12.5px] font-bold w-14 text-right" style={{ color }}>
        {fmtPct(w.effOcc)}
      </span>
      <span className="text-[12px] w-14 text-right" style={{ color: UI.muted }}>
        {fmtEuro(w.medianAdr)}
      </span>
      <span className="text-[11px] flex-1 text-right" style={{ color: UI.faint }}>
        {w.bookings != null ? `${fmtInt(w.bookings)} bookings` : ""}
      </span>
    </div>
  );
}

/** p25 → median → p75 as a range bar with labelled markers. */
function QuartileBar({
  label,
  q,
  fmt,
}: {
  label: string;
  q: [number, number, number] | null;
  fmt: (v: number) => string;
}) {
  if (!q) {
    return (
      <div>
        <p className="text-[12px] font-medium mb-1.5" style={{ color: UI.text }}>
          {label}
        </p>
        <p className="text-sm" style={{ color: UI.faint }}>
          Not enough data.
        </p>
      </div>
    );
  }
  const [p25, med, p75] = q;
  const lo = p25 * 0.75;
  const hi = p75 * 1.2;
  const pos = (v: number) => `${Math.max(0, Math.min(100, (100 * (v - lo)) / (hi - lo)))}%`;
  return (
    <div>
      <p className="text-[12px] font-medium mb-2" style={{ color: UI.text }}>
        {label}
      </p>
      <div className="relative h-2 rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
        <div
          className="absolute h-full rounded-full"
          style={{
            left: pos(p25),
            width: `calc(${pos(p75)} - ${pos(p25)})`,
            background: "linear-gradient(90deg,rgba(143,204,128,0.35),rgba(143,204,128,0.7))",
          }}
        />
        <div
          className="absolute w-[3px] h-4 -top-1 rounded-full"
          style={{ left: pos(med), background: UI.green }}
        />
      </div>
      <div className="flex justify-between mt-2 text-[11px]" style={{ color: UI.muted }}>
        <span>
          25% under <b style={{ color: UI.text }}>{fmt(p25)}</b>
        </span>
        <span>
          median <b style={{ color: UI.green }}>{fmt(med)}</b>
        </span>
        <span>
          25% over <b style={{ color: UI.text }}>{fmt(p75)}</b>
        </span>
      </div>
    </div>
  );
}
