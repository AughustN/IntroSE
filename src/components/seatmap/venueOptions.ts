/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MyVenue } from "../../services/catalogClient";

/**
 * The venue list, with the accidental repeats collapsed.
 *
 * Measured on the live branch: 515 venues, of which 216 are duplicates by name — and "Online" alone
 * appears 182 times. A picker with 182 identical options is not a picker; the organizer scrolls past
 * a wall of the same word and cannot tell which one they are choosing, because there is nothing to
 * tell.
 *
 * Two rules, and the split between them is the whole point:
 *
 *  1. Rows that are IDENTICAL in everything a person can see — name, city, address — are the same
 *     place typed twice. Only one is offered, and it is the lowest id: the original, with the later
 *     repeats being the accident.
 *
 *  2. Rows that share a NAME but differ in address are two real places. Both stay, and each gains its
 *     address so they can be told apart. Hiding one of these would hide a genuine choice, which is a
 *     worse failure than showing a long list.
 *
 * Nothing is deleted. This is a VIEW over the venues, so a chart already attached to a collapsed row
 * keeps working and the rows stay available everywhere else.
 */
export interface VenueOption {
  id: number;
  label: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");

export function dedupedVenues(venues: readonly MyVenue[]): VenueOption[] {
  /** Same place typed twice → keep the lowest id. */
  const unique = new Map<string, MyVenue>();
  for (const v of venues) {
    const key = `${norm(v.name)}|${norm(v.city)}|${norm(v.rawAddress)}`;
    const seen = unique.get(key);
    if (!seen || v.id < seen.id) unique.set(key, v);
  }

  const kept = [...unique.values()];
  /** Names still held by more than one place after collapsing — those need telling apart. */
  const nameCount = new Map<string, number>();
  for (const v of kept) nameCount.set(norm(v.name), (nameCount.get(norm(v.name)) ?? 0) + 1);

  return kept
    .map((v) => {
      const ambiguous = (nameCount.get(norm(v.name)) ?? 0) > 1;
      // The address distinguishes better than the city, but a venue may have neither — then the name
      // stands alone rather than gaining a dangling dash.
      const detail = v.rawAddress?.trim() || v.city?.trim() || "";
      return { id: v.id, label: ambiguous && detail ? `${v.name} — ${detail}` : v.name };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "vi-VN"));
}
