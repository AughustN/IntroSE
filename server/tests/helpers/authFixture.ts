import request from 'supertest';
import { pool } from '../../src/db/pool.js';
import { app } from './app.js';

/*
 * A distinct source address per registration, because that is what distinct people are.
 *
 * Sign-ups are rate limited per IP — six an hour, after which the seventh has to solve a CAPTCHA
 * (auth.routes). Every fixture user used to arrive from loopback with no challenge attached, so a
 * case that needed more than six accounts got a 403 on the seventh and failed at the line that
 * built its fixtures rather than at anything it was asserting. `fillWaitlistWithSessions(…, 10)`
 * is the obvious one: ten people queueing for a sold-out show is the scenario, not an attack.
 *
 * Handing each one its own address is the honest fix rather than attaching a test CAPTCHA token:
 * ten strangers do come from ten networks, and the whole anti-bot path still runs on every call —
 * nothing here is bypassed. `app.set("trust proxy", 1)` is what makes the header reach `req.ip`.
 */
let sourceCounter = 0;

function nextSourceIp(): string {
  sourceCounter += 1;
  const n = sourceCounter;
  return `10.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`;
}

/**
 * Register a real user via the auth API, returning a working access token.
 *
 * `sourceIp` is for the cases that mean to share one: a test about the per-IP limit itself wants
 * several registrations to land in the same bucket.
 */
export async function registerUser(
  sourceIp: string = nextSourceIp(),
): Promise<{ token: string; userId: number; email: string }> {
  const email = `u-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const r = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', sourceIp)
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
