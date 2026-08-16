import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { seedSale } from "../helpers/salesSeed.js";
import * as wl from "../helpers/waitlistSeed.js";
import {
  auditRows,
  countAudit,
  eventModeration,
  isPublic,
  notificationsFor,
  organizerStatus,
  reportRow,
  seedAdmin,
  seedApprovedEvent,
  seedApprovedOrganizer,
  seedPendingEvent,
  seedPendingOrganizer,
  seedReport,
} from "../helpers/moderationSeed.js";

// Feature 004 — admin organizer & event moderation (UC-33/UC-34).
// These assert the refusals and the atomicity, not just the happy path: RBAC denial, conflict on a
// repeated/racing decision, live public hiding, and the DB-level append-only audit guarantee.

describe("T023 [US1] organizer approval & rejection", () => {
  it("approve → approved, capability on the next request, notification intent, one audit row (FR-002/004/005, SC-001)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();

    // pending → no organizer capability yet
    await request(app).get("/api/organizers/dashboard").set(bearer(org.token)).expect(403);

    const queue = await request(app).get("/api/admin/organizers").set(admin.h).expect(200);
    expect(
      queue.body.some(
        (o: { id: number; status: string }) => o.id === org.organizerId && o.status === "pending",
      ),
    ).toBe(true);

    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/approve`)
      .set(admin.h)
      .expect(200);

    expect((await organizerStatus(org.organizerId)).status).toBe("approved");
    // capability is derived per request (FR-005) — the SAME token now passes
    await request(app).get("/api/organizers/dashboard").set(bearer(org.token)).expect(200);

    const notes = await notificationsFor("organizer", org.organizerId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      recipient_user_id: org.userId,
      kind: "organizer_approved",
      status: "pending",
    });

    const audit = await auditRows("organizer_approved", org.organizerId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: admin.userId,
      target_type: "organizer",
      outcome: "applied",
    });
    expect(audit[0].detail).toMatchObject({ before: "pending", after: "approved" });
  });

  it("reject → rejected with the reason visible to the applicant, and re-apply is allowed (FR-003/004)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();
    const reason = "Giấy tờ chưa hợp lệ.";

    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/reject`)
      .set(admin.h)
      .send({ reason })
      .expect(200);

    expect(await organizerStatus(org.organizerId)).toMatchObject({
      status: "rejected",
      review_note: reason,
    });
    await request(app).get("/api/organizers/dashboard").set(bearer(org.token)).expect(403);

    // the applicant can read their own rejection reason
    const mine = await request(app).get("/api/organizers/me").set(bearer(org.token)).expect(200);
    expect(mine.body.isOrganizer).toBe(false);
    expect(mine.body.applications[0]).toMatchObject({ status: "rejected", review_note: reason });

    // …and correct + resubmit (FR-003), keeping the rejected row as history
    await request(app)
      .post("/api/organizers/apply")
      .set(bearer(org.token))
      .send({ displayName: "Nhà tổ chức chờ duyệt", description: "Đơn đã bổ sung giấy tờ." })
      .expect(201);
    expect(
      (
        await pool.query(`SELECT count(*)::int AS c FROM organizers WHERE user_id = $1`, [
          org.userId,
        ])
      ).rows[0].c,
    ).toBe(2);

    expect(await auditRows("organizer_rejected", org.organizerId)).toHaveLength(1);
  });

  it("repeating an incompatible decision is a 409 and changes nothing (FR-001 scenario 4)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();
    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/approve`)
      .set(admin.h)
      .expect(200);

    const before = await countAudit();
    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/reject`)
      .set(admin.h)
      .send({ reason: "Đổi ý" })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("moderation_conflict"));

    expect((await organizerStatus(org.organizerId)).status).toBe("approved"); // first decision stands
    expect(await countAudit()).toBe(before); // no audit row for a refused transition
  });

  it("refuses every organizer action for a non-admin and an anonymous caller (FR-020, SC-006)", async () => {
    const attendee = await registerUser();
    const org = await seedPendingOrganizer();
    const paths = [
      `/api/admin/organizers/${org.organizerId}/approve`,
      `/api/admin/organizers/${org.organizerId}/reject`,
      `/api/admin/organizers/${org.organizerId}/suspend`,
    ];

    for (const p of paths) {
      await request(app).post(p).send({ reason: "x" }).expect(401);
      await request(app).post(p).set(bearer(attendee.token)).send({ reason: "x" }).expect(403);
    }
    await request(app).get("/api/admin/organizers").set(bearer(attendee.token)).expect(403);

    expect((await organizerStatus(org.organizerId)).status).toBe("pending");
    expect(await countAudit()).toBe(0); // no state, no audit (SC-006)
  });

  it("rejects a malformed reason and a non-existent target (FR-026)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();

    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/reject`)
      .set(admin.h)
      .send({})
      .expect(400);
    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/reject`)
      .set(admin.h)
      .send({ reason: "   " })
      .expect(400);
    await request(app).post(`/api/admin/organizers/999999/approve`).set(admin.h).expect(404);

    expect((await organizerStatus(org.organizerId)).status).toBe("pending");
  });
});

