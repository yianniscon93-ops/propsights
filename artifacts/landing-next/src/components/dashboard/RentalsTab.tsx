"use client";

import { motion } from "framer-motion";
import { PenLine } from "lucide-react";
import type { RentalStats, Selection } from "@/lib/dashboard/types";
import { fmtEuro, fmtInt } from "@/lib/dashboard/format";
import { UI } from "./tokens";
import { BarsChart } from "./charts";
import Explain, { StatLabel } from "./Explain";

/**
 * Long-term rentals. Same named-area limitation as sales — polygon or
 * whole-island only until the area assigner runs for this source (6.5).
 */
export default function RentalsTab({
  rentals,
  selection,
}: {
  rentals: RentalStats | null;
  selection: Selection;
}) {
  const areaSelected = selection.kind === "area";

  const cards = [
    {
      id: "observed_supply" as const,
      label: "Rentals observed",
      value: rentals ? fmtInt(rentals.supply) : "—",
      accent: true,
    },
    {
      id: "monthly_rent" as const,
      label: "Median monthly rent",
      value: rentals?.rentQuartiles ? fmtEuro(rentals.rentQuartiles[1]) : "—",
    },
    {
      id: "quartiles" as const,
      label: "Middle-half range",
      value: rentals?.rentQuartiles
        ? `${fmtEuro(rentals.rentQuartiles[0])}–${fmtEuro(rentals.rentQuartiles[2])}`
        : "—",
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
          Long-term rentals aren&apos;t assigned to named areas yet — showing all of Cyprus. Draw an
          area on the map to analyse a specific location.
        </div>
      )}

      <motion.div
        key={rentals ? "loaded" : "loading"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 xl:grid-cols-3 gap-2.5"
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
          <StatLabel id="monthly_rent" align="left">
            Median monthly rent by bedrooms
          </StatLabel>
          <span className="text-[11px]" style={{ color: UI.faint }}>
            count per size in brackets
          </span>
        </div>
        <BarsChart
          data={(rentals?.byBedrooms ?? [])
            .filter((b) => b.count > 0)
            .map((b) => ({ label: `${b.label} (${fmtInt(b.count)})`, value: b.medianRent }))}
          yFmt={(v) => fmtEuro(v)}
          height={120}
          highlightMax
          emptyLabel="No long-term rentals in this area"
        />
      </div>

      <p className="text-[11px] mt-2.5 px-1" style={{ color: UI.faint }}>
        Coming soon: rent trends over time and rent-vs-short-term-rental comparison for investors.
      </p>
    </div>
  );
}
