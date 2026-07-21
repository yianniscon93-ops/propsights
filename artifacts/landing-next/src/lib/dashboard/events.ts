/**
 * Curated Cyprus demand-calendar for the event overlay (decision 16 Jul 2026):
 * public/religious holidays, major festivals, source-market school holidays
 * and season milestones. Hand-maintained for now; shaped so it can move to a
 * serving-layer table later without touching the charts.
 *
 * Dates: 2026 Orthodox Easter falls on 12 Apr (same as Western). Festival
 * dates without official announcements are the usual window, ±a few days.
 */

export type EventKind = "holiday" | "festival" | "school" | "season";

export interface CyEvent {
  id: string;
  name: string;
  kind: EventKind;
  /** ISO date, inclusive. */
  start: string;
  /** ISO date, inclusive — only ranges (school holidays, long festivals) set it. */
  end?: string;
  /** City/district hint for area-specific events, shown in tooltips. */
  where?: string;
}

export const CY_EVENTS: CyEvent[] = [
  // --- Public & religious holidays (island-wide demand movers) ---
  { id: "epiphany", name: "Epiphany", kind: "holiday", start: "2026-01-06" },
  { id: "green-monday", name: "Green Monday", kind: "holiday", start: "2026-02-23" },
  { id: "greek-independence", name: "Greek Independence Day", kind: "holiday", start: "2026-03-25" },
  { id: "cy-national-day", name: "Cyprus National Day", kind: "holiday", start: "2026-04-01" },
  { id: "orthodox-easter", name: "Orthodox Easter", kind: "holiday", start: "2026-04-10", end: "2026-04-14" },
  { id: "labour-day", name: "Labour Day", kind: "holiday", start: "2026-05-01" },
  { id: "kataklysmos", name: "Kataklysmos", kind: "holiday", start: "2026-05-30", end: "2026-06-01", where: "Larnaca" },
  { id: "assumption", name: "Assumption Day", kind: "holiday", start: "2026-08-15" },
  { id: "cy-independence", name: "Cyprus Independence Day", kind: "holiday", start: "2026-10-01" },
  { id: "ochi-day", name: "Ochi Day", kind: "holiday", start: "2026-10-28" },
  { id: "christmas", name: "Christmas", kind: "holiday", start: "2026-12-24", end: "2026-12-26" },
  { id: "new-year", name: "New Year", kind: "holiday", start: "2026-12-31" },

  // --- Festivals & major events (area-specific spikes) ---
  { id: "limassol-carnival", name: "Limassol Carnival", kind: "festival", start: "2026-02-12", end: "2026-02-23", where: "Limassol" },
  { id: "anthestiria", name: "Anthestiria Flower Festival", kind: "festival", start: "2026-05-10", where: "Paphos & Limassol" },
  { id: "wine-festival", name: "Limassol Wine Festival", kind: "festival", start: "2026-08-28", end: "2026-09-06", where: "Limassol" },
  { id: "aphrodite-festival", name: "Aphrodite Festival", kind: "festival", start: "2026-09-04", end: "2026-09-06", where: "Paphos" },
  { id: "ayia-napa-festival", name: "Ayia Napa Festival", kind: "festival", start: "2026-09-25", end: "2026-09-27", where: "Ayia Napa" },

  // --- Source-market school holidays (shaded ranges — inbound drivers) ---
  { id: "uk-easter", name: "UK school Easter break", kind: "school", start: "2026-03-28", end: "2026-04-12", where: "UK" },
  { id: "uk-may-half", name: "UK May half-term", kind: "school", start: "2026-05-23", end: "2026-05-31", where: "UK" },
  { id: "uk-summer", name: "UK school summer holidays", kind: "school", start: "2026-07-18", end: "2026-09-01", where: "UK" },
  { id: "uk-oct-half", name: "UK October half-term", kind: "school", start: "2026-10-24", end: "2026-11-01", where: "UK" },
  { id: "de-summer", name: "German school summer (staggered)", kind: "school", start: "2026-06-25", end: "2026-09-07", where: "DE" },
  { id: "il-summer", name: "Israeli school summer", kind: "school", start: "2026-07-01", end: "2026-08-31", where: "IL" },

  // --- Season milestones (context lines) ---
  { id: "summer-schedule", name: "Summer flight schedule starts", kind: "season", start: "2026-03-29" },
  { id: "winter-schedule", name: "Winter flight schedule starts", kind: "season", start: "2026-10-25" },
];

const DAY = 86400000;
const t = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

/** Events overlapping [startIso, endIso] (inclusive). */
export function eventsInRange(startIso: string, endIso: string): CyEvent[] {
  const a = t(startIso);
  const b = t(endIso);
  return CY_EVENTS.filter((e) => t(e.start) <= b && t(e.end ?? e.start) >= a);
}

/** Events overlapping the ISO week starting at weekStart (Mon–Sun). */
export function eventsInWeek(weekStart: string): CyEvent[] {
  const end = new Date(t(weekStart) + 6 * DAY).toISOString().slice(0, 10);
  return eventsInRange(weekStart, end);
}