describe("T024 [US2] organizer suspension hides owned events immediately", () => {
  it("suspend → capability off and every owned event gone from public reads on the next request (FR-006/007/008, SC-002)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedApprovedEvent(org, admin, "Đêm nhạc Hà Nội");

    expect(await isPublic("Đêm nhạc Hà Nội")).toBe(true);
    const detail = await request(app).get(`/api/events/${ev.slug}`).expect(200);
    expect(detail.body.title).toBe("Đêm nhạc Hà Nội");

    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/suspend`)
      .set(admin.h)
      .send({ reason: "Vi phạm quy định." })
      .expect(200);

    // list, detail, showtimes, seat map — all hidden on the very next request (SC-002)
    expect(await isPublic("Đêm nhạc Hà Nội")).toBe(false);
    await request(app).get(`/api/events/${ev.slug}`).expect(404);
    expect(
      (await request(app).get(`/api/events/${ev.eventId}/showtimes`).expect(200)).body,
    ).toEqual([]);
    await request(app).get(`/api/showtimes/${ev.showtimeId}/seat-map`).expect(404);

    // organizer capability is refused on the next request (FR-008)
    await request(app).get("/api/organizers/dashboard").set(bearer(org.token)).expect(403);

    // the event still EXISTS with its moderation state — nothing was deleted (FR-009/027)
    expect(await eventModeration(ev.eventId)).toMatchObject({
      moderation_status: "approved",
      status: "on_sale",
    });
    expect(await organizerStatus(org.organizerId)).toMatchObject({
      status: "suspended",
      review_note: "Vi phạm quy định.",
    });
    expect(await auditRows("organizer_suspended", org.organizerId)).toHaveLength(1);
  });

  it("a suspended organizer cannot re-apply, and suspending a pending application is a 409 (FR-006)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/suspend`)
      .set(admin.h)
      .send({ reason: "Vi phạm." })
      .expect(200);

    await request(app)
      .post("/api/organizers/apply")
      .set(bearer(org.token))
      .send({ displayName: "X", description: "Nộp lại." })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("suspended_cannot_reapply"));

    // suspension only applies to an APPROVED organizer
    const pending = await seedPendingOrganizer();
    await request(app)
      .post(`/api/admin/organizers/${pending.organizerId}/suspend`)
      .set(admin.h)
      .send({ reason: "x" })
      .expect(409);
    expect((await organizerStatus(pending.organizerId)).status).toBe("pending");
  });
});

