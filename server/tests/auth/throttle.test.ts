import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };

function loginFrom(ip: string, identifier: string, password: string) {
  return request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ identifier, password });
}

describe('abuse resistance (US7)', () => {
  it('throttles one source while the owner still signs in from another source (SC-009)', async () => {
    await request(app).post('/api/auth/register').send(creds).expect(201);

    // flood from one source with wrong passwords
    const flood = await Promise.all(
      Array.from({ length: 115 }, () => loginFrom('9.9.9.1', creds.email, 'wrongpass9')),
    );
    expect(flood.some((r) => r.status === 429)).toBe(true); // source got throttled

    // the rightful owner, from a different source, still gets in
    await loginFrom('9.9.9.2', creds.email, creds.password).expect(200);
  });

  it('never locks the account out: a stranger’s failures do not reach the owner (SC-013)', async () => {
    await request(app).post('/api/auth/register').send(creds).expect(201);

    // A third party grinds on the identifier from its own source.
    await Promise.all(Array.from({ length: 50 }, () => loginFrom('9.9.9.3', creds.email, 'wrongpass9')));

    // That source is now spent — 15 sign-ins per 15 minutes — and the right password does not buy
    // its way out of the window. This is the defence working, and it says nothing about the account.
    const attacker = await loginFrom('9.9.9.3', creds.email, creds.password);
    expect(attacker.status).toBe(429);

    // The owner, from their own source, walks in: no lockout to clear, no CAPTCHA to solve. This is
    // the assertion the criterion is actually about, and it fails the moment the failure counter is
    // read per identifier rather than per source.
    await loginFrom('9.9.9.5', creds.email, creds.password).expect(200);
  });

  it('throttle fires identically for an unknown identifier (FR-040, no enumeration)', async () => {
    const flood = await Promise.all(
      Array.from({ length: 115 }, () => loginFrom('9.9.9.4', 'ghost@example.com', 'whatever1')),
    );
    // 429 appears even though the account does not exist → cannot be used to enumerate
    expect(flood.some((r) => r.status === 429)).toBe(true);
    expect(flood.some((r) => r.status === 401)).toBe(true);
  });
});
