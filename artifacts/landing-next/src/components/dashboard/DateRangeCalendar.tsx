"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addWeeks, currentWeekMonday, mondayOf, sundayOf } from "@/lib/dashboard/weeks";
import { UI } from "./tokens";

/**
 * Airbnb-style availability calendar: two months side by side, click a
 * check-in day then a check-out day. Data stays weekly underneath — the
 * picked days snap to whole ISO weeks (Cyprus time) and the snapped span
 * is shown as a soft band behind the exact selection.
 */

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function ym(iso: string): string {
  return iso.slice(0, 7);
}
function addMonths(month: string, n: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
/** All day cells for a month grid, Monday-first, padded with nulls. */
function monthGrid(month: string): Array<string | null> {
  const first = `${month}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  const pad = (d.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array(pad).fill(null);
  while (d.toISOString().slice(0, 7) === month) {
    cells.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return cells;
}

interface Preset {
  label: string;
  range: (min: string, max: string, cur: string) => [string, string];
}
const PRESETS: Preset[] = [
  { label: "Season to date", range: (min, _max, cur) => [min, addDays(cur, -1)] },
  {
    label: "Last 8 weeks",
    range: (min, _max, cur) => {
      const s = addWeeks(cur, -8);
      return [s < min ? min : s, addDays(cur, -1)];
    },
  },
  {
    label: "Next 8 weeks",
    range: (_min, max, cur) => {
      const e = addDays(addWeeks(cur, 8), -1);
      return [cur, e > max ? max : e];
    },
  },
  { label: "Everything", range: (min, max) => [min, max] },
];

export default function DateRangeCalendar({
  min,
  max,
  value,
  onChange,
}: {
  /** Earliest selectable day (first covered Monday). */
  min: string;
  /** Latest selectable day (Sunday closing the last forward week). */
  max: string;
  value: [string, string];
  onChange: (r: [string, string]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ym(value[0]));
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cur = currentWeekMonday();
  const today = addDays(cur, 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDraftStart(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setDraftStart(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const [selStart, selEnd] = value;
  // Preview while picking: start chosen, hovering a later day.
  const previewEnd = draftStart && hoverDay && hoverDay >= draftStart ? hoverDay : null;
  const activeStart = draftStart ?? selStart;
  const activeEnd = draftStart ? (previewEnd ?? draftStart) : selEnd;
  // Week-snapped band (what the data actually aggregates over).
  const snapStart = mondayOf(activeStart);
  const snapEnd = sundayOf(activeEnd);
  const weekCount = Math.round((+new Date(`${addDays(snapEnd, 1)}T00:00:00Z`) - +new Date(`${snapStart}T00:00:00Z`)) / (7 * 86400000));

  const pick = (day: string) => {
    if (!draftStart) {
      setDraftStart(day);
    } else if (day < draftStart) {
      setDraftStart(day);
    } else {
      onChange([draftStart, day]);
      setDraftStart(null);
      setOpen(false);
    }
  };

  const months = useMemo(() => [view, addMonths(view, 1)], [view]);
  const canPrev = view > ym(min);
  const canNext = addMonths(view, 1) < ym(max);

  const dayCell = (day: string | null, i: number) => {
    if (!day) return <span key={`pad-${i}`} className="w-9 h-9" />;
    const disabled = day < min || day > max;
    const isStart = day === activeStart;
    const isEnd = day === activeEnd;
    const inSel = day >= activeStart && day <= activeEnd;
    const inSnap = day >= snapStart && day <= snapEnd;
    const isForward = day >= cur;
    return (
      <button
        key={day}
        disabled={disabled}
        onClick={() => pick(day)}
        onMouseEnter={() => setHoverDay(day)}
        className="relative w-9 h-9 flex items-center justify-center text-[12.5px] font-medium rounded-full transition-colors disabled:cursor-not-allowed"
        style={{
          color: disabled ? "rgba(234,240,223,0.22)" : isStart || isEnd ? "#0C100A" : UI.text,
          background:
            isStart || isEnd
              ? UI.green
              : inSel && !disabled
                ? "rgba(143,204,128,0.22)"
                : inSnap && !disabled
                  ? "rgba(143,204,128,0.07)"
                  : "transparent",
          fontWeight: isStart || isEnd ? 700 : 500,
          textDecoration: "none",
        }}
        title={disabled ? "Outside data coverage" : isForward ? "Future — shows bookings on the books" : undefined}
      >
        {Number(day.slice(8, 10))}
        {day === today && !isStart && !isEnd && (
          <span className="absolute bottom-1 w-1 h-1 rounded-full" style={{ background: UI.green }} />
        )}
      </button>
    );
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setView(ym(selStart));
          setDraftStart(null);
        }}
        className="flex items-center gap-2 rounded-xl px-3.5 h-9 glass-card transition-colors hover:bg-white/[0.06]"
      >
        <CalendarRange size={14} style={{ color: UI.green }} />
        <span className="text-[13px] font-semibold" style={{ color: UI.text }}>
          {fmtDay(selStart)} → {fmtDay(selEnd)}
        </span>
        <span className="text-[11px]" style={{ color: UI.faint }}>
          {Math.round((+new Date(`${addDays(sundayOf(selEnd), 1)}T00:00:00Z`) - +new Date(`${mondayOf(selStart)}T00:00:00Z`)) / (7 * 86400000))}{" "}
          wks
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-[1300] rounded-2xl p-4 shadow-2xl"
          style={{
            background: "rgba(16,20,12,0.98)",
            border: `1px solid ${UI.border}`,
            backdropFilter: "blur(16px)",
            width: "min(608px, calc(100vw - 24px))",
          }}
          onMouseLeave={() => setHoverDay(null)}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => canPrev && setView(addMonths(view, -1))}
              disabled={!canPrev}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] disabled:opacity-30"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} style={{ color: UI.text }} />
            </button>
            <p className="text-[12px]" style={{ color: UI.muted }}>
              {draftStart ? "Now pick the last day" : "Pick the first day of your range"}
            </p>
            <button
              onClick={() => canNext && setView(addMonths(view, 1))}
              disabled={!canNext}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] disabled:opacity-30"
              aria-label="Next month"
            >
              <ChevronRight size={15} style={{ color: UI.text }} />
            </button>
          </div>

          <div className="flex gap-6 justify-center">
            {months.map((m) => (
              <div key={m} className="hidden first:block sm:block">
                <p className="text-center text-[13px] font-bold mb-2" style={{ color: UI.text }}>
                  {fmtMonth(m)}
                </p>
                <div className="grid grid-cols-7 gap-y-0.5">
                  {DOW.map((d) => (
                    <span key={d} className="w-9 h-7 flex items-center justify-center text-[10.5px] font-bold uppercase" style={{ color: UI.faint }}>
                      {d}
                    </span>
                  ))}
                  {monthGrid(m).map(dayCell)}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${UI.border}` }}>
            <span className="text-[11.5px]" style={{ color: UI.muted }}>
              Stats aggregate by whole weeks:{" "}
              <b style={{ color: UI.text }}>
                Mon {fmtDay(snapStart)} – Sun {fmtDay(snapEnd)}
              </b>{" "}
              · {weekCount} {weekCount === 1 ? "week" : "weeks"}
            </span>
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    onChange(p.range(min, max, cur));
                    setDraftStart(null);
                    setOpen(false);
                  }}
                  className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold transition-colors hover:bg-white/[0.08]"
                  style={{ color: UI.muted, border: `1px solid ${UI.border}` }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
