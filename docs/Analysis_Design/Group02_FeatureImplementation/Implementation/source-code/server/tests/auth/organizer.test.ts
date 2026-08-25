import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };
const application = { displayName: 'Sự kiện ABC', description: 'Nhà tổ chức sự kiện âm nhạc.' };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function registerUser(email = creds.email) {
  const r = await request(app).post('/api/auth/register').send({ ...creds, email }).expect(201);
  return { token: r.body.accessToken as string, id: r.body.user.id as number };
}
const setStatus = (userId: number, status: string) =>
  pool.query(`UPDATE organizers SET status = $2 WHERE user_id = $1`, [userId, status]);

describe('organizer application (US6)', () => {
  it('applies → pending; organizer-only action gated until approved; suspension bites next request', async () => {
    const { token, id } = await registerUser();

    await request(app).post('/api/organizers/apply').set(bearer(token)).send(application).expect(201);
    // pending → not yet an organizer
    await request(app).get('/api/organizers/dashboard').set(bearer(token)).expect(403);
    // re-apply while pending
    await request(app)
      .post('/api/organizers/apply')
      .set(bearer(token))
      .send(application)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('already_pending'));

    // approve → capability turns on (derived per request, FR-021)
    await setStatus(id, 'approved');
    await request(app).get('/api/organizers/dashboard').set(bearer(token)).expect(200);
    await request(app)
      .post('/api/organizers/apply')
      .set(bearer(token))
      .send(application)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('already_approved'));

    // suspend → refused on the very next request (SC-008), and cannot re-apply (FR-059)
    await setStatus(id, 'suspended');
    await request(app).get('/api/organizers/dashboard').set(bearer(token)).expect(403);
    await request(app)
      .post('/api/organizers/apply')
      .set(bearer(token))
      .send(application)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('suspended_cannot_reapply'));
  });

  it('a rejected applicant can re-apply, keeping the old row as history (FR-058/060)', async () => {
    const { token, id } = await registerUser('rej@example.com');
    await request(app).post('/api/organizers/apply').set(bearer(token)).send(application).expect(201);
    await setStatus(id, 'rejected');
    await request(app).post('/api/organizers/apply').set(bearer(token)).send(application).expect(201);

    const count = await pool.query('SELECT count(*)::int AS c FROM organizers WHERE user_id = $1', [id]);
    expect(count.rows[0].c).toBe(2); // history retained
  });
});
