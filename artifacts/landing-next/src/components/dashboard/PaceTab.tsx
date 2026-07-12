"use client";

import { motion } from "framer-motion";
import { Info } from "lucide-react";
import type { PaceData } from "@/lib/dashboard/types";
import { fmtDate, fmtInt } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { BarsChart, LineAreaChart, StackedBars, TrendChart, type TrendSeries } from "./charts";
import Explain, { StatLabel } from "./Explain";

const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" });
const fmtWeek = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const shortDistrict = (d: string) => d.replace(" District", "");

const STAY_SEGMENTS = [
  { key: "short", label: "1–3 nights", color: "rgba(168,194,144,0.85)" },
  { key: "week", label: "4–14 nights", color: "#4A5E3A" },
  { key: "mid", label: "15–27 nights", color: "#8FCC80" },
  { key: "month28", label: "28+ nights", color: "#C9B891" },
];

const PICKUP_COLORS = [UI.green, UI.oliveLight, "#C9B891"];

/**
 * Booking pace (booking_stays + area_pace, enriched 12 Jul 2026).
 * District grain — polygons resolve to their majority district. Lead times
 * are lower bounds (≤2-day detection lag); forward months right-censored.
 */
export default function PaceTab({ pace }: { pace: PaceData | null }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const currentLead =
    pace?.leadTimeByMonth.find((m) => m.month === thisMonth)?.medianLead ?? null;

  const cards = [
    {
      id: "lead_time" as const,
      label: `Median lead time · ${fmtMonth(thisMonth)} stays`,
      value: currentLead != null ? `${currentLead} days` : "—",
      accent: true,
    },
    {
      id: "stay_mix" as const,
      label: "Median stay",
      value: pace?.medianStay != null ? `${Math.round(pace.medianStay)} nights` : "—",
    },
    {
      id: "mid_term" as const,
      label: "Mid-term share (15+ nights)",
      value: pace?.midTermShare != null ? `${pace.midTermShare.toFixed(1)}%` : "—",
    },
    {
      id: "freshness" as const,
      label: "Bookings tracked through",
      value: pace?.bookingsThrough ? fmtDate(pace.bookingsThrough) : "—",
    },
  ];

  // Pickup: shared x-domain (days until stay, far → near) across stay weeks.
  const pickup = pace?.pickup ?? [];
  const xDomain = [...new Set(pickup.flatMap((s) => s.points.map((p) => p.daysOut)))].sort(
    (a, b) => b - a
  );
  const pickupSeries: TrendSeries[] = pickup.map((s, i) => {
    const byDay = new Map(s.points.map((p) => [p.daysOut, p.otb]));
    return {
      label: `Week of ${fmtWeek(s.stayWeek)}`,
      color: PICKUP_COLORS[i % PICKUP_COLORS.length],
      dashed: i > 0,
      data: xDomain.map((d) => ({ x: String(d), y: byDay.get(d) ?? null })),
    };
  });

  return (
    <div>
      {pace && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 mb-2.5 text-[13px]"
          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${UI.border}`, color: UI.text }}
        >
          <Info size={15} style={{ color: UI.green }} className="shrink-0" />
          <span>
            Booking-pace data is district-level — showing{" "}
            <b style={{ color: UI.green }}>{pace.scope}</b>. Lead times are lower bounds: we detect
            bookings within ~2 days of them happening.
          </span>
        </div>
      )}

      <motion.div
        key={pace ? "loaded" : "loading"}
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
          </div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        {/* Lead-time ladder by stay month */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="lead_time" align="left">
              How far ahead guests book
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              median days before arrival · per stay month
            </span>
          </div>
          <BarsChart
            data={(pace?.leadTimeByMonth ?? []).map((m) => ({
              label: fmtMonth(m.month),
              value: m.medianLead,
            }))}
            yFmt={(v) => `${Math.round(v)} days ahead`}
            height={120}
            highlightMax
            emptyLabel="No booking data for this scope yet"
          />
          <p className="text-[11px] mt-3" style={{ color: UI.faint }}>
            Future months show bookings made <i>so far</i> — the true median will fall as
            last-minute bookers arrive.
          </p>
        </div>

        {/* Booking-window planner (CDF) */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="booking_window" align="left">
              Booking window
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              % of booked nights already reserved N days out
            </span>
          </div>
          <LineAreaChart
            data={(pace?.bookingWindow ?? [])
              .slice()
              .sort((a, b) => b.daysOut - a.daysOut)
              .map((p) => ({ x: String(p.daysOut), y: p.cumShare }))}
            yFmt={(v) => `${v.toFixed(0)}%`}
            xFmt={(x) => (x === "0" ? "arrival" : `${x}d out`)}
            height={120}
            emptyLabel="No completed stays in the last 90 days"
          />
          <p className="text-[11px] mt-3" style={{ color: UI.faint }}>
            From stays completed in the last 90 days — recent, fully booked history.
          </p>
        </div>

        {/* Lead time by district */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="lead_time" align="left">
              Lead time by district
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              stays in the next 90 days · booked so far
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {(pace?.leadTimeByDistrict ?? []).map((d) => {
              const max = Math.max(...(pace?.leadTimeByDistrict ?? []).map((x) => x.medianLead ?? 0), 1);
              const w = ((d.medianLead ?? 0) / max) * 100;
              return (
                <div key={d.district}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium" style={{ color: UI.text }}>
                      {shortDistrict(d.district)}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: UI.muted }}>
                      {d.medianLead != null ? `${d.medianLead} days` : "—"} ·{" "}
                      {fmtInt(d.nights)} nights
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg,#4A5E3A,#8FCC80)", width: `${w}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!pace?.leadTimeByDistrict.length && (
              <p className="text-sm" style={{ color: UI.faint }}>
                No upcoming-stay bookings detected yet.
              </p>
            )}
          </div>
        </div>

        {/* Stay-length mix */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="stay_mix" align="left">
              Stay-length mix
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              share of bookings · per stay month
            </span>
          </div>
          <StackedBars
            data={(pace?.stayMix ?? []).map((m) => ({
              label: fmtMonth(m.month),
              values: { short: m.short, week: m.week, mid: m.mid, month28: m.month28 },
            }))}
            segments={STAY_SEGMENTS}
            height={120}
            emptyLabel="No booking data for this scope yet"
          />
        </div>
      </div>

      {/* OTB pickup curves */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <div className="flex items-center justify-between mb-3">
          <StatLabel id="otb_pace" align="left">
            Pickup — how upcoming weeks are filling
          </StatLabel>
          <span className="text-[11px]" style={{ color: UI.faint }}>
            calendar unavailability incl. owner blocks · read the slope
          </span>
        </div>
        {pickupSeries.length ? (
          <TrendChart
            main={pickupSeries[0]}
            benchmarks={pickupSeries.slice(1)}
            splitX="9999-12-31"
            yFmt={(v) => `${v.toFixed(0)}% unavailable`}
            xFmt={(x) => (x === "0" ? "stay week" : `${x}d out`)}
            height={140}
            emptyLabel="No pace snapshots for this scope yet"
          />
        ) : (
          <div
            className="h-24 flex items-center justify-center rounded-xl text-sm"
            style={{ background: "rgba(255,255,255,0.04)", color: UI.faint }}
          >
            No pace snapshots for this scope yet
          </div>
        )}
        <p className="text-[11px] mt-3" style={{ color: UI.faint }}>
          Snapshots taken since March 2026. This is raw unavailability — owner-blocked nights are
          included, so compare how fast weeks fill, not their absolute level.
        </p>
      </div>
    </div>
  );
}
