import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { refreshCookie } from '../helpers/cookie.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function registerUser() {
  const r = await request(app).post('/api/auth/register').send(creds).expect(201);
  return { token: r.body.accessToken as string, cookie: refreshCookie(r)!, id: r.body.user.id as number };
}

describe('profile + change password (US5)', () => {
  it('updates nickname and phone, ignoring privilege fields (FR-035/008)', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .patch('/api/me')
      .set(bearer(token))
      .send({ nickname: 'Hà Mới', phone: '0901234567', isAdmin: true, status: 'suspended' })
      .expect(200);
    expect(res.body.nickname).toBe('Hà Mới');
    expect(res.body.phone).toBe('+84901234567');
    expect(res.body.isAdmin).toBe(false); // privilege field ignored
    expect(res.body.status).toBe('active');
  });

  it('refuses a phone already held by another account (409, FR-050)', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ ...creds, email: 'other@example.com', phone: '0901234567' })
      .expect(201);
    const { token } = await registerUser();
    const res = await request(app).patch('/api/me').set(bearer(token)).send({ phone: '0901234567' }).expect(409);
    expect(res.body.error).toBe('phone_taken');
  });

  it('changes password: revokes OTHER sessions, keeps the current one (FR-057)', async () => {
    const a = await registerUser(); // session A
    const bRes = await request(app).post('/api/auth/login').send({ identifier: creds.email, password: creds.password }).expect(200);
    const cookieB = refreshCookie(bRes)!;

    await request(app)
      .post('/api/me/password')
      .set(bearer(a.token))
      .send({ currentPassword: 'secret123', newPassword: 'newpass123', newPasswordConfirm: 'newpass123' })
      .expect(200);

    await request(app).post('/api/auth/refresh').set('Cookie', cookieB).expect(401); // other session dead
    await request(app).post('/api/auth/refresh').set('Cookie', a.cookie).expect(200); // current alive

    await request(app).post('/api/auth/login').send({ identifier: creds.email, password: 'secret123' }).expect(401);
    await request(app).post('/api/auth/login').send({ identifier: creds.email, password: 'newpass123' }).expect(200);
  });

  it('refuses a wrong current password (403), leaving the password unchanged', async () => {
    const { token } = await registerUser();
    await request(app)
      .post('/api/me/password')
      .set(bearer(token))
      .send({ currentPassword: 'wrongpass9', newPassword: 'newpass123', newPasswordConfirm: 'newpass123' })
      .expect(403)
      .expect((r) => expect(r.body.error).toBe('wrong_current_password'));
    await request(app).post('/api/auth/login').send({ identifier: creds.email, password: 'secret123' }).expect(200);
  });
});
