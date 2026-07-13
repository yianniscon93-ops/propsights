"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import type { InvestStats, MarketResponse, Selection } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { Slider, Toggle } from "./controls";
import Explain, { StatLabel } from "./Explain";

const NEG = "#D98B6A";

/**
 * Revenue calculator — every input is a slider, seeded with the selected
 * area's real numbers (median rate, occupancy, asking prices by bedrooms).
 * Optional mortgage section; results are pre-tax, first-year estimates.
 */
export default function CalculatorTab({
  invest,
  market,
  selection,
}: {
  invest: InvestStats | null;
  market: MarketResponse | null;
  selection: Selection;
}) {
  const snap = market?.snapshot ?? null;
  const areaOcc = snap?.occQuartiles?.[1] ?? null;

  const [price, setPrice] = useState(250000);
  const [rate, setRate] = useState(120);
  const [occ, setOcc] = useState(55);
  const [costPct, setCostPct] = useState(25);
  const [fixed, setFixed] = useState(3600);
  const [pickedBeds, setPickedBeds] = useState<string | null>(null);

  const [mortgageOn, setMortgageOn] = useState(false);
  const [downPct, setDownPct] = useState(40);
  const [ratePct, setRatePct] = useState(4.2);
  const [years, setYears] = useState(25);

  // Seed sliders from the live selection whenever it produces new data.
  useEffect(() => {
    setPickedBeds(null);
    if (invest?.priceQuartiles) setPrice(Math.round(invest.priceQuartiles[1] / 1000) * 1000);
  }, [invest]);
  useEffect(() => {
    if (snap?.adrQuartiles) setRate(Math.round(snap.adrQuartiles[1]));
    if (snap?.occQuartiles) setOcc(Math.round(snap.occQuartiles[1]));
  }, [snap]);

  const calc = useMemo(() => {
    const gross = rate * 365 * (occ / 100);
    const variable = gross * (costPct / 100);
    const principal = mortgageOn ? price * (1 - downPct / 100) : 0;
    const r = ratePct / 100 / 12;
    const n = years * 12;
    const mortgage = !mortgageOn
      ? 0
      : r === 0
        ? (principal / n) * 12
        : ((principal * r) / (1 - Math.pow(1 + r, -n))) * 12;
    const net = gross - variable - fixed - mortgage;
    const invested = mortgageOn ? price * (downPct / 100) + price * 0.05 : price * 1.05;
    const payback = net > 0 ? invested / net : null;
    // Occupancy at which revenue covers all costs (variable scales with occ).
    const perOccPoint = rate * 365 * (1 - costPct / 100) * 0.01;
    const occNeeded = perOccPoint > 0 ? (fixed + mortgage) / perOccPoint : null;
    return { gross, variable, mortgage, net, invested, payback, occNeeded };
  }, [price, rate, occ, costPct, fixed, mortgageOn, downPct, ratePct, years]);

  const scopeLabel =
    selection.kind === "all"
      ? "all of Cyprus"
      : selection.kind === "area"
        ? selection.area.nameEn
        : "your drawn area";

  const splitSegments = [
    { label: "Profit", value: Math.max(0, calc.net), color: UI.green },
    { label: "Running costs", value: calc.variable, color: UI.oliveMid },
    { label: "Fixed costs", value: fixed, color: "#C9B891" },
    ...(calc.mortgage > 0 ? [{ label: "Mortgage", value: calc.mortgage, color: "#8B937F" }] : []),
  ];
  const splitTotal = splitSegments.reduce((s, x) => s + x.value, 0) || 1;
  const loss = calc.net < 0 ? -calc.net : 0;

  const ltrYear = invest?.ltrRentMedian != null ? invest.ltrRentMedian * 12 : null;

  return (
    <div>
      {/* What it costs to buy here */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <StatLabel id="buy_costs" align="left">
            What it costs to buy in {scopeLabel}
          </StatLabel>
          <span className="text-[11px]" style={{ color: UI.faint }}>
            tap a size to load it into the calculator
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(invest?.byBedrooms ?? [])
            .filter((b) => b.count > 0 && b.medianPrice != null)
            .map((b) => {
              const active = pickedBeds === b.label;
              return (
                <button
                  key={b.label}
                  onClick={() => {
                    setPickedBeds(b.label);
                    setPrice(Math.round(b.medianPrice! / 1000) * 1000);
                  }}
                  className="rounded-xl px-4 py-3 text-left transition-transform hover:scale-[1.02] active:scale-95"
                  style={{
                    border: `1px solid ${active ? "rgba(143,204,128,0.5)" : UI.border}`,
                    background: active ? "rgba(143,204,128,0.1)" : "rgba(255,255,255,0.03)",
                  }}
                >
                  <p className="text-[13px] font-bold" style={{ color: active ? UI.green : UI.text }}>
                    {b.label}
                  </p>
                  <p className="text-[13px] font-semibold" style={{ color: UI.text }}>
                    {fmtEuro(b.medianPrice)}
                  </p>
                  <p className="text-[10px]" style={{ color: UI.faint }}>
                    {fmtInt(b.count)} for sale
                  </p>
                </button>
              );
            })}
          {!invest?.byBedrooms?.some((b) => b.count > 0) && (
            <p className="text-sm" style={{ color: UI.faint }}>
              No sale listings match this selection — widen the area or relax filters.
            </p>
          )}
        </div>
        <p className="text-[11px] mt-3" style={{ color: UI.faint }}>
          Median asking prices in this selection. Breakdown by year of construction is coming soon
          — that attribute isn&apos;t in our synced data yet.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        {/* Inputs */}
        <div className="glass-card rounded-2xl p-5">
          <div className="mb-4">
            <StatLabel id="rev_calc" align="left">
              Your scenario
            </StatLabel>
            <p className="text-[11px] mt-1" style={{ color: UI.faint }}>
              pre-filled with real numbers from {scopeLabel} — drag anything
            </p>
          </div>
          <div className="flex flex-col gap-3.5">
            <Slider label="Purchase price" value={price} min={50000} max={2000000} step={5000} fmt={(v) => fmtEuro(v)} onChange={(v) => { setPrice(v); setPickedBeds(null); }} />
            <Slider label="Nightly rate" value={rate} min={20} max={600} step={5} fmt={(v) => `${fmtEuro(v)}/night`} onChange={setRate} />
            <Slider label="Occupancy" value={occ} min={0} max={100} step={1} fmt={(v) => `${v}% of nights booked`} onChange={setOcc} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Slider label="Running costs" value={costPct} min={10} max={50} step={1} fmt={(v) => `${v}% of revenue`} onChange={setCostPct} />
              <Slider label="Fixed costs" value={fixed} min={0} max={12000} step={100} fmt={(v) => `${fmtEuro(v)}/yr`} onChange={setFixed} />
            </div>
          </div>
          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${UI.border}` }}>
            <div className="flex items-center gap-2">
              <Toggle label="Buying with a mortgage" checked={mortgageOn} onChange={setMortgageOn} />
              <Explain id="mortgage" align="left" />
            </div>
            {mortgageOn && (
              <div className="grid grid-cols-3 gap-x-4 mt-3.5">
                <Slider label="Down payment" value={downPct} min={10} max={90} step={5} fmt={(v) => `${v}%`} onChange={setDownPct} />
                <Slider label="Interest" value={ratePct} min={1} max={8} step={0.1} fmt={(v) => `${v.toFixed(1)}%`} onChange={setRatePct} />
                <Slider label="Term" value={years} min={5} max={35} step={1} fmt={(v) => `${v} yrs`} onChange={setYears} />
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="glass-card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <StatLabel id="rev_calc" align="left">
              What you&apos;d make
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              pre-tax, first-year estimate
            </span>
          </div>

          <motion.div
            key={`${Math.round(calc.net)}`}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <p className="font-display font-bold text-4xl leading-none" style={{ color: calc.net >= 0 ? UI.green : NEG }}>
              {fmtEuro(Math.round(calc.net))}
              <span className="text-lg font-semibold" style={{ color: UI.muted }}>
                {" "}
                /year
              </span>
            </p>
            <p className="text-[13px] mt-1.5" style={{ color: UI.muted }}>
              {calc.net >= 0 ? "profit" : "loss"} · {fmtEuro(Math.round(calc.net / 12))}/month after
              all costs{calc.mortgage > 0 ? " and the mortgage" : ""}
            </p>
          </motion.div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>Gross revenue</p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>{fmtEuro(Math.round(calc.gross))}/yr</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>All costs</p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>
                {fmtEuro(Math.round(calc.variable + fixed + calc.mortgage))}/yr
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>
                {mortgageOn ? "Cash invested" : "Total invested"}
              </p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>{fmtEuro(Math.round(calc.invested))}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>Money back in</p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>
                {calc.payback != null && calc.payback < 100 ? `~${calc.payback.toFixed(0)} years` : "—"}
              </p>
            </div>
          </div>

          {/* Where the revenue goes */}
          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: UI.muted }}>
              Where the revenue goes
            </p>
            <div className="flex h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
              {splitSegments.map((s) => (
                <div
                  key={s.label}
                  title={`${s.label}: ${fmtEuro(Math.round(s.value))}/yr`}
                  style={{ width: `${(100 * s.value) / splitTotal}%`, background: s.color }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {splitSegments.map((s) => (
                <span key={s.label} className="flex items-center gap-1.5 text-[11px]" style={{ color: UI.muted }}>
                  <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: s.color }} />
                  {s.label} {fmtEuro(Math.round(s.value))}
                </span>
              ))}
              {loss > 0 && (
                <span className="text-[11px] font-semibold" style={{ color: NEG }}>
                  shortfall {fmtEuro(Math.round(loss))}/yr
                </span>
              )}
            </div>
          </div>

          {/* Break-even sentence */}
          {calc.occNeeded != null && (
            <div
              className="flex items-start gap-2 rounded-xl px-3.5 py-3 mt-5 text-[12.5px] leading-relaxed"
              style={{ background: "rgba(143,204,128,0.06)", border: `1px solid ${UI.border}`, color: UI.text }}
            >
              <span className="mt-0.5">
                <Explain id="occ_needed" align="left" />
              </span>
              <span>
                Covers its costs once{" "}
                <b style={{ color: calc.occNeeded <= occ ? UI.green : NEG }}>
                  {Math.min(999, calc.occNeeded).toFixed(0)}% of nights
                </b>{" "}
                are booked
                {areaOcc != null && (
                  <>
                    {" "}
                    — {scopeLabel} averages <b style={{ color: UI.green }}>{fmtPct(areaOcc)}</b>
                  </>
                )}
                .
              </span>
            </div>
          )}

          {ltrYear != null && (
            <p className="text-[12px] mt-3.5" style={{ color: UI.faint }}>
              Hands-off alternative: a long-term tenant here grosses ~{fmtEuro(ltrYear)}/yr (median
              advertised rent).
            </p>
          )}
        </div>
      </div>

      <div
        className="flex items-start gap-2.5 rounded-xl px-4 py-3 mt-2.5 text-[12px] leading-relaxed"
        style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${UI.border}`, color: UI.muted }}
      >
        <Info size={14} style={{ color: UI.green }} className="shrink-0 mt-0.5" />
        <span>
          Defaults come from real market data in your selection: median nightly rate, median
          occupancy and median asking prices. Estimates exclude taxes, furnishing and licence
          costs — and your pricing skill is the biggest variable of all.
        </span>
      </div>
    </div>
  );
}
