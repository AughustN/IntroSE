import { beforeEach, describe, expect, it, vi } from "vitest";
import { purchase } from "./ads.repo.js";
import { AD_POLICY } from "@shared/ads/types.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db/pool.js", () => ({
  pool: { query },
  withTransaction: (run: (db: unknown) => unknown) => run({ query }),
}));
const input = { userId: 1, organizerId: 2, eventId: 3, packageId: 4, acceptedPolicy: AD_POLICY };
let event: { owned: boolean; visible: boolean; covers: boolean; trailer_url: string | null };
let slots: { placement: string; reserved: number; legacy: boolean }[];
let balance: number;
beforeEach(() => {
  query.mockReset();
  event = { owned: true, visible: true, covers: true, trailer_url: "https://cdn.test/t.mp4" };
  slots = [];
  balance = 10_000;
  query.mockImplementation(async (sql: string) => {
    let rows: unknown[] = [];
    if (sql.includes("FROM ad_packages WHERE"))
      rows = [
        { id: 4, price: "1000", duration_days: 7, placements: ["hero_trailer", "hot_events"] },
      ];
    else if (sql.includes("bool_or")) rows = slots;
    else if (sql.includes("AS owned")) rows = [event];
    else if (sql.includes("FROM wallets")) rows = [{ id: 9, balance_amount: balance }];
    else if (sql.includes("INSERT INTO ad_purchases")) rows = [{ id: 10 }];
    else if (sql.includes("AS event_title"))
      rows = [
        {
          id: 10,
          starts_at: new Date(),
          ends_at: new Date(),
          created_at: new Date(),
          delivery_policy: AD_POLICY,
          metrics: [],
          serving: true,
          live: true,
        },
      ];
    return { rows, rowCount: rows.length };
  });
});
const wroteWallet = () =>
  query.mock.calls.some(([sql]) => /UPDATE wallets|INSERT INTO wallet_transactions/.test(sql));
describe("campaign admission before wallet debit", () => {
  it("requires explicit acceptance of new terms", async () => {
    await expect(purchase({ ...input, acceptedPolicy: undefined })).rejects.toMatchObject({
      code: "ad_terms_changed",
    });
    expect(query).not.toHaveBeenCalled();
  });
  it.each([
    { placement: "hero_trailer", reserved: 4, legacy: false },
    { placement: "hot_events", reserved: 20, legacy: false },
    { placement: "hot_events", reserved: 1, legacy: true },
  ])("rejects unavailable $placement without any debit", async (slot) => {
    slots = [slot];
    await expect(purchase(input)).rejects.toMatchObject({ code: "ad_capacity_full" });
    expect(wroteWallet()).toBe(false);
    expect(query.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
  });
  it.each([
    [{ owned: false }, "not_owner"],
    [{ visible: false }, "event_not_promotable"],
    [{ covers: false }, "ad_window_too_long"],
    [{ trailer_url: null }, "ad_trailer_required"],
  ])("refuses an invalid event %j", async (change, code) => {
    Object.assign(event, change);
    await expect(purchase(input)).rejects.toMatchObject({ code });
    expect(wroteWallet()).toBe(false);
  });
  it("insufficient balance does not create a campaign", async () => {
    balance = 500;
    await expect(purchase(input)).rejects.toMatchObject({ code: "insufficient_wallet_balance" });
    expect(wroteWallet()).toBe(false);
    expect(query.mock.calls.some(([s]) => s.includes("INSERT INTO ad_purchases"))).toBe(false);
  });
  it("snapshots the policy and initializes fair counters before a single ledger debit", async () => {
    const result = await purchase(input);
    expect(result.policy).toBe(AD_POLICY);
    expect(query.mock.calls.find(([s]) => s.includes("INSERT INTO ad_purchases"))?.[0]).toContain(
      "'fair_v1'",
    );
    expect(
      query.mock.calls.find(([s]) => s.includes("INSERT INTO ad_delivery_stats"))?.[0],
    ).toContain("min(a.turns)");
    expect(
      query.mock.calls.filter(([s]) => s.includes("INSERT INTO wallet_transactions")),
    ).toHaveLength(1);
  });
});