describe("T025 [US3] pre-publish approve/reject gate", () => {
  it("a pending_review event is never public until approved, and only while on_sale + organizer approved (FR-011, SC-003)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Liveshow Chờ Duyệt");
    const draft = await request(app)
      .post("/api/organizer/events")
      .set(bearer(org.token))
      .send({
        title: "Bản nháp chưa gửi duyệt",
        categoryCode: "music",
        description: "Mô tả sự kiện.",
        eventType: "general_admission",
      })
      .expect(201);

    expect(await eventModeration(ev.eventId)).toMatchObject({
      status: "on_sale",
      moderation_status: "pending_review",
    });
    expect(await isPublic("Liveshow Chờ Duyệt")).toBe(false);
    await request(app).get(`/api/events/${ev.slug}`).expect(404); // no leak by guessed slug (SC-009)

    const queue = await request(app).get("/api/admin/moderation/queue").set(admin.h).expect(200);
    expect(queue.body.events.some((e: { id: number }) => e.id === ev.eventId)).toBe(true);
    expect(queue.body.events.some((e: { id: number }) => e.id === draft.body.id)).toBe(false);

    await request(app).post(`/api/admin/events/${ev.eventId}/approve`).set(admin.h).expect(200);
    expect(await isPublic("Liveshow Chờ Duyệt")).toBe(true);

    // approval alone is not enough — unpublishing (status → draft) hides it again
    await request(app)
      .post(`/api/organizer/events/${ev.eventId}/unpublish`)
      .set(bearer(org.token))
      .expect(200);
    expect(await isPublic("Liveshow Chờ Duyệt")).toBe(false);

    const audit = await auditRows("event_approved", ev.eventId);
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toMatchObject({ before: "pending_review", after: "approved" });
    expect(await notificationsFor("event", ev.eventId)).toHaveLength(1);
  });

  it("reject keeps it non-public with the reason, and the organizer can correct + resubmit (FR-012)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Sự Kiện Bị Từ Chối");
    const reason = "Hình ảnh không phù hợp.";

    await request(app)
      .post(`/api/admin/events/${ev.eventId}/reject`)
      .set(admin.h)
      .send({ reason })
      .expect(200);
    expect(await eventModeration(ev.eventId)).toMatchObject({
      moderation_status: "removed",
      review_note: reason,
    });
    expect(await isPublic("Sự Kiện Bị Từ Chối")).toBe(false);

    // the organizer sees the reason on their own listing (FR-012)
    const mine = await request(app).get("/api/organizer/events").set(bearer(org.token)).expect(200);
    expect(mine.body.find((e: { id: number }) => e.id === ev.eventId)).toMatchObject({
      moderation: "removed",
      reviewNote: reason,
    });

    // correct + resubmit → back to pending_review
    await request(app)
      .patch(`/api/organizer/events/${ev.eventId}`)
      .set(bearer(org.token))
      .send({ description: "Đã sửa nội dung." })
      .expect(200);
    await request(app)
      .post(`/api/organizer/events/${ev.eventId}/publish`)
      .set(bearer(org.token))
      .expect(200);
    expect((await eventModeration(ev.eventId)).moderation_status).toBe("pending_review");
    await request(app).post(`/api/admin/events/${ev.eventId}/approve`).set(admin.h).expect(200);
    expect(await isPublic("Sự Kiện Bị Từ Chối")).toBe(true);
  });

  it("reject closes an event waitlist immediately without cancelling its showtime", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Sự Kiện Có Hàng Chờ");
    const tierId = (
      await pool.query<{ id: number }>(
        `SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`,
        [ev.showtimeId],
      )
    ).rows[0].id;
    const [waiter] = await wl.fillWaitlist(ev.showtimeId, tierId, 1);

    await request(app)
      .post(`/api/admin/events/${ev.eventId}/reject`)
      .set(admin.h)
      .send({ reason: "Nội dung không phù hợp." })
      .expect(200);

    expect((await eventModeration(ev.eventId)).status).toBe("on_sale");
    expect((await eventModeration(ev.eventId)).moderation_status).toBe("removed");
    expect((await wl.getEntries(ev.showtimeId))[0].status).toBe("expired");
    const { rows } = await pool.query<{ channel: string; payload: Record<string, string> }>(
      `SELECT channel, payload FROM notifications
        WHERE user_id = $1 AND type = 'waitlist_closed'`,
      [waiter.userId],
    );
    expect(rows.map((row) => row.channel).sort()).toEqual(["email", "in_app"]);
    expect(rows.every((row) => row.payload.reason === "event_removed")).toBe(true);
  });

  it("a material edit of an approved event returns it to review and hides it (FR-013, scenario 3)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedApprovedEvent(org, admin, "Sự Kiện Sẽ Sửa");
    expect(await isPublic("Sự Kiện Sẽ Sửa")).toBe(true);

    await request(app)
      .patch(`/api/organizer/events/${ev.eventId}`)
      .set(bearer(org.token))
      .send({ title: "Tên Hoàn Toàn Khác" })
      .expect(200);

    expect((await eventModeration(ev.eventId)).moderation_status).toBe("pending_review");
    expect(await isPublic("Tên Hoàn Toàn Khác")).toBe(false);
  });

  it("refuses event moderation for a non-admin and rejects a bad target (FR-020, SC-006)", async () => {
    const attendee = await registerUser();
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Sự Kiện Không Đổi");

    for (const action of ["approve", "reject", "flag", "remove"]) {
      await request(app)
        .post(`/api/admin/events/${ev.eventId}/${action}`)
        .send({ reason: "x" })
        .expect(401);
      await request(app)
        .post(`/api/admin/events/${ev.eventId}/${action}`)
        .set(bearer(attendee.token))
        .send({ reason: "x" })
        .expect(403);
      // the owning organizer is not an admin either
      await request(app)
        .post(`/api/admin/events/${ev.eventId}/${action}`)
        .set(bearer(org.token))
        .send({ reason: "x" })
        .expect(403);
    }
    expect((await eventModeration(ev.eventId)).moderation_status).toBe("pending_review");
    expect(await countAudit()).toBe(0);

    await request(app).post("/api/admin/events/999999/approve").set(admin.h).expect(404);
    await request(app)
      .post(`/api/admin/events/${ev.eventId}/reject`)
      .set(admin.h)
      .send({ reason: "" })
      .expect(400);
    // flag requires an APPROVED source state
    await request(app)
      .post(`/api/admin/events/${ev.eventId}/flag`)
      .set(admin.h)
      .send({ reason: "x" })
      .expect(409);
  });
});

