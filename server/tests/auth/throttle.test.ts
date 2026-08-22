import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };
const wrongPassword = 'wrongpass9';

function loginFrom(ip: string, identifier: string, password: string, turnstileToken?: string) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ identifier, password, ...(turnstileToken ? { turnstileToken } : {}) });
}

describe('abuse resistance (US7)', () => {
  it('throttles one source over the per-source rate, whether or not the identifier exists (SC-009, FR-040)', async () => {
    // Flood one source past its sliding window. Requests refused by the source
    // limiter do not consume quota, so the mix below is stable: every admitted
    // attempt sees a cold identifier and answers 401, the rest are 429'd.
    for (const [ip, identifier] of [
      ['9.9.9.1', 'nobody@example.com'],
      ['9.9.9.6', 'ghost@example.com'],
    ] as const) {
      const flood = await Promise.all(
        Array.from({ length: 115 }, () => loginFrom(ip, identifier, wrongPassword)),
      );
      expect(flood.some((r) => r.status === 429)).toBe(true); // source got throttled
      expect(flood.some((r) => r.status === 401)).toBe(true); // answered identically for a dead address
    }
  });

  it('never locks the account out: a stranger’s failures do not reach the owner (SC-013)', async () => {
    await request(app).post('/api/auth/register').send(creds).expect(201);

    // A third party grinds on the identifier from its own source.
    await Promise.all(Array.from({ length: 50 }, () => loginFrom('9.9.9.3', creds.email, wrongPassword)));

    // That source is now spent — 15 sign-ins per 15 minutes — and the right password does not buy
    // its way out of the window. This is the defence working, and it says nothing about the account.
    const attacker = await loginFrom('9.9.9.3', creds.email, creds.password);
    expect(attacker.status).toBe(429);

    // The owner, from their own source, walks in: no lockout to clear, no CAPTCHA to solve.
    await loginFrom('9.9.9.5', creds.email, creds.password).expect(200);
  });

  it('demands a CAPTCHA from the fourth consecutive failure and lets a solved one through (013)', async () => {
    await request(app).post('/api/auth/register').send({ ...creds, email: 'cap@example.com' }).expect(201);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await loginFrom('9.9.9.5', 'cap@example.com', wrongPassword).expect(401);
    }

    // The fourth consecutive failure trips the adaptive gate before the
    // password is looked at.
    const gated = await loginFrom('9.9.9.5', 'cap@example.com', wrongPassword).expect(403);
    expect(gated.body.error).toBe('captcha_required');
    expect(gated.body.requireCaptcha).toBe(true);

    // A solved challenge admits the attempt to the ordinary wrong-password path.
    await loginFrom('9.9.9.5', 'cap@example.com', wrongPassword, 'test-token').expect(401);
  });
});
