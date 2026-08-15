import { describe, it, expect } from "vitest";
import { getOrganizerAnalyticsService } from "../src/modules/organizer/analyticsService.js";

describe("Organizer Analytics Service & RBAC Tests", () => {
  it("returns zero-state structure when user is not an approved organizer", async () => {
    const data = await getOrganizerAnalyticsService(999999);
    expect(data.overview.gross_revenue_vnd).toBe(0);
    expect(data.overview.total_refund_amount_vnd).toBe(0);
    expect(data.overview.net_revenue_vnd).toBe(0);
    expect(data.overview.total_tickets_sold).toBe(0);
    expect(data.soonest_event_capacity.has_upcoming_event).toBe(false);
  });

  it("handles date period filter and custom range cleanly", async () => {
    const data = await getOrganizerAnalyticsService(999999, {
      period: "custom",
      startDate: "2026-08-01T00:00:00Z",
      endDate: "2026-08-13T23:59:59Z",
    });
    expect(data).toBeDefined();
    expect(data.overview.period_comparison).toBeDefined();
    expect(Array.isArray(data.time_series)).toBe(true);
    expect(Array.isArray(data.top_events)).toBe(true);
  });

  it("calculates net revenue correctly (gross_revenue minus total_refunds)", async () => {
    const data = await getOrganizerAnalyticsService(1);
    expect(data.overview.net_revenue_vnd).toBe(
      Math.max(0, data.overview.gross_revenue_vnd - data.overview.total_refund_amount_vnd)
    );
  });
});


