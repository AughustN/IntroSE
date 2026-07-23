import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';

async function registerWithPhone() {
  await request(app)
    .post('/api/auth/register')
    .send({
      email: 'ha@example.com',
      password: 'secret123',
      passwordConfirm: 'secret123',
      nickname: 'Hà',
      phone: '0901234567',
    })
    .expect(201);
}

describe('POST /api/auth/login (US1)', () => {
  it('signs in by email OR phone', async () => {
    await registerWithPhone();
    await request(app).post('/api/auth/login').send({ identifier: 'ha@example.com', password: 'secret123' }).expect(200);
    await request(app).post('/api/auth/login').send({ identifier: '0901234567', password: 'secret123' }).expect(200);
    // canonical +84 form matches the same account
    await request(app).post('/api/auth/login').send({ identifier: '+84901234567', password: 'secret123' }).expect(200);
  });

  it('refuses a wrong password with invalid_credentials (401)', async () => {
    await registerWithPhone();
    const res = await request(app).post('/api/auth/login').send({ identifier: 'ha@example.com', password: 'wrongpass9' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('refuses an unknown identifier with the same code (401), not disclosing existence', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: 'nobody@example.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('treats a malformed identifier as invalid_credentials (401), not a 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: '!!!garbage', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });
});
