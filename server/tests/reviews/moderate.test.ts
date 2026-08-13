import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeAdmin, registerUser } from '../helpers/authFixture.js';
import { giveTicket, seedPastEvent } from '../helpers/reviewSeed.js';

/** An event with one review on it, plus the account that wrote it. */
async function eventWithReview() {
  const event = await seedPastEvent();
  const author = await registerUser();
  await giveTicket(author.userId, event);
  const created = await request(app)
    .post(`/api/events/${event.eventId}/reviews`)
    .set(bearer(author.token))
    .send({ rating: 1, body: 'Nội dung bị báo cáo.' })
    .expect(200);
  return { event, author, reviewId: created.body.id as number };
}

describe('reporting a review (UC-39)', () => {
  it('records the report in the queue that already exists (FR-014)', async () => {
    const { reviewId } = await eventWithReview();
    const reader = await registerUser();

    await request(app)
      .post(`/api/reviews/${reviewId}/report`)
      .set(bearer(reader.token))
      .send({ reason: 'Nội dung xúc phạm' })
      .expect(201);

    // The same table and the same moderation states admins already use for reported events —
    // `target_type` has permitted 'review' since feature 004 built the queue.
    const { rows } = await pool.query<{ target_type: string; status: string; reason: string }>(
      'SELECT target_type, status, reason FROM content_reports WHERE target_id = $1',
      [reviewId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target_type).toBe('review');
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.reason).toBe('Nội dung xúc phạm');
  });

  it('answers "already reported" on a repeat, without a duplicate', async () => {
    const { reviewId } = await eventWithReview();
    const reader = await registerUser();
    const report = () =>
      request(app).post(`/api/reviews/${reviewId}/report`).set(bearer(reader.token)).send({ reason: 'Spam' });

    await report().expect(201);
    // Not an error: they did the right thing twice, and telling them off for it teaches them not to
    // report next time.
    const second = await report().expect(200);
    expect(second.body.alreadyReported).toBe(true);

    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM content_reports WHERE target_id = $1',
      [reviewId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('requires a reason and a session', async () => {
    const { reviewId } = await eventWithReview();
    const reader = await registerUser();

    await request(app).post(`/api/reviews/${reviewId}/report`).send({ reason: 'x' }).expect(401);
    await request(app).post(`/api/reviews/${reviewId}/report`).set(bearer(reader.token)).send({}).expect(400);
    await request(app)
      .post(`/api/reviews/${reviewId}/report`)
      .set(bearer(reader.token))
      .send({ reason: '   ' })
      .expect(400);
  });

  it('refuses to report a review that is not there', async () => {
    const reader = await registerUser();
    await request(app)
      .post('/api/reviews/999999/report')
      .set(bearer(reader.token))
      .send({ reason: 'Spam' })
      .expect(404);
  });
});

/**
 * The reader's report and the admin's decision, joined up.
 *
 * The queue has accepted reports against reviews since feature 004 and resolving one used to close
 * the report while leaving the comment on the page — the admin was told they had acted when they
 * had not, and the reader who reported it saw nothing change.
 */
describe('acting on a reported review from the queue', () => {
  async function reportedReview() {
    const seeded = await eventWithReview();
    const reader = await registerUser();
    await request(app)
      .post(`/api/reviews/${seeded.reviewId}/report`)
      .set(bearer(reader.token))
      .send({ reason: 'Nội dung xúc phạm' })
      .expect(201);
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM content_reports WHERE target_type = 'review' AND target_id = $1`,
      [seeded.reviewId],
    );
    return { ...seeded, reportId: rows[0]!.id };
  }

  it('shows the admin what was written, not just an id', async () => {
    const { reviewId } = await reportedReview();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    const queue = await request(app)
      .get('/api/admin/moderation/queue')
      .set(bearer(admin.token))
      .expect(200);

    const row = queue.body.reports.find(
      (r: { targetType: string; targetId: number }) =>
        r.targetType === 'review' && r.targetId === reviewId,
    );
    // Deciding whether a comment comes down means reading the comment.
    expect(row.targetBody).toBe('Nội dung bị báo cáo.');
    expect(row.targetAuthor).toBeTruthy();
    expect(row.reason).toBe('Nội dung xúc phạm');
  });

  it('takes the comment down when the report is upheld, and audits it', async () => {
    const { event, reviewId, reportId } = await reportedReview();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(bearer(admin.token))
      .send({ decision: 'remove', reason: 'Xúc phạm người khác' })
      .expect(200);

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.reviews).toHaveLength(0);
    expect(page.body.summary.reviewCount).toBe(0);

    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM event_reviews WHERE id = $1',
      [reviewId],
    );
    // Hidden, not deleted: the report and the audit row keep a subject an admin can still read.
    expect(rows[0]!.status).toBe('removed');

    const audit = await pool.query(
      `SELECT 1 FROM audit_logs WHERE action = 'review_removed' AND target_id = $1`,
      [reviewId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('leaves the comment up when the report is dismissed', async () => {
    const { event, reportId } = await reportedReview();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    await request(app)
      .post(`/api/admin/reports/${reportId}/dismiss`)
      .set(bearer(admin.token))
      .send({ reason: 'Không vi phạm' })
      .expect(200);

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.reviews).toHaveLength(1);
  });

  it('refuses to "flag" a comment — it stays or it goes', async () => {
    const { reportId } = await reportedReview();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set(bearer(admin.token))
      .send({ decision: 'flag', reason: 'Chưa chắc' })
      .expect(400);
  });
});

describe('removing a review as an admin (FR-015)', () => {
  it('hides it, drops it from the aggregate, and records who did it', async () => {
    const { event, reviewId } = await eventWithReview();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    await request(app).delete(`/api/admin/reviews/${reviewId}`).set(bearer(admin.token)).expect(204);

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.reviews).toHaveLength(0);
    // A hidden review must stop counting, not merely stop showing — otherwise a removed one-star
    // review keeps dragging the average down invisibly.
    expect(page.body.summary.reviewCount).toBe(0);
    expect(page.body.summary.rating).toBeNull();

    const audit = await pool.query<{ actor_user_id: number; target_id: number }>(
      `SELECT actor_user_id, target_id FROM audit_logs
        WHERE action = 'review_removed' AND target_type = 'review'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_user_id).toBe(admin.userId);
    expect(Number(audit.rows[0]!.target_id)).toBe(reviewId);
  });

  it('keeps the row, so the report and the audit entry retain a subject', async () => {
    const { reviewId } = await eventWithReview();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    await request(app).delete(`/api/admin/reviews/${reviewId}`).set(bearer(admin.token)).expect(204);

    const { rows } = await pool.query<{ status: string; body: string }>(
      'SELECT status, body FROM event_reviews WHERE id = $1',
      [reviewId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('removed');
    expect(rows[0]!.body).toBe('Nội dung bị báo cáo.');
  });

  it('refuses a caller who is not an admin', async () => {
    const { reviewId } = await eventWithReview();
    const ordinary = await registerUser();

    await request(app).delete(`/api/admin/reviews/${reviewId}`).set(bearer(ordinary.token)).expect(403);
    await request(app).delete(`/api/admin/reviews/${reviewId}`).expect(401);

    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM event_reviews WHERE id = $1',
      [reviewId],
    );
    expect(rows[0]!.status).toBe('visible');
  });
});
