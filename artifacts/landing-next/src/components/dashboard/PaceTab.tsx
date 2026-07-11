"use client";

import { CalendarClock, Hourglass, TrendingUp } from "lucide-react";
import { UI } from "./tokens";

/**
 * Booking Pace — stub (contract 6.3). The lead-time / pickup data exists
 * upstream but isn't published to the serving layer yet; this page frames
 * what lands here so the tab has a clear promise instead of a dead end.
 */
export default function PaceTab() {
  const items = [
    {
      icon: <Hourglass size={18} style={{ color: UI.green }} />,
      title: "How far ahead guests book",
      text: "Lead-time curves by stay month — e.g. June nights book about 10 days out, while October books ~4½ months ahead. Know when your booking window actually opens.",
    },
    {
      icon: <TrendingUp size={18} style={{ color: UI.green }} />,
      title: "Pickup curves",
      text: "How full an average week is at 90, 60 and 30 days before arrival — so you can tell whether your own calendar is ahead of or behind the market.",
    },
    {
      icon: <CalendarClock size={18} style={{ color: UI.green }} />,
      title: "Stay-length mix",
      text: "The split of 2-night weekends vs week-long stays by season, to shape your minimum-stay rules.",
    },
  ];

  return (
    <div className="glass-card rounded-2xl p-8">
      <div className="max-w-xl">
        <p
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4"
          style={{ background: "rgba(143,204,128,0.1)", color: UI.green }}
        >
          Coming soon
        </p>
        <h3 className="font-display font-bold text-2xl mb-2" style={{ color: UI.text }}>
          Booking pace
        </h3>
        <p className="text-sm leading-relaxed mb-6" style={{ color: UI.muted }}>
          The data behind this page is already being collected — it ships as soon as the stay-level
          feed lands in our serving layer. Here&apos;s what you&apos;ll get:
        </p>
        <div className="flex flex-col gap-4">
          {items.map((it) => (
            <div key={it.title} className="flex items-start gap-3.5">
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(143,204,128,0.08)", border: `1px solid ${UI.border}` }}
              >
                {it.icon}
              </span>
              <div>
                <p className="text-sm font-bold" style={{ color: UI.text }}>
                  {it.title}
                </p>
                <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: UI.muted }}>
                  {it.text}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[12px] mt-6" style={{ color: UI.faint }}>
          Meanwhile, the weekly bookings chart on Market overview is the live demand-speed signal.
        </p>
      </div>
    </div>
  );
}
