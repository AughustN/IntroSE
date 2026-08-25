import request from 'supertest';
import { pool } from '../../src/db/pool.js';
import { app } from './app.js';

/** Register a real user via the auth API, returning a working access token. */
export async function registerUser(): Promise<{ token: string; userId: number; email: string }> {
  const email = `u-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', passwordConfirm: 'secret123', nickname: 'U' })
    .expect(201);
  return { token: r.body.accessToken, userId: r.body.user.id, email };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function makeApprovedOrganizer(userId: number): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO organizers (user_id, display_name, status) VALUES ($1, 'Org', 'approved') RETURNING id`, [userId]);
  return rows[0].id;
}

export async function makeAdmin(userId: number): Promise<void> {
  await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [userId]);
}

export async function suspendOrganizer(userId: number): Promise<void> {
  await pool.query(`UPDATE organizers SET status = 'suspended' WHERE user_id = $1`, [userId]);
}