describe("T026 [US4] reported content: dismiss, flag, remove", () => {
  it("dismiss keeps the content public and records the decision (FR-014, scenario 1)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const reporter = await registerUser();
    const ev = await seedApprovedEvent(org, admin, "Sự Kiện Bị Báo Cáo Oan");
    const reportId = await seedReport({ reporterUserId: reporter.userId, targetId: ev.eventId });

    const queue = await request(app).get("/api/admin/moderation/queue").set(admin.h).expect(200);
    expect(queue.body.reports.some((r: { id: number }) => r.id === reportId)).toBe(true);

    await request(app)
      .post(`/api/admin/reports/${reportId}/dismiss`)
      .set(admin.h)
      .send({ reason: "Không vi phạm." })
      .expect(200);

    expect(await reportRow(reportId)).toMatchObject({
      status: "dismissed",
      resolution_note: "Không vi phạm.",
      resolved_by: admin.userId,
    });
    expect(await isPublic("Sự Kiện Bị Báo Cáo Oan")).toBe(true); // content untouched
    expect((await eventModeration(ev.eventId)).moderation_status).toBe("approved");
    expect(await auditRows("report_dismissed", reportId)).toHaveLength(1);

    // dismissing twice is a conflict, not a second decision
    await request(app)
      .post(`/api/admin/reports/${reportId}/dismiss`)
      .set(admin.h)
      .send({ reason: "lặp" })
      .expect(409);
    expect(await auditRows("report_dismissed", reportId)).toHaveLength(1);
  });

  it("resolve→flag hides the event from buyers but keeps it for admin and its owner (FR-015, scenario 2)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const reporter = await registerUser();
    const ev = await seedApprovedEvent(org, admin, "Sự Kiện Bị Gắn Cờ");
    const reportId = await seedReport({ reporterUserId: reporter.userId, targetId: ev.eventId });

    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(admin.h)
      .send({ decision: "flag", reason: "Cần theo dõi." })
      .expect(200);

    expect(await isPublic("Sự Kiện Bị Gắn Cờ")).toBe(false);
    await request(app).get(`/api/events/${ev.slug}`).expect(404);
    expect(await eventModeration(ev.eventId)).toMatchObject({
      moderation_status: "flagged",
      review_note: "Cần theo dõi.",
    });
    expect(await reportRow(reportId)).toMatchObject({ status: "flagged" });

    // still visible to the admin queue and to the owning organizer, with the reason (FR-015/027)
    const queue = await request(app).get("/api/admin/moderation/queue").set(admin.h).expect(200);
    expect(
      queue.body.events.some(
        (e: { id: number; moderation: string }) =>
          e.id === ev.eventId && e.moderation === "flagged",
      ),
    ).toBe(true);
    const mine = await request(app).get("/api/organizer/events").set(bearer(org.token)).expect(200);
    expect(mine.body.find((e: { id: number }) => e.id === ev.eventId)).toMatchObject({
      moderation: "flagged",
      reviewNote: "Cần theo dõi.",
    });

    expect(await auditRows("report_flag", reportId)).toHaveLength(1);
    expect(await auditRows("event_flagged", ev.eventId)).toHaveLength(1);
  });

  it("resolve→remove stops future sales and audits both the report and the event (FR-016, scenario 3 partial)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const reporter = await registerUser();
    const ev = await seedApprovedEvent(org, admin, "Sự Kiện Bị Gỡ");
    const reportId = await seedReport({
      reporterUserId: reporter.userId,
      targetId: ev.eventId,
      reason: "Nội dung lừa đảo.",
    });

    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(admin.h)
      .send({ decision: "remove", reason: "Lừa đảo." })
      .expect(200);

    expect(await isPublic("Sự Kiện Bị Gỡ")).toBe(false);
    expect((await eventModeration(ev.eventId)).moderation_status).toBe("removed");
    expect(await reportRow(reportId)).toMatchObject({
      status: "resolved",
      resolution_note: "Lừa đảo.",
    });

    // future sales stop: a buyer can no longer hold inventory for the removed event's showtime
    const buyer = await registerUser();
    const tierId = (
      await pool.query(`SELECT id FROM ticket_tiers WHERE showtime_id = $1 LIMIT 1`, [
        ev.showtimeId,
      ])
    ).rows[0].id;
    await request(app)
      .post("/api/reservations")
      .set(bearer(buyer.token))
      .send({ showtimeId: ev.showtimeId, ticketTierId: tierId, quantity: 1 })
      .expect(422)
      .expect((r) => expect(r.body.error).toBe("showtime_unavailable"));

    expect(await auditRows("report_remove", reportId)).toHaveLength(1);
    expect(await auditRows("event_removed", ev.eventId)).toHaveLength(1);
    // the record survives removal (FR-027)
    expect(
      (await pool.query(`SELECT count(*)::int AS c FROM events WHERE id = $1`, [ev.eventId]))
        .rows[0].c,
    ).toBe(1);
  });

  it("a report against already-removed content closes without applying a second removal (edge case)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const reporter = await registerUser();
    const ev = await seedApprovedEvent(org, admin, "Sự Kiện Gỡ Trước");
    await request(app)
      .post(`/api/admin/events/${ev.eventId}/remove`)
      .set(admin.h)
      .send({ reason: "Gỡ trực tiếp." })
      .expect(200);

    const reportId = await seedReport({ reporterUserId: reporter.userId, targetId: ev.eventId });
    // the target is already removed → the transition is refused and the report stays open (FR-024:
    // the report stamp rolls back with the failed target transition, so nothing is half-applied)
    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(admin.h)
      .send({ decision: "remove", reason: "Lặp." })
      .expect(409);
    expect((await reportRow(reportId)).status).toBe("open");

    // dismissal is the correct close for an already-handled target
    await request(app)
      .post(`/api/admin/reports/${reportId}/dismiss`)
      .set(admin.h)
      .send({ reason: "Đã xử lý trước đó." })
      .expect(200);
    expect((await reportRow(reportId)).status).toBe("dismissed");
    expect(await auditRows("event_removed", ev.eventId)).toHaveLength(1); // still exactly one removal
  });

  it("refuses report actions for a non-admin, changing no content or report state (FR-020, SC-006)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const attendee = await registerUser();
    const ev = await seedApprovedEvent(org, admin, "Sự Kiện An Toàn");
    const reportId = await seedReport({ reporterUserId: attendee.userId, targetId: ev.eventId });

    for (const p of [
      `/api/admin/reports/${reportId}/dismiss`,
      `/api/admin/reports/${reportId}/resolve`,
    ]) {
      await request(app).post(p).send({ decision: "remove", reason: "x" }).expect(401);
      await request(app)
        .post(p)
        .set(bearer(attendee.token))
        .send({ decision: "remove", reason: "x" })
        .expect(403);
    }
    expect((await reportRow(reportId)).status).toBe("open");
    expect(await isPublic("Sự Kiện An Toàn")).toBe(true);

    // reason/decision validation (FR-026)
    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(admin.h)
      .send({ decision: "nuke", reason: "x" })
      .expect(400);
    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(admin.h)
      .send({ decision: "remove" })
      .expect(400);
    expect((await reportRow(reportId)).status).toBe("open");
  });

  it("stores a moderation reason containing markup as literal text (FR-026, edge case)", async () => {
    const admin = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Sự Kiện Có Markup");
    const nasty = '<script>alert("xss")</script> vi phạm';

    await request(app)
      .post(`/api/admin/events/${ev.eventId}/reject`)
      .set(admin.h)
      .send({ reason: nasty })
      .expect(200);
    // stored verbatim as text, never interpreted; the client encodes on render
    expect((await eventModeration(ev.eventId)).review_note).toBe(nasty);
  });
});

