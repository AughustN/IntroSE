/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bucket a venue no chain operates is filtered under.
 *
 * Not a fallback for missing data — a true statement about most of the estate. Concert halls,
 * stadiums and auditoriums have no operator in `cinema_chains`, and inventing one would put "Nhà hát
 * Hòa Bình" under a brand. They still belong in the place filter, just not beneath a chain.
 */
export const OTHER_VENUES = "Địa điểm khác";

/**
 * Which chain a cinema belongs to, read off its name — the fallback for rows that carry no link.
 *
 * A chain used to exist only in the venue's name, so this prefix match was the only way to recover
 * it. Migration 0036 made it a row: `cinema_chains` plus `venues.chain_id`, served on every showtime
 * as `venue.chain`. Anything reading a real showtime should use that field and not this function —
 * the link is authoritative, this is inference, and the two disagree the moment an organizer names a
 * cinema in a way the list below does not anticipate.
 *
 * What is left for it is the placeholder event the detail page renders before its API request
 * lands. That one has a venue NAME and nothing else, so the name is all there is to read.
 *
 * Longest prefix first, because "Beta Cineplex" and "Beta" would otherwise both match and the order
 * of the list would decide which.
 */
const CHAINS = [
  "Lotte Cinema",
  "Beta Cineplex",
  "BHD Star",
  "Mega GS",
  "Cinestar",
  "Starlight",
  "Galaxy",
  "CGV",
  "Beta",
  "Rio",
  "Dcine",
  "Cinemax",
] as const;

export function cinemaChain(venueName: string): string | null {
  const name = venueName.trim().toLowerCase();
  return CHAINS.find((chain) => name.startsWith(chain.toLowerCase())) ?? null;
}

/** The chain if the name gives one away, else the bucket the filter can still offer. */
export function chainLabel(venueName: string): string {
  return cinemaChain(venueName) ?? OTHER_VENUES;
}
