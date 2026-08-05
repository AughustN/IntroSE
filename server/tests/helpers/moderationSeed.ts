import request from 'supertest';
import { pool } from '../../src/db/pool.js';
import { app } from './app.js';
import { bearer, makeAdmin, registerUser } from './authFixture.js';

// PostgreSQL fixtures for the admin moderation suite (T022). Domain rows go through the real API
// where one exists (so the tests exercise the same transitions a human would), and direct SQL only
// for state a route deliberately does not expose (seeding a `pending` organizer, a report row).

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

/** A signed-in admin. */
export async function seedAdmin(): Promise<{ token: string; userId: number; h: { Authorization: string } }> {
  const a = await registerUser();
  await makeAdmin(a.userId);
  return { ...a, h: bearer(a.token) };
}

/** A user with a `pending` organizer application, submitted through the real apply route. */
export async function seedPendingOrganizer(): Promise<{ token: string; userId: number; organizerId: number }> {
  const u = await registerUser();
  await request(app)
    .post('/api/organizers/apply')
    .set(bearer(u.token))
    .send({ displayName: 'Nhà tổ chức chờ duyệt', description: 'Đơn đăng ký đang chờ xét.' })
    .expect(201);
  const { rows } = await pool.query(`SELECT id FROM organizers WHERE user_id = $1`, [u.userId]);
  return { token: u.token, userId: u.userId, organizerId: rows[0].id };
}

/** An `approved` organizer (approved directly — approval itself is what the tests drive). */
export async function seedApprovedOrganizer(): Promise<{ token: string; userId: number; organizerId: number }> {
  const o = await seedPendingOrganizer();
  await pool.query(`UPDATE organizers SET status = 'approved', approved_at = now() WHERE id = $1`, [o.organizerId]);
  return o;
}

/**
 * An organizer-owned event published into `pending_review` via the organizer API, with one upcoming
 * showtime and tier. `status` is `on_sale`, so admin approval alone decides public visibility.
 */
export async function seedPendingEvent(
  organizer: { token: string },
  title = 'Sự kiện chờ duyệt',
): Promise<{ eventId: number; slug: string; showtimeId: number }> {
  const h = bearer(organizer.token);
  const ev = await request(app)
    .post('/api/organizer/events')
    .set(h)
    .send({ title, categoryCode: 'music', description: 'Mô tả sự kiện.', eventType: 'general_admission' })
    .expect(201);
  const venue = await request(app).post('/api/organizer/venues').set(h).send({ name: 'Nhà hát Lớn', city: 'Hà Nội', rawAddress: 'Số 1' }).expect(201);
  const st = await request(app)
    .post(`/api/organizer/events/${ev.body.id}/showtimes`)
    .set(h)
    .send({ venueId: venue.body.id, startsAt: soon(), tiers: [{ label: 'Thường', price: 100_000 }] })
    .expect(201);
  await request(app).post(`/api/organizer/events/${ev.body.id}/publish`).set(h).expect(200);
  return { eventId: ev.body.id, slug: ev.body.slug, showtimeId: st.body.id };
}

/** A `pending_review` event that an admin has already approved → publicly visible. */
export async function seedApprovedEvent(
  organizer: { token: string },
  admin: { h: { Authorization: string } },
  title = 'Sự kiện đã duyệt',
): Promise<{ eventId: number; slug: string; showtimeId: number }> {
  const ev = await seedPendingEvent(organizer, title);
  await request(app).post(`/api/admin/events/${ev.eventId}/approve`).set(admin.h).expect(200);
  return ev;
}

/** An open report against a target. UC-39 owns the reporting route, so this is a direct insert. */
export async function seedReport(opts: {
  reporterUserId: number;
  targetType?: 'event' | 'review';
  targetId: number;
  reason?: string;
}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO content_reports (reporter_user_id, target_type, target_id, reason)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.reporterUserId, opts.targetType ?? 'event', opts.targetId, opts.reason ?? 'Nội dung vi phạm quy định.'],
  );
  return rows[0].id;
}

// ---- assertions helpers shared by the suite ----

export const publicTitles = async (): Promise<string[]> =>
  (await request(app).get('/api/events').expect(200)).body.events.map((e: { title: string }) => e.title);

export const isPublic = async (title: string): Promise<boolean> => (await publicTitles()).includes(title);

export async function auditRows(action: string, targetId?: number) {
  const { rows } = await pool.query(
    `SELECT * FROM audit_logs WHERE action = $1 AND ($2::bigint IS NULL OR target_id = $2) ORDER BY id`,
    [action, targetId ?? null],
  );
  return rows;
}

export const organizerStatus = async (organizerId: number): Promise<{ status: string; review_note: string | null }> =>
  (await pool.query(`SELECT status, review_note FROM organizers WHERE id = $1`, [organizerId])).rows[0];

export const eventModeration = async (eventId: number): Promise<{ moderation_status: string; review_note: string | null; status: string }> =>
  (await pool.query(`SELECT status, moderation_status, review_note FROM events WHERE id = $1`, [eventId])).rows[0];

export const reportRow = async (reportId: number): Promise<{ status: string; resolution_note: string | null; resolved_by: number | null }> =>
  (await pool.query(`SELECT status, resolution_note, resolved_by FROM content_reports WHERE id = $1`, [reportId])).rows[0];

export const notificationsFor = async (targetType: string, targetId: number) =>
  (await pool.query(`SELECT recipient_user_id, kind, payload, status FROM moderation_notifications WHERE target_type = $1 AND target_id = $2 ORDER BY id`, [targetType, targetId])).rows;

export const countAudit = async (): Promise<number> =>
  (await pool.query(`SELECT count(*)::int AS c FROM audit_logs`)).rows[0].c;
