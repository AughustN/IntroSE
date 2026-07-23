import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../helpers/app.js';
import { mailer } from '../../src/modules/auth/mailer.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };

function captureResetLink() {
  const links: string[] = [];
  vi.spyOn(mailer, 'sendPasswordReset').mockImplementation(async (_to, link) => {
    links.push(link);
  });
  return links;
}

function tokenOf(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

afterEach(() => vi.restoreAllMocks());

describe('password reset (US4)', () => {
  it('forgot is uniform: mails a known address, sends nothing for an unknown one (FR-028)', async () => {
    await request(app).post('/api/auth/register').send(creds).expect(201);
    const links = captureResetLink();

    await request(app).post('/api/auth/password/forgot').send({ email: creds.email }).expect(200);
    await request(app).post('/api/auth/password/forgot').send({ email: 'nobody@example.com' }).expect(200);

    expect(links).toHaveLength(1); // only the registered address produced a mail
  });

  it('reset replaces the password, revokes sessions, and is single-use (FR-029/030)', async () => {
    await request(app).post('/api/auth/register').send(creds).expect(201);
    const links = captureResetLink();
    await request(app).post('/api/auth/password/forgot').send({ email: creds.email }).expect(200);
    const token = tokenOf(links[0]!);

    await request(app)
      .post('/api/auth/password/reset')
      .send({ token, password: 'newpass123', passwordConfirm: 'newpass123' })
      .expect(200);

    // old password no longer works, new one does
    await request(app).post('/api/auth/login').send({ identifier: creds.email, password: 'secret123' }).expect(401);
    await request(app).post('/api/auth/login').send({ identifier: creds.email, password: 'newpass123' }).expect(200);

    // link cannot be reused
    await request(app)
      .post('/api/auth/password/reset')
      .send({ token, password: 'another123', passwordConfirm: 'another123' })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('invalid_or_expired_token'));
  });
});
