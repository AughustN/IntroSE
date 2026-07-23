import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { refreshCookie } from '../helpers/cookie.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };

function register() {
  return request(app).post('/api/auth/register').send(creds);
}

describe('logout + reuse detection (US2)', () => {
  it('logout makes the previous session unusable on the next request (SC-005)', async () => {
    const reg = await register().expect(201);
    const cookie = refreshCookie(reg)!;
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${reg.body.accessToken}`).expect(204);
    // replay the pre-logout refresh token → refused
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('logout-all ends every session for the account (FR-018)', async () => {
    await register().expect(201);
    const a = await request(app).post('/api/auth/login').send({ identifier: creds.email, password: creds.password }).expect(200);
    const b = await request(app).post('/api/auth/login').send({ identifier: creds.email, password: creds.password }).expect(200);
    const cookieA = refreshCookie(a)!;
    const cookieB = refreshCookie(b)!;

    await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${a.body.accessToken}`).expect(204);
    await request(app).post('/api/auth/refresh').set('Cookie', cookieA).expect(401);
    await request(app).post('/api/auth/refresh').set('Cookie', cookieB).expect(401);
  });

  it('reusing a superseded (rotated) token kills its family (FR-019)', async () => {
    const reg = await register().expect(201);
    const original = refreshCookie(reg)!;

    // rotate once → original is now 'rotated', child issued
    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original).expect(200);
    const child = refreshCookie(rotated)!;

    // replay the ORIGINAL (superseded) token with no idempotency key → reuse → family killed
    await request(app).post('/api/auth/refresh').set('Cookie', original).expect(401);
    // the legitimate child is now dead too (whole family revoked)
    await request(app).post('/api/auth/refresh').set('Cookie', child).expect(401);
  });

  it('an honest retry with the same idempotency key returns the same result, no kill', async () => {
    const reg = await register().expect(201);
    const cookie = refreshCookie(reg)!;
    const key = 'test-key-123';
    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('x-idempotency-key', key).expect(200);
    const retry = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('x-idempotency-key', key).expect(200);
    expect(retry.body.accessToken).toBe(first.body.accessToken);
    // the child from the first rotation still works (family intact)
    await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(first)!).expect(200);
  });
});
