/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which chain a cinema belongs to, read off its name.
 *
 * `venues` has no column for this. A chain is not a thing the product owns — an organizer types a
 * venue name and that is all there is — so adding a column would mean asking every organizer to
 * classify a venue into a taxonomy that only matters for films. The name already carries it: the
 * estate is seeded as "CGV Vincom Landmark 81", "Lotte Cinema Gold View", "Beta Cineplex Mỹ Đình".
 *
 * Longest prefix first, because "Beta Cineplex" and "Beta" would otherwise both match and the order
 * of the list would decide which. Returns null for anything that is not a cinema — a concert hall
 * or a stadium has no chain, and inventing one would put "Nhà hát Hòa Bình" under a brand.
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

/** The chain if there is one, else a bucket the filter can still offer. */
export function chainLabel(venueName: string): string {
  return cinemaChain(venueName) ?? "Địa điểm khác";
}
