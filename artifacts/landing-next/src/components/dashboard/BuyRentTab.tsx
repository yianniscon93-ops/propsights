"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Home, Info, KeyRound } from "lucide-react";
import type { DealRow, InvestStats, MarketResponse, RentalStats, Selection } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { BarsChart } from "./charts";
import Explain, { StatLabel } from "./Explain";

const NEG = "#D98B6A";

const fmtYears = (v: number | null) =>
  v == null || !Number.isFinite(v) ? "—" : v >= 100 ? "100+ yrs" : `~${v.toFixed(0)} yrs`;

function fmtDom(d: Pick<DealRow, "dom" | "domCensored">): string {
  if (d.dom == null) return "—";
  return `${d.domCensored ? "≥" : ""}${d.dom}d`;
}

/**
 * Buy & Rent — for-sale and long-term-rental markets in one place.
 * Everything is phrased as money and years, not finance jargon; the
 * verdict card answers the one question buyers actually ask.
 */
export default function BuyRentTab({
  invest,
  rentals,
  market,
  selection,
}: {
  invest: InvestStats | null;
  rentals: RentalStats | null;
  market: MarketResponse | null;
  selection: Selection;
}) {
  const [budget, setBudget] = useState(500000);

  const areaOcc = market?.snapshot?.occQuartiles?.[1] ?? null;
  const medianPrice = invest?.priceQuartiles?.[1] ?? null;
  const strYear = invest?.strRevenueMedian ?? null;
  const ltrYear = invest?.ltrRentMedian != null ? invest.ltrRentMedian * 12 : null;

  // "Pays for itself in N years" — gross yield flipped into human terms.
  const paybackStr = medianPrice != null && strYear ? medianPrice / strYear : null;
  const paybackLtr = medianPrice != null && ltrYear ? medianPrice / ltrYear : null;

  const parity = invest?.parityMedian ?? null;
  const strWins = strYear != null && ltrYear != null && strYear > ltrYear;
  const verdictMax = Math.max(strYear ?? 0, ltrYear ?? 0, 1);

  const screener = useMemo(
    () => (invest?.screener ?? []).filter((d) => d.price <= budget).slice(0, 8),
    [invest, budget]
  );

  const buyCards = [
    {
      id: "observed_supply" as const,
      label: "Homes for sale",
      value: invest ? fmtInt(invest.supply) : "—",
      accent: true,
    },
    {
      id: "quartiles" as const,
      label: "Median asking price",
      value: fmtEuro(medianPrice),
    },
    {
      id: "eur_m2" as const,
      label: "Median € / m²",
      value: invest?.eurPerM2Median != null ? fmtEuro(invest.eurPerM2Median) : "—",
    },
    {
      id: "dom" as const,
      label: "Avg time on market",
      value: invest?.domAvg != null ? `${invest.domAvg} days` : "—",
      hint:
        invest?.domCensoredShare != null
          ? `${invest.domCensoredShare.toFixed(0)}% were listed before tracking began`
          : undefined,
    },
  ];

  const rentCards = [
    {
      id: "rent_supply" as const,
      label: "Homes for long-term rent",
      value: rentals ? fmtInt(rentals.supply) : "—",
      accent: true,
    },
    {
      id: "monthly_rent" as const,
      label: "Median monthly rent",
      value: rentals?.rentQuartiles ? fmtEuro(rentals.rentQuartiles[1]) : "—",
    },
    {
      id: "payback_years" as const,
      label: "Pays for itself · Airbnb",
      value: fmtYears(paybackStr),
      hint: strYear != null ? `est. ${fmtEuro(strYear)}/yr gross` : undefined,
    },
    {
      id: "payback_years" as const,
      label: "Pays for itself · tenant",
      value: fmtYears(paybackLtr),
      hint: ltrYear != null ? `est. ${fmtEuro(ltrYear)}/yr gross` : undefined,
    },
  ];

  return (
    <div>
      {selection.kind === "area" && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 mb-2.5 text-[13px]"
          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${UI.border}`, color: UI.text }}
        >
          <Info size={15} style={{ color: UI.green }} className="shrink-0" />
          <span className="flex items-center gap-1.5">
            Showing properties around <b style={{ color: UI.green }}>{selection.area.nameEn}</b>{" "}
            (matched by distance from the area centre). Bedrooms &amp; property-type filters apply.
            <Explain id="sale_scope" align="left" />
          </span>
        </div>
      )}

      <motion.div
        key={invest ? "loaded" : "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {[buyCards, rentCards].map((row, i) => (
          <div key={i} className={`grid grid-cols-2 xl:grid-cols-4 gap-2.5 ${i ? "mt-2.5" : ""}`}>
            {row.map((c) => (
              <div key={c.label} className="glass-card rounded-2xl px-4 py-3.5">
                <p className="font-display font-bold text-2xl leading-none" style={{ color: c.accent ? UI.green : UI.text }}>
                  {c.value}
                </p>
                <p className="text-[11px] mt-2 uppercase tracking-wider font-medium flex items-center gap-1.5" style={{ color: UI.muted }}>
                  {c.label}
                  <Explain id={c.id} align="left" />
                </p>
                {"hint" in c && c.hint && (
                  <p className="text-[11px] mt-1" style={{ color: UI.faint }}>
                    {c.hint}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      </motion.div>

      {/* The verdict: Airbnb it or rent it out? */}
      {strYear != null && ltrYear != null && (
        <div className="glass-card rounded-2xl p-5 mt-2.5">
          <div className="flex items-center justify-between mb-4">
            <StatLabel id="verdict" align="left">
              Airbnb it or rent it out?
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              typical property in this selection · gross per year, before costs
            </span>
          </div>
          <div className="flex flex-col gap-3.5">
            {[
              { icon: <Home size={15} />, label: "Short-term (Airbnb)", value: strYear, win: strWins },
              { icon: <KeyRound size={15} />, label: "Long-term tenant", value: ltrYear, win: !strWins },
            ].map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-semibold flex items-center gap-2" style={{ color: UI.text }}>
                    <span style={{ color: r.win ? UI.green : UI.faint }}>{r.icon}</span>
                    {r.label}
                    {r.win && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(143,204,128,0.12)", color: UI.green }}
                      >
                        earns more
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold" style={{ color: r.win ? UI.green : UI.text }}>
                    {fmtEuro(Math.round(r.value))}/yr
                  </span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: r.win
                        ? "linear-gradient(90deg,#4A5E3A,#8FCC80)"
                        : "linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.25))",
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(100 * r.value) / verdictMax}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            ))}
          </div>
          {parity != null && (
            <p className="text-[13px] leading-relaxed mt-4" style={{ color: UI.muted }}>
              The tipping point: Airbnb wins as long as the calendar stays booked at least{" "}
              <b style={{ color: UI.text }}>{parity.toFixed(0)}% of nights</b>
              {areaOcc != null && (
                <>
                  {" "}
                  — this selection currently runs at{" "}
                  <b style={{ color: areaOcc >= parity ? UI.green : NEG }}>{fmtPct(areaOcc)}</b>
                  {areaOcc >= parity
                    ? ", comfortably above it."
                    : ", below it — the tenant wins today."}
                </>
              )}{" "}
              Airbnb income takes work; a tenant is hands-off.
            </p>
          )}
        </div>
      )}

      {/* Buy vs rent, by bedrooms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="quartiles" align="left">
              What buying costs
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              median asking price · count in brackets
            </span>
          </div>
          <BarsChart
            data={(invest?.byBedrooms ?? [])
              .filter((b) => b.count > 0)
              .map((b) => ({ label: `${b.label} (${fmtInt(b.count)})`, value: b.medianPrice }))}
            yFmt={(v) => fmtEuro(v)}
            height={120}
            highlightMax
            showValues
            emptyLabel="No sale listings match this selection"
          />
        </div>
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="monthly_rent" align="left">
              What renting pays
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              median monthly rent · count in brackets
            </span>
          </div>
          <BarsChart
            data={(rentals?.byBedrooms ?? [])
              .filter((b) => b.count > 0)
              .map((b) => ({ label: `${b.label} (${fmtInt(b.count)})`, value: b.medianRent }))}
            yFmt={(v) => fmtEuro(v)}
            height={120}
            highlightMax
            showValues
            emptyLabel="No rental listings match this selection"
          />
        </div>
      </div>

      {/* Deal screener */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <StatLabel id="screener" align="left">
            Deal screener — fastest payback
          </StatLabel>
          <div className="flex items-center gap-3 w-64">
            <span className="text-[11px] whitespace-nowrap" style={{ color: UI.muted }}>
              Budget ≤ <b style={{ color: UI.green }}>{fmtEuro(budget)}</b>
            </span>
            <input
              type="range"
              min={75000}
              max={1500000}
              step={25000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="flex-1 accent-[#8FCC80]"
            />
          </div>
        </div>
        {screener.length ? (
          <div className="overflow-x-auto ps-scroll">
            <table className="w-full text-left" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  {["Listing", "Price", "Pays back in", "Est. earnings", "Based on", "On market", ""].map((h) => (
                    <th
                      key={h}
                      className="text-[10px] uppercase tracking-wider font-semibold py-2 pr-4 whitespace-nowrap"
                      style={{ color: UI.faint, borderBottom: `1px solid ${UI.border}` }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {screener.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2.5 pr-4 text-[13px] font-medium" style={{ color: UI.text, borderBottom: `1px solid ${UI.border}` }}>
                      {d.title}
                      {d.bedrooms != null && d.sizeM2 != null && (
                        <span className="text-[11px] ml-2" style={{ color: UI.faint }}>
                          {d.bedrooms} bed · {Math.round(d.sizeM2)} m²
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-[13px] font-semibold whitespace-nowrap" style={{ color: UI.text, borderBottom: `1px solid ${UI.border}` }}>
                      {fmtEuro(d.price)}
                    </td>
                    <td className="py-2.5 pr-4 text-[13px] font-bold whitespace-nowrap" style={{ color: UI.green, borderBottom: `1px solid ${UI.border}` }}>
                      {d.strYield ? `${(100 / d.strYield).toFixed(1)} yrs` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[13px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                      {d.strRevenue != null ? `${fmtEuro(d.strRevenue)}/yr` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[12px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                      {d.compCount != null ? `${d.compCount} similar rentals` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[12px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                      {fmtDom(d)}
                    </td>
                    <td className="py-2.5 text-[12px]" style={{ borderBottom: `1px solid ${UI.border}` }}>
                      {d.url && (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: UI.green }}
                        >
                          view <ExternalLink size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm" style={{ color: UI.faint }}>
            Nothing with credible comparables under this budget — raise the budget slider or widen
            the area.
          </p>
        )}
      </div>

      {/* Motivated sellers */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <div className="flex items-center justify-between mb-3">
          <StatLabel id="price_cuts" align="left">
            Motivated sellers — biggest price cuts
          </StatLabel>
          <span className="text-[11px]" style={{ color: UI.faint }}>
            {invest?.cutsCount != null
              ? `${fmtInt(invest.cutsCount)} listings have cut · median ${invest.cutsMedianPct?.toFixed(1) ?? "—"}%`
              : ""}
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
          {(invest?.movers ?? []).slice(0, 8).map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 py-2"
              style={{ borderBottom: `1px solid ${UI.border}` }}
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: UI.text }}>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="text-[11px]" style={{ color: UI.faint }}>
                  {fmtEuro(d.price)} · {fmtDom(d)} on market
                  {d.nDrops != null && d.nDrops > 1 ? ` · cut ${d.nDrops} times` : ""}
                </p>
              </div>
              <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: NEG }}>
                {d.priceChangePct != null ? `${d.priceChangePct.toFixed(1)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
        {!invest?.movers?.length && (
          <p className="text-sm" style={{ color: UI.faint }}>
            No observed price cuts in this selection yet — this builds up as tracking continues.
          </p>
        )}
      </div>

      <div
        className="flex items-start gap-2.5 rounded-xl px-4 py-3 mt-2.5 text-[12px] leading-relaxed"
        style={{ background: "rgba(217,139,106,0.06)", border: "1px solid rgba(217,139,106,0.2)", color: UI.muted }}
      >
        <Info size={14} style={{ color: NEG }} className="shrink-0 mt-0.5" />
        <span>
          Earnings figures are <b style={{ color: UI.text }}>estimates from comparable rentals
          nearby</b>, before costs and taxes. Time on market marked ≥ predates our tracking
          (mid-April 2026). Want to run your own numbers? Use the Revenue calculator tab.
        </span>
      </div>
    </div>
  );
}