describe("T027 [US4] exactly-once wallet refund on violation removal (FR-018/025)", () => {
  it("refunds future unused tickets, voids access, notifies buyers, and refuses a retry", async () => {
    const admin = await seedAdmin();
    const sale = await seedSale({ quantity: 2, price: 250_000, startsInMs: 7 * 86_400_000 });
    const before = (
      await pool.query<{ balance_amount: number }>(
        `SELECT balance_amount FROM wallets WHERE user_id = $1`,
        [sale.buyer.userId],
      )
    ).rows[0].balance_amount;

    const response = await request(app)
      .post(`/api/admin/events/${sale.eventId}/remove`)
      .set(admin.h)
      .send({ reason: "Lừa đảo." })
      .expect(200);

    expect(response.body.settlement).toEqual({ refundedTickets: 2, refundedAmount: 500_000 });
    expect(
      (await pool.query(`SELECT status FROM events WHERE id = $1`, [sale.eventId])).rows[0].status,
    ).toBe("cancelled");
    expect(
      (await pool.query(`SELECT status FROM showtimes WHERE id = $1`, [sale.showtimeId])).rows[0]
        .status,
    ).toBe("cancelled");
    expect(
      (
        await pool.query(`SELECT qr_status FROM tickets WHERE order_id = $1 ORDER BY id`, [
          sale.orderId,
        ])
      ).rows,
    ).toEqual([{ qr_status: "void" }, { qr_status: "void" }]);
    expect(
      (await pool.query(`SELECT payment_status FROM orders WHERE id = $1`, [sale.orderId])).rows[0]
        .payment_status,
    ).toBe("refunded");
    expect(
      (
        await pool.query(`SELECT balance_amount FROM wallets WHERE user_id = $1`, [
          sale.buyer.userId,
        ])
      ).rows[0].balance_amount,
    ).toBe(before + 500_000);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count, COALESCE(sum(amount), 0)::int AS total
         FROM wallet_transactions WHERE order_id = $1 AND kind = 'refund'`,
          [sale.orderId],
        )
      ).rows[0],
    ).toEqual({ count: 2, total: 500_000 });
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND event_id = $2 AND type = 'event_cancelled' AND channel = 'in_app'`,
          [sale.buyer.userId, sale.eventId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(await notificationsFor("event", sale.eventId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "event_removed",
          recipient_user_id: sale.organizer.userId,
        }),
      ]),
    );

    await request(app)
      .post("/api/admin/tickets/check-in")
      .set(admin.h)
      .send({ barcode: sale.barcodes[0] })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe("ticket_void"));

    await request(app)
      .post(`/api/admin/events/${sale.eventId}/remove`)
      .set(admin.h)
      .send({ reason: "Lặp." })
      .expect(409);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM wallet_transactions WHERE order_id = $1 AND kind = 'refund'`,
          [sale.orderId],
        )
      ).rows[0].count,
    ).toBe(2);
  });
});

describe("T028 [US5] concurrency and transaction rollback", () => {
  it("two admins racing one organizer: exactly one transition, one audit row, the loser gets 409 (invariant 1)", async () => {
    const a1 = await seedAdmin();
    const a2 = await seedAdmin();
    const org = await seedPendingOrganizer();

    const [approve, reject] = await Promise.all([
      request(app).post(`/api/admin/organizers/${org.organizerId}/approve`).set(a1.h),
      request(app)
        .post(`/api/admin/organizers/${org.organizerId}/reject`)
        .set(a2.h)
        .send({ reason: "Không hợp lệ." }),
    ]);

    const codes = [approve.status, reject.status].sort();
    expect(codes).toEqual([200, 409]); // FOR UPDATE serializes them — one winner
    const final = (await organizerStatus(org.organizerId)).status;
    expect(["approved", "rejected"]).toContain(final);
    // exactly one audit row total, matching the winner
    expect(await countAudit()).toBe(1);
    expect(await auditRows(`organizer_${final}`, org.organizerId)).toHaveLength(1);
  });

  it("two admins racing one event approval: one 200, one 409, one audit row", async () => {
    const a1 = await seedAdmin();
    const a2 = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Sự Kiện Tranh Chấp");
    const auditBefore = await countAudit();

    const results = await Promise.all([
      request(app).post(`/api/admin/events/${ev.eventId}/approve`).set(a1.h),
      request(app).post(`/api/admin/events/${ev.eventId}/approve`).set(a2.h),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect((await eventModeration(ev.eventId)).moderation_status).toBe("approved");
    expect(await countAudit()).toBe(auditBefore + 1);
  });

  it("two admins racing one report resolution: one decision applies, the other conflicts (invariant 1)", async () => {
    const a1 = await seedAdmin();
    const a2 = await seedAdmin();
    const org = await seedApprovedOrganizer();
    const reporter = await registerUser();
    const ev = await seedApprovedEvent(org, a1, "Sự Kiện Báo Cáo Tranh Chấp");
    const reportId = await seedReport({ reporterUserId: reporter.userId, targetId: ev.eventId });

    const results = await Promise.all([
      request(app)
        .post(`/api/admin/reports/${reportId}/resolve`)
        .set(a1.h)
        .send({ decision: "flag", reason: "Theo dõi." }),
      request(app)
        .post(`/api/admin/reports/${reportId}/dismiss`)
        .set(a2.h)
        .send({ reason: "Bỏ qua." }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(["flagged", "dismissed"]).toContain((await reportRow(reportId)).status);
  });

  it("a failing audit write rolls back the state change — no partial moderation (FR-024, invariant 5)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();

    // Force the in-transaction audit insert to fail the way a real constraint violation would:
    // audit_logs.outcome is NOT NULL, so a CHECK that rejects every row makes insertAudit throw
    // AFTER the organizer UPDATE has already run inside the same transaction.
    await pool.query(
      `ALTER TABLE audit_logs ADD CONSTRAINT audit_fail_probe CHECK (action <> 'organizer_approved')`,
    );
    try {
      await request(app)
        .post(`/api/admin/organizers/${org.organizerId}/approve`)
        .set(admin.h)
        .expect(500);
    } finally {
      await pool.query(`ALTER TABLE audit_logs DROP CONSTRAINT audit_fail_probe`);
    }

    // neither the state change nor the audit row committed
    expect((await organizerStatus(org.organizerId)).status).toBe("pending");
    expect(await countAudit()).toBe(0);
    expect(await notificationsFor("organizer", org.organizerId)).toHaveLength(0);
    // and capability was never granted
    await request(app).get("/api/organizers/dashboard").set(bearer(org.token)).expect(403);

    // the same command succeeds once the failure is removed → no poisoned state
    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/approve`)
      .set(admin.h)
      .expect(200);
    expect((await organizerStatus(org.organizerId)).status).toBe("approved");
  });

  it("a cancelled action (never submitted) writes no audit row (US5 scenario 2)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();
    // reading the queue is not a decision
    await request(app).get("/api/admin/organizers").set(admin.h).expect(200);
    await request(app).get("/api/admin/moderation/queue").set(admin.h).expect(200);
    expect(await countAudit()).toBe(0);
    expect((await organizerStatus(org.organizerId)).status).toBe("pending");
  });
});

