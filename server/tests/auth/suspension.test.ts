import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { mailer } from '../../src/modules/auth/mailer.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };

async function suspend(userId: number) {
  await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [userId]);
}

// The admin screen that sets status is out of scope (spec Assumptions); status is set
// directly in the DB here. Covers FR-051/052/053 (T056).
describe('account suspension (FR-051..053)', () => {
  it('a suspended account is refused sign-in, only after the password verifies (FR-013/051)', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds).expect(201);
    await suspend(reg.body.user.id);

    const res = await request(app).post('/api/auth/login').send({ identifier: creds.email, password: creds.password });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('account_suspended');

    // a WRONG password on the same suspended account must still look like invalid_credentials,
    // so suspension can't be used to probe existence.
    const wrong = await request(app).post('/api/auth/login').send({ identifier: creds.email, password: 'wrongpass9' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('invalid_credentials');
  });

  it('an active session is refused on the very next request after suspension (FR-052)', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds).expect(201);
    // session works before
    await request(app).get('/api/me').set('Authorization', `Bearer ${reg.body.accessToken}`).expect(200);
    await suspend(reg.body.user.id);
    // bites immediately via the live status read (ADR 0001)
    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(403)
      .expect((r) => expect(r.body.error).toBe('account_suspended'));
  });

  it('a reset request for a suspended account returns the same uniform response (FR-053)', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds).expect(201);
    await suspend(reg.body.user.id);
    const send = vi.spyOn(mailer, 'sendPasswordReset').mockResolvedValue();

    await request(app).post('/api/auth/password/forgot').send({ email: creds.email }).expect(200);

    // Identical reply is not enough: no link may be minted or mailed, or a reset would be a way
    // back into a suspended account (UC-05 A6).
    expect(send).not.toHaveBeenCalled();
    const { rows } = await pool.query(`SELECT 1 FROM password_resets WHERE user_id = $1`, [reg.body.user.id]);
    expect(rows).toHaveLength(0);
  });
});

afterEach(() => vi.restoreAllMocks());
