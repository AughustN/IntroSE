import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, approveAsAdmin, auth, makeStudio } from "./helpers.js";

/**
 * Event deletion (US2, FR-020).
 *
 * The moderation-history condition is the important half. Without it, deletion becomes a way to
 * launder a rejection — erase the removed event, re-submit a clean copy, and the takedown feature 002
 * deliberately preserves is gone. Each of the four conditions is asserted separately (SC-007).
 */
describe("event deletion", () => {
  it("deletes a never-approved draft with no inventory (FR-020)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft" });
    await api().delete(`/api/organizer/events/${s.eventId}`).set(auth(s.token)).expect(204);

    expect((await pool.query(`SELECT 1 FROM events WHERE id = $1`, [s.eventId])).rows).toHaveLength(
      0,
    );
    expect(
      (await pool.query(`SELECT 1 FROM showtimes WHERE event_id = $1`, [s.eventId])).rows,
    ).toHaveLength(0);
  });

  it("refuses an event that was EVER approved, even though it now reads pending_review (R-1, SC-007)", async () => {
    // This is the case `moderation_status` alone cannot see, and the one FR-020 exists to block.
    const s = await makeStudio({ moderation: "approved", status: "draft" });
    await approveAsAdmin(s.eventId, s.userId);
    await pool.query(`UPDATE events SET moderation_status = 'pending_review' WHERE id = $1`, [
      s.eventId,
    ]);

    const res = await api()
      .delete(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("event_was_approved");
    expect((await pool.query(`SELECT 1 FROM events WHERE id = $1`, [s.eventId])).rows).toHaveLength(
      1,
    );
  });

  it.each([["flagged"], ["removed"]])(
    "refuses a %s event — a takedown is not erasable by its subject (FR-020)",
    async (state) => {
      const s = await makeStudio({ moderation: state, status: "draft" });

      const res = await api()
        .delete(`/api/organizer/events/${s.eventId}`)
        .set(auth(s.token))
        .expect(409);
      expect(res.body.error).toBe("event_under_moderation");
      expect(
        (await pool.query(`SELECT 1 FROM events WHERE id = $1`, [s.eventId])).rows,
      ).toHaveLength(1);
    },
  );

  it("refuses an event whose showtime carries a sold ticket (FR-020)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft", sold: 2 });
    const res = await api()
      .delete(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("event_has_inventory");
    expect(res.body.details).toMatchObject({ sold: 2 });
  });

  it("refuses an event whose showtime carries a live hold (FR-020)", async () => {
    const s = await makeStudio({ moderation: "pending_review", status: "draft", reserved: 3 });
    const res = await api()
      .delete(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .expect(409);
    expect(res.body.error).toBe("event_has_inventory");
    expect(res.body.details).toMatchObject({ held: 3 });
  });
});