describe("T029 [US5] audit log is append-only at the database level", () => {
  it("PostgreSQL rejects UPDATE and DELETE on audit_logs, leaving rows unchanged (FR-023, SEC-09)", async () => {
    const admin = await seedAdmin();
    const org = await seedPendingOrganizer();
    await request(app)
      .post(`/api/admin/organizers/${org.organizerId}/approve`)
      .set(admin.h)
      .expect(200);

    const before = (
      await pool.query(`SELECT id, action, actor_user_id, detail FROM audit_logs ORDER BY id`)
    ).rows;
    expect(before).toHaveLength(1);
    const row = before[0];

    await expect(
      pool.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [row.id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_logs WHERE id = $1`, [row.id])).rejects.toThrow(
      /append-only/,
    );
    // even a blanket mutation is refused
    await expect(pool.query(`UPDATE audit_logs SET detail = '{}'::jsonb`)).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);

    const after = (
      await pool.query(`SELECT id, action, actor_user_id, detail FROM audit_logs ORDER BY id`)
    ).rows;
    expect(after).toEqual(before); // byte-for-byte unchanged
  });

  it("exposes audit history read-only over the API, admin-only, with no mutating verb (FR-023, US5)", async () => {
    const admin = await seedAdmin();
    const attendee = await registerUser();
    const org = await seedApprovedOrganizer();
    const ev = await seedPendingEvent(org, "Sự Kiện Ghi Log");
    await request(app)
      .post(`/api/admin/events/${ev.eventId}/reject`)
      .set(admin.h)
      .send({ reason: "Không đạt." })
      .expect(200);

    const logs = await request(app).get("/api/admin/audit-logs").set(admin.h).expect(200);
    const entry = logs.body.find(
      (l: { action: string; targetId: number }) =>
        l.action === "event_removed" && l.targetId === ev.eventId,
    );
    // actor, action, target, timestamp, outcome, before/after + reason (FR-021, SC-005)
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      actorUserId: admin.userId,
      targetType: "event",
      outcome: "applied",
    });
    expect(entry.detail).toMatchObject({
      before: "pending_review",
      after: "removed",
      reason: "Không đạt.",
    });
    expect(typeof entry.createdAt).toBe("string");

    await request(app).get("/api/admin/audit-logs").set(bearer(attendee.token)).expect(403);
    await request(app).get("/api/admin/audit-logs").expect(401);

    // no write route exists on the audit resource
    for (const verb of ["post", "patch", "delete"] as const) {
      const res = await request(app)[verb]("/api/admin/audit-logs").set(admin.h).send({});
      expect(res.status).toBe(404);
    }
    expect(await countAudit()).toBe(1);
  });
});
