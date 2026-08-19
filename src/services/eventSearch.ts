/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What "matches what I typed" means, in one place.
 *
 * Two screens ask the question now — the catalog grid filters by it, and the nav's dropdown answers
 * it while the reader is still typing — and a suggestion list that disagrees with the page it leads
 * to is worse than no suggestions: you pick the fourth row, land on `/events`, and the fourth row is
 * not there.
 *
 * Matching is a substring test over everything printed about an event, folded to unaccented
 * lowercase so "san khau" finds "Sân khấu" — Vietnamese is routinely typed without its diacritics,
 * and an accent-sensitive search silently returns nothing for a correctly spelled query.
 */

import type { MovieEvent } from "../types";

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

/** Everything about an event a reader might type. Built once per test; callers memoise the list. */
function blob(event: MovieEvent): string {
  return fold(
    [
      event.title,
      event.originalTitle,
      event.genre.join(" "),
      event.director,
      event.cast.join(" "),
      event.tags.join(" "),
      event.categoryLabel,
      event.location,
      event.venueName,
      event.city,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** An empty query matches everything — it is not a filter until something is typed. */
export function matchesQuery(event: MovieEvent, query: string): boolean {
  const needle = fold(query.trim());
  return needle === "" || blob(event).includes(needle);
}

/**
 * The events to offer under the search box, best first.
 *
 * "Best" is only two rules deep, and deliberately so: a title match beats a match buried in the
 * venue or the line-up, because that is what the reader is looking at while they type; after that
 * the soonest bookable event wins. Anything more elaborate would be a ranking nobody can predict
 * from the row they are reading.
 */
export function searchEvents(events: MovieEvent[], query: string, limit: number): MovieEvent[] {
  const needle = fold(query.trim());
  if (!needle) return [];

  const bookable = (event: MovieEvent) => event.status === "available";

  return events
    .filter((event) => matchesQuery(event, query))
    .sort((a, b) => {
      const titleA = fold(a.title).includes(needle);
      const titleB = fold(b.title).includes(needle);
      if (titleA !== titleB) return titleA ? -1 : 1;
      if (bookable(a) !== bookable(b)) return bookable(a) ? -1 : 1;
      return (a.dates[0] ?? "").localeCompare(b.dates[0] ?? "");
    })
    .slice(0, limit);
}
