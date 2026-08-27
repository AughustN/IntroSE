import { beforeEach, describe, expect, it, vi } from "vitest";
import { compensate, deliver, recordMetric } from "./ads.delivery.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db/pool.js", () => ({
  pool: { query },
  withTransaction: (run: (db: unknown) => unknown) => run({ query }),
}));
const now = new Date("2026-08-28T12:00:00Z");
const token = "de87324d-7e48-4470-b856-32677f6c58a8";
let cached: unknown[];
let candidates: unknown[];
let legacy: unknown[];
let receipt: unknown[];
let observationChanged: boolean;
let compensationExists: boolean;
let outageOverlap: boolean;
let campaignExists: boolean;
beforeEach(() => {
  query.mockReset();
  cached = [];
  candidates = [];
  legacy = [];
  receipt = [];
  observationChanged = true;
  compensationExists = false;
  outageOverlap = false;
  campaignExists = true;
  query.mockImplementation(async (sql: string) => {
    let rows: unknown[] = [];
    if (sql.includes("AS batch")) rows = [{ batch: 123, now }];
    else if (sql.includes("ORDER BY p.created_at DESC")) rows = legacy;
    else if (sql.includes("d.batch_key = $2")) rows = cached;
    else if (sql.includes("a.eligible,")) rows = candidates;
    else if (sql.includes("d.token = $1")) rows = receipt;
    else if (sql.includes("INSERT INTO ad_observations")) rows = observationChanged ? [{}] : [];
    else if (sql.includes("incident_id=$2")) rows = compensationExists ? [{}] : [];
    else if (sql.includes("FOR UPDATE OF p"))
      rows = campaignExists
        ? [
            {
              starts_at: new Date(now.getTime() - 86400_000),
              ends_at: new Date(now.getTime() + 86400_000),
              now,
              event_id: 7,
              placements: ["hot_events"],
            },
          ]
        : [];
    else if (sql.includes("FROM ad_compensations WHERE purchase_id=$1"))
      rows = outageOverlap ? [{}] : [];
    else if (sql.includes("SELECT 1 FROM showtimes")) rows = [{}];
    return { rows, rowCount: rows.length };
  });
});
const candidate = (id: number, placement = "hero_trailer") => ({
  id,
  event_id: id,
  slug: `event-${id}`,
  placement,
  turns: 0,
  last: 0,
  eligible: true,
  trailer_url: "https://example.test/video.mp4",
  ends_at: new Date(now.getTime() + 86400_000),
});
describe("delivery receipts", () => {
  it("replays the visitor batch without allocating or advancing counters", async () => {
    cached = [
      {
        token,
        event_id: 1,
        slug: "e",
        placement: "hot_events",
        expires_at: new Date(now.getTime() + 90_000),
      },
    ];
    expect((await deliver("hash")).deliveries[0].token).toBe(token);
    expect(query.mock.calls.some(([s]) => s.includes("UPDATE ad_delivery_stats"))).toBe(false);
  });
  it("selects one playable hero and ten distinct hot campaigns, with bounded receipts", async () => {
    candidates = [
      candidate(1),
      { ...candidate(2), trailer_url: null },
      ...Array.from({ length: 20 }, (_, i) => candidate(i + 10, "hot_events")),
    ];
    const feed = await deliver("hash");
    expect(
      feed.deliveries.filter((d) => d.placement === "hero_trailer").map((d) => d.eventId),
    ).toEqual([1]);
    expect(
      new Set(feed.deliveries.filter((d) => d.placement === "hot_events").map((d) => d.eventId))
        .size,
    ).toBe(10);
    expect(feed.deliveries.every((d) => Date.parse(d.expiresAt) <= now.getTime() + 90_000)).toBe(
      true,
    );
    expect(query.mock.calls.filter(([s]) => s.includes("INSERT INTO ad_deliveries"))).toHaveLength(
      1,
    );
  });
  it("does not displace a legacy placement", async () => {
    legacy = [{ event_id: 50, slug: "legacy", placements: ["hero_trailer"] }];
    candidates = [candidate(1)];
    const feed = await deliver("hash");
    expect(feed.legacy).toHaveLength(1);
    expect(feed.deliveries).toHaveLength(0);
  });
  it("does not issue a receipt past the campaign expiry", async () => {
    candidates = [{ ...candidate(1), ends_at: new Date(now.getTime() + 1000) }];
    expect((await deliver("hash")).deliveries[0].expiresAt).toBe(
      new Date(now.getTime() + 1000).toISOString(),
    );
  });
});
describe("metric dedupe", () => {
  it("ignores expired, forged, visitor-mismatched and ineligible receipts", async () => {
    await recordMetric("hash", token, "impression");
    expect(query.mock.calls).toHaveLength(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("d.visitor_hash = $2");
    expect(sql).toContain("d.expires_at > clock_timestamp()");
    expect(sql).toContain("interval '1 second'");
    expect(sql).toContain("moderation_status");
  });
  it.each(["impression", "click", "play"] as const)(
    "increments %s once through an atomic dedupe upsert",
    async (kind) => {
      receipt = [{ purchase_id: 1, placement: "hero_trailer", bucket: 1 }];
      await recordMetric("hash", token, kind);
      observationChanged = false;
      await recordMetric("hash", token, kind);
      expect(query.mock.calls.filter(([s]) => s.includes("UPDATE ad_delivery_stats"))).toHaveLength(
        1,
      );
      expect(query.mock.calls.find(([s]) => s.includes("ON CONFLICT"))?.[0]).toContain(
        `WHERE NOT ad_observations.${kind}`,
      );
    },
  );
});
describe("verified outage compensation", () => {
  const input = {
    purchaseId: 1,
    adminId: 2,
    incidentId: "incident-123",
    from: "2026-08-28T10:00:00Z",
    to: "2026-08-28T11:00:00Z",
    reason: "Verified platform outage",
  };
  it("is idempotent by incident and campaign", async () => {
    compensationExists = true;
    await compensate(input);
    expect(query.mock.calls.some(([s]) => s.includes("UPDATE ad_purchases"))).toBe(false);
  });
  it("rejects overlapping outage claims even with another incident identifier", async () => {
    outageOverlap = true;
    await expect(compensate(input)).rejects.toMatchObject({ code: "outage_already_compensated" });
  });
  it("records the admin and extends only the intersecting outage duration", async () => {
    await compensate(input);
    const audit = query.mock.calls.find(([s]) => s.includes("INSERT INTO ad_compensations"));
    expect(audit?.[1][4]).toBe(3600);
    expect(audit?.[1][6]).toBe(2);
    expect(query.mock.calls.find(([s]) => s.includes("UPDATE ad_purchases"))?.[1][2]).toBe(3600);
  });
  it("rejects future outages and unavailable campaigns", async () => {
    await expect(compensate({ ...input, to: "2026-08-30T11:00:00Z" })).rejects.toMatchObject({
      code: "invalid_outage",
    });
    campaignExists = false;
    await expect(compensate(input)).rejects.toMatchObject({ code: "ad_not_compensable" });
  });
});
