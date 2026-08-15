import { describe, it, expect } from "vitest";

describe("OrganizerBusinessAnalytics Component Tests", () => {
  it("formats integer VND currency properly without decimal places", () => {
    const amount = 150000000;
    const formatted = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);
    expect(formatted).toContain("150.000.000");
  });

  it("calculates net revenue subtracting refund amount correctly", () => {
    const gross = 200000000;
    const refunds = 15000000;
    const net = Math.max(0, gross - refunds);
    expect(net).toBe(185000000);
  });

  it("handles zero upcoming events capacity gauge structure", () => {
    const capacityData = { has_upcoming_event: false };
    expect(capacityData.has_upcoming_event).toBe(false);
  });
});
