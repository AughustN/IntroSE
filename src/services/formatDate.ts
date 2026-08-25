/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Showtime dates travel as ISO calendar days (`YYYY-MM-DD`) — that is what the catalog API emits
 * (`startsAt.slice(0, 10)`) and what the sample data now mirrors. Screens render them in the
 * day-first order Vietnamese readers expect.
 *
 * Relative wording ("Hôm nay", "Ngày mai") is deliberately not produced here: it cannot be checked
 * against a ticket, it goes stale the moment a page is left open overnight, and it hides which of
 * several dates a card is actually showing.
 *
 * Anything that is not an ISO day is passed through untouched, so a legacy or hand-written label
 * still renders rather than turning into `Invalid Date`.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatEventDate(value: string, withYear = false): string {
  const match = ISO_DAY.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
}

/**
 * A showtime's INSTANT, for the organizer's own screens — clock time first, then the weekday and the
 * full date, in local time.
 *
 * Separate from `formatEventDate` because it takes a different input and answers a different
 * question. That one renders a calendar day the catalog API has already reduced to `YYYY-MM-DD` for
 * a buyer; this one takes the full timestamp `showtimes.starts_at` travels as and keeps the clock
 * time, because "14/09" is not enough to tell two showtimes of the same event apart.
 *
 * Reading order follows the console's own line layout: the organizer scans for WHEN, so the clock
 * leads ("20:00, Thứ Bảy 12/09/2026"). The weekday and the year are always printed — an event list
 * that spans months needs both to say "which Saturday" and "which year" without context.
 *
 * Unparseable input is passed through untouched rather than becoming `Invalid Date`, which is the
 * same contract `formatEventDate` keeps.
 */
const WEEKDAYS_VI = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

export function formatShowtimeAt(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekday = WEEKDAYS_VI[at.getDay()];
  const date = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
  return `${pad(at.getHours())}:${pad(at.getMinutes())}, ${weekday} ${date}`;
}
