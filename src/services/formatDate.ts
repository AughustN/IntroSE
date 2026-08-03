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
