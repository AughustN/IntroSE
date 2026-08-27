import { describe, expect, it } from "vitest";
import { buildTierLegend, colorForTier } from "./tier-palette";

describe("large ticket tier legends", () => {
  it("keeps all 20 labels, prices and category colours in the seat-map legend", () => {
    const tiers = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      label: `Hạng ${i + 1}`,
      price: (i + 1) * 100_000,
      color: i === 19 ? "#8B1538" : null,
    }));
    const legend = buildTierLegend([...tiers].reverse());
    expect(legend).toHaveLength(20);
    expect(new Set(legend.map((tier) => tier.tierId)).size).toBe(20);
    expect(legend[19]).toEqual({
      tierId: 20,
      label: "Hạng 20",
      price: 2_000_000,
      color: "#8B1538",
    });
    expect(colorForTier(legend, 20)).toBe("#8B1538");
    expect(legend.every((tier) => /^#[0-9A-F]{6}$/i.test(tier.color))).toBe(true);
  });
});
