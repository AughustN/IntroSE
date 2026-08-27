import type { AdAvailability, AdPlacement } from "@shared/ads/types.js";
import "dotenv/config";

export const AD_LOCK = 740047;
export function capacityLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("Ad capacity must be 1–1000");
  return n;
}
export const AD_CAPACITY: Record<AdPlacement, number> = {
  hero_trailer: capacityLimit(process.env.AD_HERO_CAPACITY, 4),
  hot_events: capacityLimit(process.env.AD_HOT_CAPACITY, 20),
};
export function unavailable(slots: AdAvailability[]): boolean {
  return slots.some((s) => s.legacy || s.reserved >= s.limit);
}

/** Equal opportunities, not lifetime impressions: a new campaign must not monopolize catch-up. */
export function chooseFair<T extends { id: number; turns: number; last: number }>(
  rows: T[],
  count: number,
): T[] {
  return [...rows]
    .sort((a, b) => a.turns - b.turns || a.last - b.last || a.id - b.id)
    .slice(0, count);
}
