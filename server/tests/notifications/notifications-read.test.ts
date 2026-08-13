import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import * as seed from '../helpers/catalogSeed.js';
import * as wl from '../helpers/waitlistSeed.js';

/** One in-app message, written straight to the outbox — delivery is not what these cases are about. */
async function seedNotification(
  userId: number,
  over: { eventId?: number | null; type?: string } = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO notifications (user_id, event_id, type, channel, dedupe_key, title, body)
     VALUES ($1, $2, $3, 'in_app', $4, 'Đã có vé', 'Vé vừa có lại.') RETURNING id`,
    [
      userId,
      over.eventId ?? null,
      over.type ?? 'waitlist_open',
      `test:${Date.now()}:${Math.random()}`,
    ],
  );
  return rows[0].id;
}

describe('reading in-app notifications (US2, FR-012)', () => {
  it('lists the caller’s messages newest first, with the event they lead to', async () => {
    const user = await registerUser();
    const event = await seed.seedVisibleGaEvent();
    await seedNotification(user.userId, { eventId: event.eventId });
    const newest = await seedNotification(user.userId, { eventId: event.eventId });

    const res = await request(app).get('/api/notifications').set(bearer(user.token)).expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe(newest);
    expect(res.body[0].eventSlug).toBe(event.slug);
    expect(res.body[0].readAt).toBeNull();
  });

  it('leaves the slug null when the message names no event', async () => {
    const user = await registerUser();
    await seedNotification(user.userId, { eventId: null, type: 'announcement' });

    const res = await request(app).get('/api/notifications').set(bearer(user.token)).expect(200);

    expect(res.body[0].eventSlug).toBeNull();
  });

  it('never shows one account another account’s messages', async () => {
    const mine = await registerUser();
    const theirs = await registerUser();
    await seedNotification(theirs.userId);

    const res = await request(app).get('/api/notifications').set(bearer(mine.token)).expect(200);

    expect(res.body).toHaveLength(0);
  });

  it('marks one message read, and says so only once', async () => {
    const user = await registerUser();
    const id = await seedNotification(user.userId);

    await request(app).post(`/api/notifications/${id}/read`).set(bearer(user.token)).expect(204);
    const first = (await pool.query(`SELECT read_at FROM notifications WHERE id = $1`, [id])).rows[0]
      .read_at as Date;

    // Idempotent: opening a message twice must not move the timestamp.
    await request(app).post(`/api/notifications/${id}/read`).set(bearer(user.token)).expect(204);
    const second = (await pool.query(`SELECT read_at FROM notifications WHERE id = $1`, [id]))
      .rows[0].read_at as Date;

    expect(second.toISOString()).toBe(first.toISOString());
  });

  it('refuses to mark somebody else’s message and leaves it unread', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const id = await seedNotification(owner.userId);

    const res = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set(bearer(stranger.token));

    expect(res.status).toBe(404);
    expect(
      (await pool.query(`SELECT read_at FROM notifications WHERE id = $1`, [id])).rows[0].read_at,
    ).toBeNull();
  });

  it('marks everything unread as read and reports how many changed', async () => {
    const user = await registerUser();
    const already = await seedNotification(user.userId);
    await request(app).post(`/api/notifications/${already}/read`).set(bearer(user.token)).expect(204);
    await seedNotification(user.userId);
    await seedNotification(user.userId);

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set(bearer(user.token))
      .expect(200);

    expect(res.body.updated).toBe(2);
    const rows = await wl.getNotifications(user.userId);
    expect(rows.every((row) => row.read_at !== null)).toBe(true);
  });

  it('refuses an anonymous caller on every one of them', async () => {
    await request(app).get('/api/notifications').expect(401);
    await request(app).post('/api/notifications/1/read').expect(401);
    await request(app).post('/api/notifications/read-all').expect(401);
  });
});
