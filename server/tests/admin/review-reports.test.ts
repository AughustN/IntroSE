import request from "supertest";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { app } from "../helpers/app.js";
import { bearer, registerUser } from "../helpers/authFixture.js";
import { giveTicket, seedPastEvent } from "../helpers/reviewSeed.js";
import { adminSession } from "../helpers/salesSeed.js";

/*
 * Reported comments in the console (UC-39 → UC-34).
 *
 * The reports have existed since the reviews feature shipped and the console could only *dismiss*
 * one: upholding a report meant hiding the comment somewhere else and leaving the report open for
 * ever. These cases cover the screen that closes that loop — and the part the queue endpoint never
 * had, which is being able to see what was already decided.
 */

/** A visible comment on a past event, plus a reader who has flagged it. */
async function seedReportedComment(eventTitle: string): Promise<{
  reportId: number;
  reviewId: number;
  eventId: number;
  reporterEmail: string;
}> {
  const event = await seedPastEvent({ title: eventTitle });
  const author = await registerUser();
  await giveTicket(author.userId, event);
  const written = await request(app)
    .post(`/api/events/${event.eventId}/reviews`)
    .set(bearer(author.token))
    .send({ rating: 1, body: "Ban tổ chức lừa đảo, ai cũng nên tránh" })
    .expect(200);

  const reporter = await registerUser();
  await giveTicket(reporter.userId, event);
  await request(app)
    .post(`/api/reviews/${written.body.id}/report`)
    .set(bearer(reporter.token))
    .send({ reason: "Vu khống ban tổ chức" })
    .expect(201);

  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM content_reports WHERE target_type = 'review' AND target_id = $1`,
    [written.body.id],
  );
  return {
    reportId: rows[0].id,
    reviewId: written.body.id,
    eventId: event.eventId,
    reporterEmail: reporter.email,
  };
}

const list = (token: string, query = "") =>
  request(app).get(`/api/admin/review-reports${query}`).set(bearer(token));

describe("the reported-comment queue", () => {
  it("carries the comment, its event and who reported it — enough to judge without leaving", async () => {
    const seeded = await seedReportedComment("Đêm nhạc Trịnh");
    const admin = await adminSession();

    const res = await list(admin.token).expect(200);

    const row = res.body.rows.find((item: { id: number }) => item.id === seeded.reportId);
    expect(row.reviewBody).toContain("lừa đảo");
    expect(row.eventTitle).toBe("Đêm nhạc Trịnh");
    expect(row.reporterEmail).toBe(seeded.reporterEmail);
    expect(row.status).toBe("open");
    expect(row.reviewStatus).toBe("visible");
    expect(res.body.openCount).toBeGreaterThanOrEqual(1);
  });

  it("searches by the event the comment sits under, not by the comment's words", async () => {
    // A moderator arrives here from a complaint about a show and remembers the show.
    await seedReportedComment("Đêm nhạc Trịnh");
    const other = await seedReportedComment("Kịch Sài Gòn");
    const admin = await adminSession();

    const res = await list(admin.token, "?q=Kịch").expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].id).toBe(other.reportId);
  });

  it("separates what is waiting from what is done", async () => {
    const waiting = await seedReportedComment("Đêm nhạc Trịnh");
    const decided = await seedReportedComment("Kịch Sài Gòn");
    const admin = await adminSession();
    await request(app)
      .post(`/api/admin/reports/${decided.reportId}/dismiss`)
      .set(bearer(admin.token))
      .send({ reason: "Bình luận không vi phạm" })
      .expect(200);

    const open = await list(admin.token, "?status=open").expect(200);
    const done = await list(admin.token, "?status=done").expect(200);

    expect(open.body.rows.map((row: { id: number }) => row.id)).toEqual([waiting.reportId]);
    expect(done.body.rows.map((row: { id: number }) => row.id)).toEqual([decided.reportId]);
    // The count beside a filtered list describes that list, not the whole table.
    expect(done.body.openCount).toBe(0);
  });

  it("hides the comment when the report is upheld, and says so afterwards", async () => {
    const seeded = await seedReportedComment("Đêm nhạc Trịnh");
    const admin = await adminSession();

    await request(app)
      .post(`/api/admin/reports/${seeded.reportId}/resolve`)
      .set(bearer(admin.token))
      .send({ decision: "remove", reason: "Vu khống, không có bằng chứng" })
      .expect(200);

    const done = await list(admin.token, "?status=done").expect(200);
    const row = done.body.rows[0];
    expect(row.reviewStatus).toBe("removed");
    expect(row.resolutionNote).toBe("Vu khống, không có bằng chứng");
    expect(row.resolvedAt).toBeTruthy();
    // Hidden, not deleted: the report and the audit entry still have something to point at.
    const { rows } = await pool.query<{ body: string }>(
      `SELECT body FROM event_reviews WHERE id = $1`,
      [seeded.reviewId],
    );
    expect(rows[0].body).toContain("lừa đảo");
  });

  it("leaves the comment standing when the report is dismissed", async () => {
    const seeded = await seedReportedComment("Đêm nhạc Trịnh");
    const admin = await adminSession();

    await request(app)
      .post(`/api/admin/reports/${seeded.reportId}/dismiss`)
      .set(bearer(admin.token))
      .send({ reason: "Chỉ là chê, không vi phạm" })
      .expect(200);

    const done = await list(admin.token, "?status=done").expect(200);
    expect(done.body.rows[0].reviewStatus).toBe("visible");
  });

  it("never lists a report about an event among the comment reports", async () => {
    const seeded = await seedReportedComment("Đêm nhạc Trịnh");
    const reporter = await registerUser();
    await pool.query(
      `INSERT INTO content_reports (reporter_user_id, target_type, target_id, reason, status)
       VALUES ($1, 'event', $2, 'Sự kiện này là lừa đảo', 'open')`,
      [reporter.userId, seeded.eventId],
    );
    const admin = await adminSession();

    const res = await list(admin.token).expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].reviewId).toBe(seeded.reviewId);
  });

  it("refuses an ordinary account", async () => {
    const user = await registerUser();
    await request(app).get("/api/admin/review-reports").set(bearer(user.token)).expect(403);
  });
});
