import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { refreshCookie } from '../helpers/cookie.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };

describe('refresh + me (US1)', () => {
  it('rotates the session and keeps the user recognised', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds).expect(201);
    const cookie = refreshCookie(reg)!;
    expect(cookie).toBeTruthy();

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.body.user.email).toBe('ha@example.com');
    // a new cookie is issued (rotation)
    expect(refreshCookie(refreshed)).not.toBe(cookie);
  });

  it('GET /api/me returns the profile shape incl. isOrganizer', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds).expect(201);
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${reg.body.accessToken}`).expect(200);
    expect(res.body).toMatchObject({
      email: 'ha@example.com',
      nickname: 'Hà',
      isAdmin: false,
      status: 'active',
      provider: 'email',
      isOrganizer: false,
    });
  });

  it('rejects an unauthenticated /api/me (401)', async () => {
    await request(app).get('/api/me').expect(401);
  });
});
