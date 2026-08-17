import request from 'supertest';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';

const creds = { email: 'ha@example.com', password: 'secret123', passwordConfirm: 'secret123', nickname: 'Hà' };

async function token(): Promise<string> {
  const r = await request(app).post('/api/auth/register').send(creds).expect(201);
  return r.body.accessToken;
}

const pngBuffer = () =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();

describe('avatar upload (US5, ADR 0004)', () => {
  it('accepts a raster image, stores a re-encoded webp (200)', async () => {
    const t = await token();
    const png = await pngBuffer();
    const res = await request(app)
      .post('/api/me/avatar')
      .set('Authorization', `Bearer ${t}`)
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
      .expect(200);
    expect(res.body.avatarUrl).toMatch(/cloudinary\.com\/.*\/avatar/);
  });

  it('rejects an SVG (400 invalid_image)', async () => {
    const t = await token();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await request(app)
      .post('/api/me/avatar')
      .set('Authorization', `Bearer ${t}`)
      .attach('file', svg, { filename: 'x.svg', contentType: 'image/svg+xml' })
      .expect(400);
    expect(res.body.error).toBe('invalid_image');
  });

  it('rejects a non-image renamed with an image extension (400)', async () => {
    const t = await token();
    const fake = Buffer.from('this is definitely not an image at all, just text');
    await request(app)
      .post('/api/me/avatar')
      .set('Authorization', `Bearer ${t}`)
      .attach('file', fake, { filename: 'a.png', contentType: 'image/png' })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('invalid_image'));
  });

  it('rejects a file over 2MB (400 file_too_large)', async () => {
    const t = await token();
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    const res = await request(app)
      .post('/api/me/avatar')
      .set('Authorization', `Bearer ${t}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
    expect(res.body.error).toBe('file_too_large');
  });
});
