"use client";

import { motion } from "framer-motion";
import { Info, PenLine } from "lucide-react";
import type { InvestStats, Selection } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { BarsChart } from "./charts";
import Explain, { StatLabel } from "./Explain";

/**
 * Buy-side (properties for sale). Named-area filtering isn't available for
 * sale data yet — polygon or whole-island only (contract 6.4).
 */
export default function InvestTab({
  invest,
  selection,
}: {
  invest: InvestStats | null;
  selection: Selection;
}) {
  const areaSelected = selection.kind === "area";

  const cards = [
    {
      id: "observed_supply" as const,
      label: "Listings observed",
      value: invest ? fmtInt(invest.supply) : "—",
      accent: true,
    },
    {
      id: "quartiles" as const,
      label: "Median asking price",
      value: invest?.priceQuartiles ? fmtEuro(invest.priceQuartiles[1]) : "—",
    },
    {
      id: "quartiles" as const,
      label: "Middle-half range",
      value: invest?.priceQuartiles
        ? `${fmtEuro(invest.priceQuartiles[0])}–${fmtEuro(invest.priceQuartiles[2])}`
        : "—",
    },
    {
      id: "eur_m2" as const,
      label: "Median € / m²",
      value: invest?.eurPerM2Median != null ? fmtEuro(invest.eurPerM2Median) : "—",
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

      <div className="glass-card rounded-2xl p-5 mt-2.5">
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

      <div
        className="flex items-start gap-2.5 rounded-xl px-4 py-3 mt-2.5 text-[12px] leading-relaxed"
        style={{ background: "rgba(217,139,106,0.06)", border: "1px solid rgba(217,139,106,0.2)", color: UI.muted }}
      >
        <Info size={14} style={{ color: "#D98B6A" }} className="shrink-0 mt-0.5" />
        <span>
          Counts include some already-sold or withdrawn properties while our expiry detection is
          being finalised — read supply as <b style={{ color: UI.text }}>listings observed</b>, not
          &quot;currently on the market&quot;. Coming soon: days on market, price cuts, rental-income
          estimates and gross-yield per listing.
        </span>
      </div>
    </div>
  );
}
