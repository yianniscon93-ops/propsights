"use client";

import { motion } from "framer-motion";
import { Award, BedDouble, ExternalLink, Heart, MapPin, Ruler, Star, Waves, X } from "lucide-react";
import type { ListingDetail, OccWindow } from "@/lib/dashboard/types";
import { AMENITIES } from "@/lib/dashboard/filters";
import { fmtEuro, fmtPct } from "@/lib/dashboard/format";
import { areaLabel } from "@/lib/dashboard/areas";
import { UI } from "./tokens";

/**
 * Glass detail card for a hovered/pinned listing dot.
 * Effective occupancy only (contract: raw never shown).
 */
export default function HoverCard({
  listing,
  pinned,
  window_,
  onClose,
}: {
  listing: ListingDetail;
  pinned: boolean;
  window_: OccWindow;
  onClose: () => void;
}) {
  const occ = window_ === "todate" ? listing.effOccTodate : listing.effOccFwd60;
  const amenityLabels = listing.amenities
    .map((k) => AMENITIES.find((a) => a.key === k)?.label)
    .filter((x): x is string => !!x)
    .slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="glass-dark rounded-2xl p-3.5 w-[270px] pointer-events-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug" style={{ color: UI.text }}>
          {listing.name}
        </p>
        {pinned && (
          <button onClick={onClose} className="p-0.5 shrink-0" aria-label="Close">
            <X size={12} style={{ color: UI.muted }} />
          </button>
        )}
      </div>

      <p className="flex items-center gap-1 text-xs mt-1" style={{ color: UI.muted }}>
        <MapPin size={9} style={{ color: UI.oliveMid }} />
        {listing.areaLabel ?? areaLabel(listing.areaSlug)} · {listing.propertyType ?? "—"}
      </p>

      <div className="flex items-end gap-1.5 mt-2.5">
        <span className="font-display font-bold text-3xl leading-none" style={{ color: UI.green }}>
          {occ != null ? occ.toFixed(1) : "—"}
        </span>
        <span className="font-display font-bold text-sm mb-0.5" style={{ color: UI.oliveMid }}>
          %
        </span>
        <span className="text-[11px] mb-1" style={{ color: UI.faint }}>
          booked · {window_ === "todate" ? "season to date" : "next 60d"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2.5">
        <span className="text-xs" style={{ color: UI.muted }}>
          <BedDouble size={9} className="inline mr-1 -mt-px" style={{ color: UI.oliveMid }} />
          {listing.bedrooms ?? "—"} bed · {listing.beds ?? "—"} beds
        </span>
        <span className="text-xs text-right font-semibold" style={{ color: UI.text }}>
          {fmtEuro(listing.nightlyRate)}/night
        </span>
        <span className="text-xs" style={{ color: UI.muted }}>
          <Star size={9} className="inline mr-1 -mt-px" fill={UI.oliveLight} color={UI.oliveLight} />
          {listing.rating != null ? `${listing.rating.toFixed(2)} (${listing.reviewCount ?? 0})` : "no rating"}
        </span>
        <span className="text-xs text-right" style={{ color: UI.muted }}>
          pace {fmtPct(listing.effOccFwd60)}
        </span>
        {listing.sizeSqm != null && (
          <span className="text-xs" style={{ color: UI.muted }}>
            <Ruler size={9} className="inline mr-1 -mt-px" style={{ color: UI.oliveMid }} />
            {listing.sizeSqm} m²
          </span>
        )}
        {listing.proximityBeachMin != null && (
          <span className="text-xs text-right" style={{ color: UI.muted }}>
            <Waves size={9} className="inline mr-1 -mt-px" style={{ color: UI.oliveMid }} />
            beach {listing.proximityBeachMin} min
          </span>
        )}
      </div>

      {(listing.isSuperhost || listing.isGuestFav) && (
        <div className="flex gap-1.5 mt-2.5">
          {listing.isSuperhost && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold"
              style={{ background: "rgba(143,204,128,0.12)", color: UI.green }}
            >
              <Award size={9} /> Superhost
            </span>
          )}
          {listing.isGuestFav && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold"
              style={{ background: "rgba(168,194,144,0.12)", color: UI.oliveLight }}
            >
              <Heart size={9} /> Guest favourite
            </span>
          )}
        </div>
      )}

      {amenityLabels.length > 0 && (
        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: UI.faint }}>
          {amenityLabels.join(" · ")}
          {listing.amenities.length > 5 && ` · +${listing.amenities.length - 5} more`}
        </p>
      )}

      {listing.airbnbUrl && (
        <a
          href={listing.airbnbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
          style={{ background: "#FF5A5F", color: "#FFFFFF" }}
        >
          <ExternalLink size={13} />
          View on Airbnb
        </a>
      )}
    </motion.div>
  );
}
