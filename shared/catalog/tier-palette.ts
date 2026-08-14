/**
 * Tier colours for the buyer's seat map (FR-067).
 *
 * The single most important thing about this file is that it is ONE function imported by both buyer
 * renderers. Colours are **derived at read time** from the tier list, never stored:
 *
 *  - a stored colour would mean a column on `ticket_tiers`, which feature 006 owns, plus its forms —
 *    cross-feature work for no requirement that asks for it;
 *  - ordering the palette by price makes the visual order consistent across every event, so a buyer
 *    learns it once;
 *  - when feature 006 reprices a tier the map re-colours itself on the next read, with no stale value
 *    anywhere;
 *  - and because there is no stored value, the two renderers cannot disagree about it even in
 *    principle (Principle VI).
 *
 * Colour is never the ONLY carrier of price: the legend names every tier and its price, and the seat
 * exposes its tier to assistive technology (FR-071).
 */

/** Ordered cheapest → most expensive. Repeats if a showtime has more tiers than colours. */
export const TIER_COLORS = [
  "#4C9A6B", // green — cheapest
  "#3E7CB1", // blue
  "#C9762F", // amber
  "#9B4D8E", // violet
  "#B3453C", // red — most expensive of the first cycle
] as const;

export interface TierForPalette {
  id: number;
  label: string;
  /** Whole Vietnamese đồng (STD-03). */
  price: number;
  /**
   * The colour authored on the chart CATEGORY this tier prices, when it prices one.
   *
   * Categories put colour in the organizer's hands: they draw "VIP" red and the buyer's map is red
   * there. Where a tier names no category — every general-admission showtime, and any seated map
   * generated before categories existed — the price-ordered palette below still applies, so nothing
   * that worked before loses its colours.
   */
  color?: string | null;
}

export interface TierLegendEntry {
  tierId: number;
  label: string;
  price: number;
  color: string;
}

/**
 * Build the legend: tiers sorted by price ascending, each given the palette colour at its position.
 *
 * Ties are broken by id so the ordering is deterministic — two tiers priced the same must not swap
 * colours between two reads of the same map.
 */
export function buildTierLegend(tiers: readonly TierForPalette[]): TierLegendEntry[] {
  return [...tiers]
    .sort((a, b) => a.price - b.price || a.id - b.id)
    .map((tier, i) => ({
      tierId: tier.id,
      label: tier.label,
      price: tier.price,
      // An authored category colour wins; otherwise fall back to position by price.
      color: tier.color || TIER_COLORS[i % TIER_COLORS.length],
    }));
}

/** Look up one seat's colour. Falls back to neutral so a seat is never unrenderable (edge case). */
export function colorForTier(legend: readonly TierLegendEntry[], tierId: number | null): string {
  if (tierId === null) return NEUTRAL_TIER_COLOR;
  return legend.find((e) => e.tierId === tierId)?.color ?? NEUTRAL_TIER_COLOR;
}

export const NEUTRAL_TIER_COLOR = "#7A7A7A";
