import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';

const valid = {
  email: 'ha@example.com',
  password: 'secret123',
  passwordConfirm: 'secret123',
  nickname: 'Hà',
};

describe('POST /api/auth/register (US1)', () => {
  it('creates an account + wallet and signs in (201, cookie)', async () => {
    const res = await request(app).post('/api/auth/register').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('ha@example.com');
    expect(res.headers['set-cookie']?.[0]).toMatch(/tix_refresh=/);

    const w = await pool.query('SELECT balance_amount FROM wallets WHERE user_id = $1', [res.body.user.id]);
    expect(w.rows).toHaveLength(1);
    expect(Number(w.rows[0].balance_amount)).toBe(0);
  });

  it('normalises email case/whitespace to one account', async () => {
    await request(app).post('/api/auth/register').send(valid).expect(201);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...valid, email: '  Ha@Example.com ' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('rejects a password mismatch and a weak password (400)', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ ...valid, passwordConfirm: 'nope123x' })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('password_mismatch'));
    await request(app)
      .post('/api/auth/register')
      .send({ ...valid, password: 'short', passwordConfirm: 'short' })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('weak_password'));
  });

  it('100 concurrent registrations on one email produce exactly 1 account (SC-007)', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => request(app).post('/api/auth/register').send(valid)),
    );
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    const count = await pool.query('SELECT count(*)::int AS c FROM users WHERE email = $1', ['ha@example.com']);
    expect(count.rows[0].c).toBe(1);
  });
});
