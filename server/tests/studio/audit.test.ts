import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../helpers/app.js";
import { bearer, makeAdmin, registerUser } from "../helpers/authFixture.js";
import { api, auditRows, auth, makeStudio } from "./helpers.js";

/**
 * The edit audit trail (US3, FR-026, SC-018).
 *
 * A moderator re-reviewing an edited event otherwise sees "returned because it was edited" with no
 * idea WHAT was edited, and has to re-read the whole listing. Field names turn that into checking one
 * diff. And if someone does work the approve-then-edit path, this is what makes it attributable
 * afterwards.
 */
describe("edit audit trail", () => {
  it("records actor, instant and changed FIELD NAMES — never values (FR-026)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });

    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Tiêu đề bí mật", description: "Nội dung bí mật" })
      .expect(200);

    const rows = await auditRows(s.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(s.userId);
    expect(rows[0].action).toBe("event_edited_pending_review");
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(rows[0].detail.fields.sort()).toEqual(["event.description", "event.title"]);

    // The values themselves must not be in the trail.
    const serialized = JSON.stringify(rows[0].detail);
    expect(serialized).not.toContain("bí mật");
  });

  it("records the inventory-only exemption under its own action (FR-021)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });
    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ capacity: 250 })
      .expect(200);

    const rows = await auditRows(s.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("event_inventory_edited");
    expect(rows[0].detail.fields).toEqual(["tier.capacity"]);
  });

  it("is readable by an admin re-reviewing the event (FR-026)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });
    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ price: 999_000 })
      .expect(200);

    const admin = await registerUser();
    await makeAdmin(admin.userId);
    const queue = await request(app)
      .get("/api/admin/moderation")
      .set(bearer(admin.token))
      .expect(200);
    expect(queue.body.some((e: { id: number }) => e.id === s.eventId)).toBe(true);

    const rows = await auditRows(s.eventId);
    expect(rows[0].detail.fields).toEqual(["tier.price"]);
  });

  it("is append-only: the organizer has no route that alters or deletes it (FR-026)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Một" })
      .expect(200);
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "Hai" })
      .expect(200);

    // Two edits, two rows, in order — nothing overwrites or collapses an earlier entry.
    const rows = await auditRows(s.eventId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "event_edited_pending_review")).toBe(true);

    // And no organizer-facing endpoint exposes a write to the trail.
    await api().delete(`/api/organizer/audit/${s.eventId}`).set(auth(s.token)).expect(404);
  });

  it("accumulates one row per edit across tiers, showtimes and the event (FR-026)", async () => {
    const s = await makeStudio({ moderation: "approved", status: "on_sale" });
    await api()
      .patch(`/api/organizer/events/${s.eventId}`)
      .set(auth(s.token))
      .send({ title: "A" })
      .expect(200);
    await api()
      .patch(`/api/organizer/tiers/${s.tierId}`)
      .set(auth(s.token))
      .send({ label: "B" })
      .expect(200);
    await api()
      .patch(`/api/organizer/showtimes/${s.showtimeId}`)
      .set(auth(s.token))
      .send({ startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString() })
      .expect(200);

    const rows = await auditRows(s.eventId);
    expect(rows.map((r) => r.detail.fields[0])).toEqual([
      "event.title",
      "tier.label",
      "showtime.startsAt",
    ]);
  });
});
