/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An inclusive span of civil dates, both ends `YYYY-MM-DD`.
 *
 * A single day is a span whose ends are equal, so the rest of the app never has to branch on
 * "one date or several" — there is one shape, and `null` means no filter at all.
 */
export interface DateRange {
  from: string;
  to: string;
}

export type DateFilter = DateRange | null;

/** The whole of the month `iso` falls in. */
export function monthRange(year: number, month: number): DateRange {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

/**
 * The Monday-to-Sunday week containing `iso`, matching the grid's Monday-first columns.
 *
 * The arithmetic runs entirely in UTC. Adding days to a local `Date` crosses daylight-saving
 * boundaries in some zones and lands on the same civil day twice, or skips one — UTC has no such
 * discontinuity, and these are civil dates with no time of day to preserve anyway.
 */
export function weekRange(iso: string): DateRange {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));

  const mondayOffset = (at.getUTCDay() + 6) % 7;
  const monday = new Date(at);
  monday.setUTCDate(at.getUTCDate() - mondayOffset);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { from: fmt(monday), to: fmt(sunday) };
}

/**
 * `iso` shifted by whole days, in UTC for the reason `weekRange` gives: civil dates have no time of
 * day to preserve, and local-time arithmetic lands on the same day twice across a DST boundary.
 */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The seven civil days of the Monday-first week containing `iso`, in order. */
export function weekDays(iso: string): string[] {
  const monday = weekRange(iso).from;
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Today as a civil date, read in the reader's own zone — the day their calendar shows. */
export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Ends in ascending order, whichever way round they were clicked. */
export function orderedRange(a: string, b: string): DateRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/**
 * Whether an event running on `dates` falls inside the filter.
 *
 * The comparison is a plain string compare, which is exact for `YYYY-MM-DD`: the format is
 * fixed-width and big-endian, so lexicographic order is chronological order. No `Date` is
 * constructed, so no timezone can move a boundary by a day.
 */
export function matchesDateFilter(dates: readonly string[], filter: DateFilter): boolean {
  if (!filter) return true;
  return dates.some((d) => d >= filter.from && d <= filter.to);
}

/** `null` → every date; otherwise the span, for display. */
export function isSingleDay(filter: DateFilter): boolean {
  return filter !== null && filter.from === filter.to;
}
