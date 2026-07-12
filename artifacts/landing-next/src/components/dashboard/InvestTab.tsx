"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Info, PenLine, Target } from "lucide-react";
import type { DealRow, InvestStats, MarketResponse, Selection } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt, fmtPct } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { BarsChart } from "./charts";
import Explain, { StatLabel } from "./Explain";

const NEG = "#D98B6A";

function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-medium" style={{ color: UI.text }}>
          {label}
        </span>
        <span className="text-[12px] font-bold" style={{ color: UI.green }}>
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#8FCC80]"
        style={{ height: 18 }}
      />
    </div>
  );
}

function fmtDom(deal: Pick<DealRow, "dom" | "domCensored">): string {
  if (deal.dom == null) return "—";
  return `${deal.domCensored ? "≥" : ""}${deal.dom}d`;
}

/**
 * Buy-side + ROI (sale_listings, comp-enriched 12 Jul 2026). Yields are
 * comp-derived estimates; every headline assumption is user-adjustable or
 * disclosed. Polygon or whole-island scope only (contract 6.4).
 */
export default function InvestTab({
  invest,
  selection,
  market,
}: {
  invest: InvestStats | null;
  selection: Selection;
  market: MarketResponse | null;
}) {
  const areaSelected = selection.kind === "area";
  const areaOcc = market?.snapshot?.occQuartiles?.[1] ?? null;

  // --- Cash-on-cash calculator state ------------------------------------
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [price, setPrice] = useState(250000);
  const [revenue, setRevenue] = useState(30000);
  const [downPct, setDownPct] = useState(40);
  const [ratePct, setRatePct] = useState(4.2);
  const [years, setYears] = useState(25);
  const [costPct, setCostPct] = useState(25);
  const [budget, setBudget] = useState(500000);

  // Seed the calculator from the selection medians (or a picked deal).
  useEffect(() => {
    setDeal(null);
    if (invest?.priceQuartiles) setPrice(Math.round(invest.priceQuartiles[1] / 1000) * 1000);
    if (invest?.strRevenueMedian != null) setRevenue(Math.round(invest.strRevenueMedian / 100) * 100);
  }, [invest]);

  const pickDeal = (d: DealRow) => {
    setDeal(d);
    setPrice(d.price);
    if (d.strRevenue != null) setRevenue(d.strRevenue);
  };

  const calc = useMemo(() => {
    const cashIn = price * (downPct / 100) + price * 0.05; // + ~5% closing costs
    const principal = price * (1 - downPct / 100);
    const r = ratePct / 100 / 12;
    const n = years * 12;
    const debtService =
      principal <= 0 ? 0 : r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
    const annualDebt = debtService * 12;
    const noi = revenue * (1 - costPct / 100);
    const cashFlow = noi - annualDebt;
    const coc = cashIn > 0 ? (100 * cashFlow) / cashIn : null;
    return { cashIn, annualDebt, noi, cashFlow, coc };
  }, [price, revenue, downPct, ratePct, years, costPct]);

  const breakEven = deal?.breakEven ?? invest?.breakEvenMedian ?? null;
  const parity = deal?.parity ?? invest?.parityMedian ?? null;

  const screener = useMemo(
    () => (invest?.screener ?? []).filter((d) => d.price <= budget).slice(0, 8),
    [invest, budget]
  );

  const supplyCards = [
    {
      id: "observed_supply" as const,
      label: "Active listings",
      value: invest ? fmtInt(invest.supply) : "—",
      accent: true,
    },
    {
      id: "quartiles" as const,
      label: "Median asking price",
      value: invest?.priceQuartiles ? fmtEuro(invest.priceQuartiles[1]) : "—",
    },
    {
      id: "eur_m2" as const,
      label: "Median € / m²",
      value: invest?.eurPerM2Median != null ? fmtEuro(invest.eurPerM2Median) : "—",
    },
    {
      id: "dom" as const,
      label: "Avg days on market",
      value: invest?.domAvg != null ? `${invest.domAvg}d` : "—",
      hint:
        invest?.domCensoredShare != null
          ? `${invest.domCensoredShare.toFixed(0)}% listed before tracking began (≥)`
          : undefined,
    },
  ];

  const roiCards = [
    {
      id: "str_yield" as const,
      label: "Median STR gross yield",
      value: invest?.strYieldMedian != null ? `${invest.strYieldMedian.toFixed(1)}%` : "—",
      accent: true,
    },
    {
      id: "str_revenue" as const,
      label: "Median est. STR revenue",
      value: invest?.strRevenueMedian != null ? `${fmtEuro(invest.strRevenueMedian)}/yr` : "—",
    },
    {
      id: "ltr_yield" as const,
      label: "Median LTR gross yield",
      value: invest?.ltrYieldMedian != null ? `${invest.ltrYieldMedian.toFixed(1)}%` : "—",
      hint: invest?.ltrRentMedian != null ? `est. rent ${fmtEuro(invest.ltrRentMedian)}/mo` : undefined,
    },
    {
      id: "price_cuts" as const,
      label: "Listings with price cuts",
      value: invest?.cutsCount != null ? fmtInt(invest.cutsCount) : "—",
      hint:
        invest?.cutsMedianPct != null ? `median cut ${invest.cutsMedianPct.toFixed(1)}%` : undefined,
    },
  ];

  return (
    <div>
      {areaSelected && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 mb-2.5 text-[13px]"
          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${UI.border}`, color: UI.text }}
        >
          <PenLine size={15} style={{ color: UI.green }} className="shrink-0" />
          Sale listings aren&apos;t assigned to named areas yet — showing all of Cyprus. Draw an
          area on the map to analyse a specific location.
        </div>
      )}

      <motion.div
        key={invest ? "loaded" : "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
          {supplyCards.map((c) => (
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

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 mt-2.5">
          {roiCards.map((c) => (
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
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        {/* Cash-on-cash calculator */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <StatLabel id="cash_on_cash" align="left">
              Cash-on-cash calculator
            </StatLabel>
            {deal && (
              <button
                onClick={() => {
                  setDeal(null);
                  if (invest?.priceQuartiles) setPrice(Math.round(invest.priceQuartiles[1] / 1000) * 1000);
                  if (invest?.strRevenueMedian != null) setRevenue(invest.strRevenueMedian);
                }}
                className="text-[11px] font-semibold px-2 py-1 rounded-full transition-colors hover:bg-white/10"
                style={{ color: UI.muted, border: `1px solid ${UI.border}` }}
              >
                reset to selection median
              </button>
            )}
          </div>
          <p className="text-[11px] mb-4" style={{ color: UI.faint }}>
            {deal ? (
              <>
                Based on <b style={{ color: UI.text }}>{deal.title}</b> — pick another from the
                screener below.
              </>
            ) : (
              "Seeded with the median listing in your selection — click any screener row to load a real deal."
            )}
          </p>
          <div className="flex flex-col gap-3">
            <Slider label="Purchase price" value={price} min={50000} max={2000000} step={5000} fmt={(v) => fmtEuro(v)} onChange={setPrice} />
            <Slider label="Est. annual STR revenue" value={revenue} min={5000} max={100000} step={500} fmt={(v) => `${fmtEuro(v)}/yr`} onChange={setRevenue} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Slider label="Down payment" value={downPct} min={10} max={100} step={5} fmt={(v) => `${v}%`} onChange={setDownPct} />
              <Slider label="Interest rate" value={ratePct} min={1} max={8} step={0.1} fmt={(v) => `${v.toFixed(1)}%`} onChange={setRatePct} />
              <Slider label="Loan term" value={years} min={5} max={35} step={1} fmt={(v) => `${v} yrs`} onChange={setYears} />
              <Slider label="Operating costs" value={costPct} min={10} max={50} step={1} fmt={(v) => `${v}% of revenue`} onChange={setCostPct} />
            </div>
          </div>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 rounded-xl p-3.5"
            style={{ background: "rgba(143,204,128,0.06)", border: `1px solid ${UI.border}` }}
          >
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>Cash in</p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>{fmtEuro(Math.round(calc.cashIn))}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>Net operating</p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>{fmtEuro(Math.round(calc.noi))}/yr</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>Debt service</p>
              <p className="text-sm font-bold" style={{ color: UI.text }}>{fmtEuro(Math.round(calc.annualDebt))}/yr</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>Cash-on-cash</p>
              <p className="font-display font-bold text-xl leading-tight" style={{ color: (calc.coc ?? 0) >= 0 ? UI.green : NEG }}>
                {calc.coc != null ? `${calc.coc.toFixed(1)}%` : "—"}
              </p>
            </div>
          </div>
          <p className="text-[11px] mt-2.5" style={{ color: UI.faint }}>
            Includes ~5% closing costs. Pre-tax, first-year, before capital growth.
          </p>
        </div>

        {/* Break-even & parity gauges */}
        <div className="glass-card rounded-2xl p-5">
          <div className="mb-4">
            <StatLabel id="break_even" align="left">
              Occupancy hurdles{deal ? " · this deal" : " · selection median"}
            </StatLabel>
          </div>
          <OccGauge
            label="Break-even occupancy"
            explain="STR covers its running costs above this"
            value={breakEven}
            marker={areaOcc}
            markerLabel="area today"
          />
          <div className="mt-6">
            <OccGauge
              label="STR beats long-term rent above"
              explain="below this, a long-term tenant earns more"
              value={parity}
              marker={areaOcc}
              markerLabel="area today"
            />
          </div>
          <div className="flex items-center gap-1.5 mt-5">
            <Explain id="parity_occ" align="left" />
            <p className="text-[11px]" style={{ color: UI.faint }}>
              Assumptions: €3,600/yr fixed costs + 25% variable — override with the sliders.
            </p>
          </div>
          {areaOcc != null && parity != null && (
            <div
              className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 mt-4 text-[12.5px] leading-relaxed"
              style={{ background: "rgba(143,204,128,0.06)", border: `1px solid ${UI.border}`, color: UI.text }}
            >
              <Target size={14} style={{ color: UI.green }} className="shrink-0 mt-0.5" />
              <span>
                This area runs at <b style={{ color: UI.green }}>{fmtPct(areaOcc)}</b> occupancy —{" "}
                {areaOcc >= parity
                  ? "above the parity line, so short-term letting out-earns a long-term tenant here."
                  : "below the parity line, so a long-term tenant currently out-earns short-term letting here."}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Deal screener */}
      <div className="glass-card rounded-2xl p-5 mt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <StatLabel id="screener" align="left">
            Deal screener — top estimated yields
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
                  {["Listing", "Price", "STR yield", "Est. revenue", "Comps", "On market", ""].map((h) => (
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
                  <tr
                    key={d.id}
                    onClick={() => pickDeal(d)}
                    className="cursor-pointer transition-colors hover:bg-white/5"
                    style={deal?.id === d.id ? { background: "rgba(143,204,128,0.08)" } : undefined}
                  >
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
                      {d.strYield != null ? `${d.strYield.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[13px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                      {d.strRevenue != null ? `${fmtEuro(d.strRevenue)}/yr` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[12px] whitespace-nowrap" style={{ color: UI.muted, borderBottom: `1px solid ${UI.border}` }}>
                      {d.compCount ?? "—"}
                      {d.compAdr != null && d.compOcc != null && (
                        <span style={{ color: UI.faint }}> · {fmtEuro(d.compAdr)} @ {d.compOcc.toFixed(0)}%</span>
                      )}
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
                          onClick={(e) => e.stopPropagation()}
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
            No listings with credible comps under this budget — raise the budget slider.
          </p>
        )}
        <p className="text-[11px] mt-3" style={{ color: UI.faint }}>
          Estimates only — filtered to ≥5 comparable rentals, ≥€50k asking and plausible yields.
          Click a row to load it into the calculator.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mt-2.5">
        {/* Motivated sellers */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="price_cuts" align="left">
              Motivated sellers — deepest cuts
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              observed price changes since first seen
            </span>
          </div>
          <div className="flex flex-col">
            {(invest?.movers ?? []).slice(0, 6).map((d) => (
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
                    {d.nDrops != null && d.nDrops > 1 ? ` · ${d.nDrops} cuts` : ""}
                  </p>
                </div>
                <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: NEG }}>
                  {d.priceChangePct != null ? `${d.priceChangePct.toFixed(1)}%` : "—"}
                </span>
              </div>
            ))}
            {!invest?.movers?.length && (
              <p className="text-sm" style={{ color: UI.faint }}>
                No observed price cuts in this selection yet — trajectory data builds up with each
                sync.
              </p>
            )}
          </div>
        </div>

        {/* Asking price by bedrooms */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <StatLabel id="quartiles" align="left">
              Median asking price by bedrooms
            </StatLabel>
            <span className="text-[11px]" style={{ color: UI.faint }}>
              count per size in brackets
            </span>
          </div>
          <BarsChart
            data={(invest?.byBedrooms ?? [])
              .filter((b) => b.count > 0)
              .map((b) => ({ label: `${b.label} (${fmtInt(b.count)})`, value: b.medianPrice }))}
            yFmt={(v) => fmtEuro(v)}
            height={120}
            highlightMax
            emptyLabel="No sale listings in this area"
          />
        </div>
      </div>

      <div
        className="flex items-start gap-2.5 rounded-xl px-4 py-3 mt-2.5 text-[12px] leading-relaxed"
        style={{ background: "rgba(217,139,106,0.06)", border: "1px solid rgba(217,139,106,0.2)", color: UI.muted }}
      >
        <Info size={14} style={{ color: NEG }} className="shrink-0 mt-0.5" />
        <span>
          All yield and revenue figures are <b style={{ color: UI.text }}>estimates from comparable
          rentals</b> — the comp count shows how solid each one is. Days on market marked ≥ predate
          our tracking (started mid-April 2026). Coming soon: €/m² by condition &amp; build year.
        </span>
      </div>
    </div>
  );
}

/** Horizontal occupancy gauge (0–100%) with an optional area marker. */
function OccGauge({
  label,
  explain,
  value,
  marker,
  markerLabel,
}: {
  label: string;
  explain: string;
  value: number | null;
  marker: number | null;
  markerLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-medium" style={{ color: UI.text }}>
          {label}
        </span>
        <span className="text-sm font-bold" style={{ color: UI.green }}>
          {value != null ? `${value.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
        {value != null && (
          <div
            className="absolute h-full rounded-full"
            style={{ width: `${Math.min(100, value)}%`, background: "linear-gradient(90deg,#4A5E3A,#8FCC80)" }}
          />
        )}
        {marker != null && (
          <div
            className="absolute w-[3px] h-5 -top-[5px] rounded-full"
            style={{ left: `${Math.min(100, marker)}%`, background: "#C9B891" }}
            title={`${markerLabel}: ${marker.toFixed(0)}%`}
          />
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px]" style={{ color: UI.faint }}>
          {explain}
        </span>
        {marker != null && (
          <span className="text-[11px]" style={{ color: "#C9B891" }}>
            ▎{markerLabel} {marker.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
