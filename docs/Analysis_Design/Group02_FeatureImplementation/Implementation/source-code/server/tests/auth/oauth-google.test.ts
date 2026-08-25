import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { googleVerifier } from '../../src/modules/auth/oauth.google.js';
import { app } from '../helpers/app.js';

function mockGoogle(identity: { sub: string; email: string; name?: string; picture?: string }) {
  vi.spyOn(googleVerifier, 'verify').mockResolvedValue(identity);
}

afterEach(() => vi.restoreAllMocks());

describe('POST /api/auth/oauth/google (US3)', () => {
  it('creates a new Attendee (no password) + wallet on first Google sign-in (201)', async () => {
    mockGoogle({ sub: 'g-1', email: 'gonzo@example.com', name: 'Gonzo', picture: 'https://cdn/x.png' });
    const res = await request(app).post('/api/auth/oauth/google').send({ credential: 'tok' }).expect(201);
    expect(res.body.user.provider).toBe('google');
    expect(res.body.user.nickname).toBe('Gonzo');

    const row = await pool.query('SELECT password_hash, provider FROM users WHERE email = $1', ['gonzo@example.com']);
    expect(row.rows[0].password_hash).toBeNull();
    const w = await pool.query('SELECT 1 FROM wallets WHERE user_id = $1', [res.body.user.id]);
    expect(w.rows).toHaveLength(1);
  });

  it('signs into the same account on repeat, no duplicate (200)', async () => {
    mockGoogle({ sub: 'g-2', email: 'repeat@example.com', name: 'R' });
    await request(app).post('/api/auth/oauth/google').send({ credential: 'tok' }).expect(201);
    await request(app).post('/api/auth/oauth/google').send({ credential: 'tok' }).expect(200);
    const count = await pool.query('SELECT count(*)::int AS c FROM users WHERE email = $1', ['repeat@example.com']);
    expect(count.rows[0].c).toBe(1);
  });

  it('refuses a Google email that belongs to a password account, never links (409, D5)', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'clash@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Pw' })
      .expect(201);
    mockGoogle({ sub: 'g-3', email: 'clash@example.com', name: 'G' });
    const res = await request(app).post('/api/auth/oauth/google').send({ credential: 'tok' }).expect(409);
    expect(res.body.error).toBe('email_registered_with_password');
  });

  it('refuses a suspended Google account after the provider verifies (403)', async () => {
    mockGoogle({ sub: 'g-4', email: 'susp@example.com', name: 'S' });
    const reg = await request(app).post('/api/auth/oauth/google').send({ credential: 'tok' }).expect(201);
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [reg.body.user.id]);
    const res = await request(app).post('/api/auth/oauth/google').send({ credential: 'tok' }).expect(403);
    expect(res.body.error).toBe('account_suspended');
  });

  it('rejects an invalid Google credential (401)', async () => {
    vi.spyOn(googleVerifier, 'verify').mockRejectedValue(new Error('bad'));
    const res = await request(app).post('/api/auth/oauth/google').send({ credential: 'bad' }).expect(401);
    expect(res.body.error).toBe('invalid_google_credential');
  });
});
