/**
 * ISO-week helpers pinned to Cyprus time (product decision 11 Jul 2026).
 * All week boundaries are Mondays; "realized" weeks are those that end
 * before the current Cyprus-time week. Safe on server and client.
 */

export const CYPRUS_TZ = "Asia/Nicosia";

/** First fully-covered week (coverage starts Wed 2026-04-01). */
export const FIRST_WEEK = "2026-04-06";

/** Today's date in Cyprus as a YYYY-MM-DD string. */
export function cyprusToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CYPRUS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Monday (ISO date) of the week containing the given YYYY-MM-DD. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Monday of the current week in Cyprus — everything before it is realized. */
export function currentWeekMonday(): string {
  return mondayOf(cyprusToday());
}

export function addWeeks(monday: string, n: number): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sunday that closes the week containing the given date. */
export function sundayOf(iso: string): string {
  return addDays(mondayOf(iso), 6);
}

/** Inclusive list of week Mondays from `start` to `end`. */
export function weeksBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let w = mondayOf(start); w <= end; w = addWeeks(w, 1)) out.push(w);
  return out;
}

/** A week is realized once it ends before the current Cyprus week. */
export function isRealized(weekStart: string): boolean {
  return weekStart < currentWeekMonday();
}

/** Clamp an arbitrary [start, end] onto valid week Mondays within bounds. */
export function clampRange(
  start: string,
  end: string,
  minWeek: string,
  maxWeek: string
): [string, string] {
  let s = mondayOf(start);
  let e = mondayOf(end);
  if (s < minWeek) s = minWeek;
  if (e > maxWeek) e = maxWeek;
  if (e < s) e = s;
  return [s, e];
}
