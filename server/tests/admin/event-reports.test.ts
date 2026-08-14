import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { seedVisibleGaEvent } from "../helpers/catalogSeed.js";
import { adminSession } from "../helpers/salesSeed.js";

/*
 * Reporting an event, and the queue that receives it (UC-39 → UC-34).
 *
 * `content_reports` has accepted `target_type = 'event'` since the moderation queue was built, and
 * `admin.service.ts` has always known how to resolve one — but no route anywhere let a reader open
 * such a report, so that branch was unreachable and that half of the queue permanently empty.
 */

const report = (token: string, eventId: number, reason: string) =>
  request(app).post(`/api/events/${eventId}/report`).set(bearer(token)).send({ reason });

const list = (token: string, query = "") =>
  request(app).get(`/api/admin/content-reports${query}`).set(bearer(token));

describe("a reader reporting an event", () => {
  it("files the report and answers 201", async () => {
    const event = await seedVisibleGaEvent({ title: "Đêm nhạc Trịnh" });
    const reader = await registerUser();

    const res = await report(reader.token, event.eventId, "Nội dung sai sự thật").expect(201);

    expect(res.body.alreadyReported).toBe(false);
    const { rows } = await pool.query(
      `SELECT status, reason FROM content_reports WHERE target_type = 'event' AND target_id = $1`,
      [event.eventId],
    );
    expect(rows[0].status).toBe("open");
    expect(rows[0].reason).toBe("Nội dung sai sự thật");
  });

  it("treats a repeat as the same report, not a second one", async () => {
    // Doing the right thing twice is not an error, and a queue with duplicates is a queue an admin
    // reads twice.
    const event = await seedVisibleGaEvent();
    const reader = await registerUser();
    await report(reader.token, event.eventId, "Lừa đảo").expect(201);

    const again = await report(reader.token, event.eventId, "Lừa đảo lần nữa").expect(200);

    expect(again.body.alreadyReported).toBe(true);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM content_reports WHERE target_id = $1`,
      [event.eventId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("refuses a report about an event that has already been taken down", async () => {
    const event = await seedVisibleGaEvent();
    await pool.query(`UPDATE events SET moderation_status = 'removed' WHERE id = $1`, [
      event.eventId,
    ]);
    const reader = await registerUser();

    const res = await report(reader.token, event.eventId, "Lừa đảo");

    expect(res.status).toBe(404);
  });

  it("refuses an anonymous reporter — a report is attributed", async () => {
    const event = await seedVisibleGaEvent();
    await request(app)
      .post(`/api/events/${event.eventId}/report`)
      .send({ reason: "Lừa đảo" })
      .expect(401);
  });
});

describe("the reported-event queue", () => {
  it("lists the report with its event and how many others are waiting on it", async () => {
    const event = await seedVisibleGaEvent({ title: "Đêm nhạc Trịnh" });
    const first = await registerUser();
    const second = await registerUser();
    await report(first.token, event.eventId, "Sai sự thật").expect(201);
    await report(second.token, event.eventId, "Ảnh vi phạm bản quyền").expect(201);
    const admin = await adminSession();

    const res = await list(admin.token).expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.rows[0].eventTitle).toBe("Đêm nhạc Trịnh");
    // Several people flagging one event is the signal the list has to carry.
    expect(res.body.rows[0].openCountForTarget).toBe(2);
  });

  it("searches by event title and filters by decision", async () => {
    const kept = await seedVisibleGaEvent({ title: "Đêm nhạc Trịnh" });
    const other = await seedVisibleGaEvent({ title: "Kịch Sài Gòn" });
    const reader = await registerUser();
    await report(reader.token, kept.eventId, "Sai sự thật").expect(201);
    const second = await registerUser();
    await report(second.token, other.eventId, "Ảnh phản cảm").expect(201);
    const admin = await adminSession();

    const searched = await list(admin.token, "?q=Kịch").expect(200);
    expect(searched.body.total).toBe(1);
    expect(searched.body.rows[0].eventId).toBe(other.eventId);

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM content_reports WHERE target_id = $1`,
      [other.eventId],
    );
    await request(app)
      .post(`/api/admin/reports/${rows[0].id}/resolve`)
      .set(bearer(admin.token))
      .send({ decision: "flag", reason: "Cần xem lại ảnh bìa" })
      .expect(200);

    const flagged = await list(admin.token, "?status=flagged").expect(200);
    expect(flagged.body.rows.map((row: { eventId: number }) => row.eventId)).toEqual([
      other.eventId,
    ]);
    const stillOpen = await list(admin.token, "?status=open").expect(200);
    expect(stillOpen.body.rows.map((row: { eventId: number }) => row.eventId)).toEqual([
      kept.eventId,
    ]);
  });

  it("serves one report with the whole event behind it", async () => {
    const event = await seedVisibleGaEvent({ title: "Đêm nhạc Trịnh" });
    const reader = await registerUser();
    const other = await registerUser();
    await report(reader.token, event.eventId, "Sai sự thật").expect(201);
    await report(other.token, event.eventId, "Giá vé lừa đảo").expect(201);
    const admin = await adminSession();
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM content_reports WHERE target_id = $1 ORDER BY id`,
      [event.eventId],
    );

    const res = await request(app)
      .get(`/api/admin/content-reports/${rows[0].id}`)
      .set(bearer(admin.token))
      .expect(200);

    expect(res.body.target.kind).toBe("event");
    expect(res.body.target.title).toBe("Đêm nhạc Trịnh");
    expect(res.body.target.showtimes.length).toBeGreaterThan(0);
    expect(res.body.target.priceFrom).toBeGreaterThan(0);
    // The other complaint about the same event travels with it: one is a person, two is a pattern.
    expect(res.body.otherReports).toHaveLength(1);
    expect(res.body.otherReports[0].reason).toBe("Giá vé lừa đảo");
  });

  it("still serves a report whose event has been flagged out of the catalogue", async () => {
    // The catalogue reader composes the public visibility predicate, so an event under moderation
    // comes back empty from it — which is precisely the event an admin has come to look at.
    const event = await seedVisibleGaEvent();
    const reader = await registerUser();
    await report(reader.token, event.eventId, "Sai sự thật").expect(201);
    await pool.query(`UPDATE events SET moderation_status = 'flagged' WHERE id = $1`, [
      event.eventId,
    ]);
    const admin = await adminSession();
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM content_reports WHERE target_id = $1`,
      [event.eventId],
    );

    const res = await request(app)
      .get(`/api/admin/content-reports/${rows[0].id}`)
      .set(bearer(admin.token))
      .expect(200);

    expect(res.body.target.moderationStatus).toBe("flagged");
  });

  it("takes the event down when the report is upheld", async () => {
    const event = await seedVisibleGaEvent();
    const reader = await registerUser();
    await report(reader.token, event.eventId, "Lừa đảo").expect(201);
    const admin = await adminSession();
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM content_reports WHERE target_id = $1`,
      [event.eventId],
    );

    await request(app)
      .post(`/api/admin/reports/${rows[0].id}/resolve`)
      .set(bearer(admin.token))
      .send({ decision: "remove", reason: "Bán vé cho sự kiện không có thật" })
      .expect(200);

    const { rows: after } = await pool.query<{ moderation_status: string }>(
      `SELECT moderation_status FROM events WHERE id = $1`,
      [event.eventId],
    );
    expect(after[0].moderation_status).toBe("removed");
  });

  it("refuses an ordinary account", async () => {
    const user = await registerUser();
    await request(app).get("/api/admin/content-reports").set(bearer(user.token)).expect(403);
  });
});
