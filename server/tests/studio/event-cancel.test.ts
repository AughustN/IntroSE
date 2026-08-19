import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, eventStatusOf, makeStudio } from "./helpers.js";

/**
 * Cancelling an event, and the record it must leave behind.
 *
 * This replaces a test that exercised a browser-side mock — an in-memory array that reported refunds
 * nothing had issued. The console now calls the real endpoint, so the behaviour worth pinning is the
 * server's: the event ends, and WHY it ended is written somewhere that cannot later be edited.
 *
 * The reason matters beyond bookkeeping. The confirmation dialog tells the organizer their reason
 * will be kept permanently, and `audit_logs` is append-only by trigger (migration 0013). These cases
 * are what keep that promise honest.
 */
describe("POST /api/organizer/events/:id/cancel", () => {
  it("cancels the event and records the reason in the audit log", async () => {
    const s = await makeStudio();
    const reason = "Sự cố thời tiết bão lũ nghiêm trọng tại khu vực.";

    const res = await api()
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(auth(s.token))
      .send({ reason })
      .expect(200);

    expect(res.body).toHaveProperty("refundedTickets");
    expect(await eventStatusOf(s.eventId)).toBe("cancelled");

    const { rows } = await pool.query<{ detail: { reason?: string }; outcome: string }>(
      `SELECT detail, outcome FROM audit_logs
        WHERE action = 'event.cancel' AND target_type = 'event' AND target_id = $1`,
      [s.eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.reason).toBe(reason);
    expect(rows[0].outcome).toBe("applied");
  });

  it("refuses a reason too short to mean anything, and cancels nothing", async () => {
    const s = await makeStudio();

    await api()
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(auth(s.token))
      .send({ reason: "x" })
      .expect(400);

    // The refusal has to be total: a validation failure that still ended the event would be worse
    // than no validation at all.
    expect(await eventStatusOf(s.eventId)).toBe("on_sale");
  });

  it("refuses a missing reason", async () => {
    const s = await makeStudio();

    await api()
      .post(`/api/organizer/events/${s.eventId}/cancel`)
      .set(auth(s.token))
      .send({})
      .expect(400);

    expect(await eventStatusOf(s.eventId)).toBe("on_sale");
  });

  it("does not let one organizer cancel another's event", async () => {
    const mine = await makeStudio();
    const theirs = await makeStudio();

    await api()
      .post(`/api/organizer/events/${theirs.eventId}/cancel`)
      .set(auth(mine.token))
      .send({ reason: "Không phải sự kiện của tôi." })
      .expect(403);

    expect(await eventStatusOf(theirs.eventId)).toBe("on_sale");
  });
});
