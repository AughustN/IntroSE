import { describe, expect, it } from "vitest";
import { AI_RATE_LIMIT } from "../../src/config.js";
import { exhaustQuotaForTest } from "../../src/modules/studio/ai/ai.throttle.js";
import {
  FakeListingModel,
  setListingModelForTest,
} from "../../src/modules/studio/ai/listing.model.js";
import { pool } from "../../src/db/pool.js";
import {
  seedShowtime,
  seedTier,
  seedVenue,
  seedEvent,
  seedOrganizer,
  seedUser,
} from "../helpers/catalogSeed.js";
import { api, auth, makeStudio } from "./helpers.js";

/**
 * The AI listing assistant (US5, UC-22).
 *
 * Principle III is the whole point of this file: assistive, grounded, and non-blocking. The three
 * degradation branches must NOT be error statuses, the rate limit must bite before the cache, and the
 * price must never come from the model.
 */

const listing = (token: string, body: Record<string, unknown>) =>
  api().post("/api/organizer/ai/listing").set(auth(token)).send(body);

describe("AI listing assistant", () => {
  it("returns per-field suggestions from rough inputs (FR-027)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    const res = await listing(s.token, {
      topic: "nhạc acoustic",
      keywords: ["indie", "sân thượng"],
    }).expect(200);

    expect(res.body.available).toBe(true);
    expect(res.body.suggestion.titles.length).toBeGreaterThan(0);
    expect(res.body.suggestion.description).toBeTruthy();
    expect(res.body.suggestion.tags).toContain("indie");
  });

  it("writes nothing to the event — a suggestion is only a suggestion (FR-028)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    const before = (
      await pool.query(`SELECT title, description FROM events WHERE id = $1`, [s.eventId])
    ).rows[0];

    await listing(s.token, { eventId: s.eventId, topic: "nhạc jazz" }).expect(200);

    expect(
      (await pool.query(`SELECT title, description FROM events WHERE id = $1`, [s.eventId]))
        .rows[0],
    ).toEqual(before);
  });

  it("refuses a request for an approved, on-sale event (FR-027)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });
    const res = await listing(s.token, { eventId: s.eventId, topic: "nhạc jazz" }).expect(409);
    expect(res.body.error).toBe("ai_unavailable_live_event");
  });

  it("refuses another organizer’s event before spending anything (FR-033, SEC-04)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    const other = await makeStudio({ moderation: "pending_review", status: "draft" });
    const res = await listing(other.token, { eventId: s.eventId, topic: "x" }).expect(403);
    expect(res.body.error).toBe("not_owner");
  });

  it("blocks the 11th request in an hour while manual entry keeps working (SC-012, FR-031)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });

    for (let i = 0; i < AI_RATE_LIMIT; i++) {
      await listing(s.token, { topic: "nhạc acoustic" }).expect(200);
    }
    const blocked = await listing(s.token, { topic: "nhạc acoustic" }).expect(429);
    expect(blocked.body.error).toBe("ai_rate_limited");
    expect(blocked.body.message).toContain("thử lại sau");

    // The form still works: an ordinary edit is completely unaffected by the assistant's limit.
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Tự nhập" })
      .expect(200);
  });

  it("counts CACHE HITS against the hourly allowance, which is what makes SEC-08 verifiable", async () => {
    // Eleven IDENTICAL calls are ten cache hits. A cache checked before the limit would let all
    // eleven through and the fairness control could never be observed.
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });

    const first = await listing(s.token, { topic: "giống hệt nhau" }).expect(200);
    expect(first.body.cached).toBe(false);

    const second = await listing(s.token, { topic: "giống hệt nhau" }).expect(200);
    expect(second.body.cached).toBe(true);

    for (let i = 2; i < AI_RATE_LIMIT; i++) {
      await listing(s.token, { topic: "giống hệt nhau" }).expect(200);
    }
    await listing(s.token, { topic: "giống hệt nhau" }).expect(429);
  });

  it("serves an identical request from cache without another upstream call (SC-014, FR-032)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    await listing(s.token, { topic: "nhạc trịnh", keywords: ["acoustic"] }).expect(200);

    // Swap in a model that would throw if it were reached — a cache hit must not touch it.
    setListingModelForTest(new FakeListingModel("throw"));
    const cached = await listing(s.token, { topic: "nhạc trịnh", keywords: ["acoustic"] }).expect(
      200,
    );

    expect(cached.body.available).toBe(true);
    expect(cached.body.cached).toBe(true);
    expect(cached.body.suggestion.titles.length).toBeGreaterThan(0);
  });

  it.each([
    ["timeout", "hang", "timeout"],
    ["upstream error", "throw", "error"],
    ["unusable output", "malformed", "error"],
  ])(
    "degrades on %s with a 200, never an error status (SC-013, FR-030)",
    async (_name, behaviour, reason) => {
      const s = await makeStudio({ moderation: "pending_review", status: "draft" });
      setListingModelForTest(new FakeListingModel(behaviour as "hang" | "throw" | "malformed"));

      const res = await listing(s.token, { topic: "nhạc rock" }).expect(200);
      expect(res.body.available).toBe(false);
      expect(res.body.reason).toBe(reason);
      expect(res.body.suggestion).toBeUndefined();
    },
    20_000,
  );

  it("degrades when the platform-wide daily quota is exhausted (SCAL-03, FR-030)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    exhaustQuotaForTest();

    const res = await listing(s.token, { topic: "nhạc mới" }).expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe("quota_exhausted");
  });

  it("never blocks the organizer: every studio operation works while the assistant is broken (FR-029)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    setListingModelForTest(new FakeListingModel("throw"));

    await listing(s.token, { topic: "hỏng" }).expect(200); // degraded, not failed
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Vẫn sửa được" })
      .expect(200);
    await api()
      .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
      .set(auth(s.token))
      .send({ label: "Vẫn thêm được", price: 50_000 })
      .expect(201);
  });

  it("derives the price from comparable published events, not from the model (FR-033, R-6)", async () => {
    // Five comparable music events in Hà Nội priced 100k…500k — the median is 300k.
    const city = "Hà Nội";
    for (const price of [100_000, 200_000, 300_000, 400_000, 500_000]) {
      const org = await seedOrganizer(await seedUser());
      const venue = await seedVenue(await seedUser(), city);
      const ev = await seedEvent({ organizerId: org, category: "music" });
      const st = await seedShowtime(ev.id, venue);
      await seedTier(st, { price });
    }

    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    const res = await listing(s.token, { topic: "nhạc sống", categoryCode: "music", city }).expect(
      200,
    );

    expect(res.body.suggestion.price).toBe(300_000);
    expect(res.body.suggestion.priceBasis).toBe(5);
    expect(Number.isInteger(res.body.suggestion.price)).toBe(true); // whole đồng (STD-03)
  });

  it("omits the price rather than guessing when there are too few comparables (FR-033)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    const res = await listing(s.token, {
      topic: "thể loại hiếm",
      categoryCode: "music",
      city: "Cần Thơ",
    }).expect(200);

    expect(res.body.suggestion.price).toBeNull();
    expect(res.body.suggestion.priceBasis).toBeNull();
  });

  it("rejects an invalid payload before doing anything (SEC-07)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    await listing(s.token, { topic: "" }).expect(400);
    await listing(s.token, {}).expect(400);
  });
});
