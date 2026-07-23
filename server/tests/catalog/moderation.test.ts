import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeAdmin, makeApprovedOrganizer, registerUser, suspendOrganizer } from '../helpers/authFixture.js';

const soon = () => new Date(Date.now() + 86_400_000).toISOString();
const has = (list: { events: { title: string }[] }, title: string) => list.events.some((e) => e.title === title);

/** An organizer-published, pending-review event. */
async function publishedPending(title: string): Promise<{ eventId: number; orgUserId: number }> {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  const h = bearer(o.token);
  const ev = await request(app).post('/api/organizer/events').set(h).send({ title, categoryCode: 'music', description: 'd', eventType: 'general_admission' }).expect(201);
  const venue = await request(app).post('/api/organizer/venues').set(h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201);
  await request(app).post(`/api/organizer/events/${ev.body.id}/showtimes`).set(h).send({ venueId: venue.body.id, startsAt: soon(), tiers: [{ label: 'T', price: 100000 }] }).expect(201);
  await request(app).post(`/api/organizer/events/${ev.body.id}/publish`).set(h).expect(200);
  return { eventId: ev.body.id, orgUserId: o.userId };
}

describe('admin moderation (US6, pre-publish gate)', () => {
  it('refuses the review queue for a non-admin (403, FR-027)', async () => {
    const u = await registerUser();
    await request(app).get('/api/admin/moderation').set(bearer(u.token)).expect(403);
  });

  it('approve makes the event public and writes an audit record (FR-025/029, SC-006/008)', async () => {
    const admin = await registerUser();
    await makeAdmin(admin.userId);
    const ah = bearer(admin.token);
    const { eventId } = await publishedPending('Concert To Approve');

    const queue = await request(app).get('/api/admin/moderation').set(ah).expect(200);
    expect(queue.body.some((e: { id: number }) => e.id === eventId)).toBe(true);

    // not public before approval
    expect(has((await request(app).get('/api/events').expect(200)).body, 'Concert To Approve')).toBe(false);

    await request(app).post(`/api/admin/events/${eventId}/approve`).set(ah).expect(200);
    expect(has((await request(app).get('/api/events').expect(200)).body, 'Concert To Approve')).toBe(true);

    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'event_approved' AND target_id = $1`, [eventId]);
    expect(audit.rows).toHaveLength(1);
  });

  it('reject keeps it hidden; suspending the organizer hides an approved event (FR-033/D-E)', async () => {
    const admin = await registerUser();
    await makeAdmin(admin.userId);
    const ah = bearer(admin.token);

    const rejected = await publishedPending('Bad Event');
    await request(app).post(`/api/admin/events/${rejected.eventId}/reject`).set(ah).send({ reason: 'vi phạm' }).expect(200);
    expect(has((await request(app).get('/api/events').expect(200)).body, 'Bad Event')).toBe(false);

    const good = await publishedPending('Good Event');
    await request(app).post(`/api/admin/events/${good.eventId}/approve`).set(ah).expect(200);
    expect(has((await request(app).get('/api/events').expect(200)).body, 'Good Event')).toBe(true);

    await suspendOrganizer(good.orgUserId); // organizer suspended → all their events hidden
    expect(has((await request(app).get('/api/events').expect(200)).body, 'Good Event')).toBe(false);
  });
});
