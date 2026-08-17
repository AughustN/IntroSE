import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../../src/db/pool.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/config.js';
import { app } from '../helpers/app.js';
import { bearer } from '../helpers/authFixture.js';
import { seedVisibleGaEvent } from '../helpers/catalogSeed.js';
import { issueSession } from '../../src/modules/auth/sessions.js';

let seq = 0;
const uniq = () => `test-${Date.now()}-${++seq}`;

// ─── Direct Atomic DB Fixture Helpers (100% atomic in single transaction) ────

async function admin() {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users (email, nickname, password_hash, provider, is_admin) VALUES ($1, 'Admin', 'x', 'email', true) RETURNING id`,
      [`admin-${uniq()}@example.com`],
    );
    const userId = rows[0].id;
    const sess = await issueSession(db, userId, {});
    return { userId, token: sess.accessToken, h: bearer(sess.accessToken) };
  });
}

async function attendee() {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users (email, nickname, password_hash, provider) VALUES ($1, 'User', 'x', 'email') RETURNING id`,
      [`user-${uniq()}@example.com`],
    );
    const userId = rows[0].id;
    const sess = await issueSession(db, userId, {});
    return { userId, token: sess.accessToken, h: bearer(sess.accessToken) };
  });
}

async function organizer() {
  return withTransaction(async (db) => {
    const { rows: uRows } = await db.query(
      `INSERT INTO users (email, nickname, password_hash, provider) VALUES ($1, 'Org', 'x', 'email') RETURNING id`,
      [`org-${uniq()}@example.com`],
    );
    const userId = uRows[0].id;
    const { rows: oRows } = await db.query(
      `INSERT INTO organizers (user_id, display_name, status) VALUES ($1, 'Nhà tổ chức', 'approved') RETURNING id`,
      [userId],
    );
    const organizerId = oRows[0].id;
    const sess = await issueSession(db, userId, {});
    return { userId, organizerId, token: sess.accessToken, h: bearer(sess.accessToken) };
  });
}

async function auditRows(action: string) {
  const { rows } = await pool.query(
    `SELECT * FROM audit_logs WHERE action = $1 ORDER BY id`,
    [action],
  );
  return rows;
}

async function countAudit(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS c FROM audit_logs`);
  return rows[0].c;
}

// ─── US1: Category Management (T028–T030) ───────────────────────────────────

describe('US1 – Category management', () => {
  describe('RBAC (T028)', () => {
    it('denies unauthenticated category list', async () => {
      await request(app).get('/api/admin/categories').expect(401);
    });

    it('denies Attendee access to categories', async () => {
      const u = await attendee();
      await request(app).get('/api/admin/categories').set(u.h).expect(403);
    });

    it('denies Organizer access to categories', async () => {
      const o = await organizer();
      await request(app).get('/api/admin/categories').set(o.h).expect(403);
    });

    it('allows Admin to list categories', async () => {
      const a = await admin();
      const res = await request(app).get('/api/admin/categories').set(a.h).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('CRUD (T029)', () => {
    it('creates a category and returns it with a stable code', async () => {
      const a = await admin();
      const name = `Loại ${uniq()}`;
      const res = await request(app)
        .post('/api/admin/categories')
        .set(a.h)
        .send({ labelVi: name })
        .expect(201);

      expect(res.body.labelVi).toBe(name);
      expect(res.body.code).toBeTruthy();
      expect(res.body.id).toBeGreaterThan(0);
    });

    it('lists categories including newly created ones', async () => {
      const a = await admin();
      const name = `Hội nghị ${uniq()}`;
      await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: name }).expect(201);
      const res = await request(app).get('/api/admin/categories').set(a.h).expect(200);
      expect(res.body.some((c: { labelVi: string }) => c.labelVi === name)).toBe(true);
    });

    it('renames a category', async () => {
      const a = await admin();
      const created = await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: `Cũ ${uniq()}` }).expect(201);
      const newName = `Mới ${uniq()}`;
      const renamed = await request(app)
        .put(`/api/admin/categories/${created.body.id}`)
        .set(a.h)
        .send({ labelVi: newName })
        .expect(200);

      expect(renamed.body.labelVi).toBe(newName);
      expect(renamed.body.code).toBe(created.body.code); // code is stable
    });

    it('rejects duplicate normalized category name on create', async () => {
      const a = await admin();
      const name = `Nhạc sống ${uniq()}`;
      await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: name }).expect(201);
      const dup = await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: `  ${name}  ` });
      expect(dup.status).toBe(409);
    });

    it('rejects duplicate normalized category name on rename', async () => {
      const a = await admin();
      const name1 = `Kịch ${uniq()}`;
      await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: name1 }).expect(201);
      const other = await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: `Xiếc ${uniq()}` }).expect(201);
      const res = await request(app).put(`/api/admin/categories/${other.body.id}`).set(a.h).send({ labelVi: name1.toLowerCase() });
      expect(res.status).toBe(409);
    });

    it('deletes an unused category', async () => {
      const a = await admin();
      const cat = await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: `Xóa được ${uniq()}` }).expect(201);
      await request(app).delete(`/api/admin/categories/${cat.body.id}`).set(a.h).expect(204);
    });

    it('refuses to delete a category that has events', async () => {
      const a = await admin();
      await seedVisibleGaEvent({ title: 'Sự kiện test category', category: 'music' });

      // Find the music category
      const cats = await request(app).get('/api/admin/categories').set(a.h).expect(200);
      const music = cats.body.find((c: { code: string }) => c.code === 'music');
      if (music) {
        const res = await request(app).delete(`/api/admin/categories/${music.id}`).set(a.h);
        expect(res.status).toBe(409);
      }
    });
  });

  describe('concurrent name collision and public filtering after rename (T030)', () => {
    it('preserves stable category codes for public filtering after rename', async () => {
      const a = await admin();
      const cat = await request(app).post('/api/admin/categories').set(a.h).send({ labelVi: `Phim ảnh ${uniq()}` }).expect(201);

      // Rename does not change the code
      const renamed = await request(app).put(`/api/admin/categories/${cat.body.id}`).set(a.h).send({ labelVi: `Điện ảnh ${uniq()}` }).expect(200);
      expect(renamed.body.code).toBe(cat.body.code);
    });
  });
});

// ─── US2: Featured Events (T031–T033) ───────────────────────────────────────

describe('US2 – Featured events', () => {
  describe('replacement and validation (T031)', () => {
    it('replaces the featured list atomically', async () => {
      const a = await admin();
      const ev1 = await seedVisibleGaEvent({ title: 'Nổi bật 1' });
      const ev2 = await seedVisibleGaEvent({ title: 'Nổi bật 2' });

      const res = await request(app)
        .put('/api/admin/homepage/featured')
        .set(a.h)
        .send({ events: [{ eventId: ev1.eventId, displayOrder: 0 }, { eventId: ev2.eventId, displayOrder: 1 }] })
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].displayOrder).toBe(0);
      expect(res.body[1].displayOrder).toBe(1);
    });

    it('clears featured when given an empty array', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Tạm nổi bật' });
      await request(app).put('/api/admin/homepage/featured').set(a.h).send({ events: [{ eventId: ev.eventId, displayOrder: 0 }] }).expect(200);
      const res = await request(app).put('/api/admin/homepage/featured').set(a.h).send({ events: [] }).expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('uses deterministic display order', async () => {
      const a = await admin();
      const ev1 = await seedVisibleGaEvent({ title: 'Thứ tự 1' });
      const ev2 = await seedVisibleGaEvent({ title: 'Thứ tự 2' });

      const res = await request(app)
        .put('/api/admin/homepage/featured')
        .set(a.h)
        .send({ events: [{ eventId: ev2.eventId, displayOrder: 1 }, { eventId: ev1.eventId, displayOrder: 0 }] })
        .expect(200);

      expect(res.body[0].eventId).toBe(ev1.eventId);
      expect(res.body[1].eventId).toBe(ev2.eventId);
    });

    it('rejects duplicate event IDs', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Trùng' });

      const res = await request(app)
        .put('/api/admin/homepage/featured')
        .set(a.h)
        .send({ events: [{ eventId: ev.eventId, displayOrder: 0 }, { eventId: ev.eventId, displayOrder: 1 }] });
      expect(res.status).toBe(409);
    });

    it('rejects duplicate display orders', async () => {
      const a = await admin();
      const ev1 = await seedVisibleGaEvent({ title: 'Sao 1' });
      const ev2 = await seedVisibleGaEvent({ title: 'Sao 2' });

      const res = await request(app)
        .put('/api/admin/homepage/featured')
        .set(a.h)
        .send({ events: [{ eventId: ev1.eventId, displayOrder: 0 }, { eventId: ev2.eventId, displayOrder: 0 }] });
      expect(res.status).toBe(409);
    });

    it('rejects negative display order', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Âm' });

      const res = await request(app)
        .put('/api/admin/homepage/featured')
        .set(a.h)
        .send({ events: [{ eventId: ev.eventId, displayOrder: -1 }] });
      expect(res.status).toBe(400);
    });

    it('rejects an unavailable event', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Chưa duyệt', moderation: 'pending_review' });

      const res = await request(app)
        .put('/api/admin/homepage/featured')
        .set(a.h)
        .send({ events: [{ eventId: ev.eventId, displayOrder: 0 }] });
      expect(res.status).toBe(409);
    });
  });

  describe('public visibility (T032)', () => {
    it('featured events appear on public /api/events/featured', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Công khai nổi bật' });

      await request(app).put('/api/admin/homepage/featured').set(a.h)
        .send({ events: [{ eventId: ev.eventId, displayOrder: 0 }] }).expect(200);

      const pub = await request(app).get('/api/events/featured').expect(200);
      expect(pub.body.some((e: { title: string }) => e.title === 'Công khai nổi bật')).toBe(true);
    });

    it('hides featured events when they become unavailable', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Sẽ ẩn' });

      await request(app).put('/api/admin/homepage/featured').set(a.h)
        .send({ events: [{ eventId: ev.eventId, displayOrder: 0 }] }).expect(200);

      // Flag the event directly in DB (removes from approved → not visible)
      await pool.query(`UPDATE events SET moderation_status = 'flagged' WHERE id = $1`, [ev.eventId]);

      const pub = await request(app).get('/api/events/featured').expect(200);
      expect(pub.body.some((e: { title: string }) => e.title === 'Sẽ ẩn')).toBe(false);
    });
  });

  describe('RBAC (T033)', () => {
    it('denies unauthenticated featured GET/PUT', async () => {
      await request(app).get('/api/admin/homepage/featured').expect(401);
      await request(app).put('/api/admin/homepage/featured').send({ events: [] }).expect(401);
    });

    it('denies non-Admin featured GET/PUT', async () => {
      const u = await attendee();
      await request(app).get('/api/admin/homepage/featured').set(u.h).expect(403);
      await request(app).put('/api/admin/homepage/featured').set(u.h).send({ events: [] }).expect(403);
    });

    it('rejected update preserves the previous featured list', async () => {
      const a = await admin();
      const ev = await seedVisibleGaEvent({ title: 'Bảo toàn' });

      await request(app).put('/api/admin/homepage/featured').set(a.h)
        .send({ events: [{ eventId: ev.eventId, displayOrder: 0 }] }).expect(200);

      // Try adding a pending (unavailable) event — should fail
      const pending = await seedVisibleGaEvent({ title: 'Chưa duyệt', moderation: 'pending_review' });
      await request(app).put('/api/admin/homepage/featured').set(a.h)
        .send({ events: [{ eventId: pending.eventId, displayOrder: 0 }] });

      // Previous list should be intact
      const res = await request(app).get('/api/admin/homepage/featured').set(a.h).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].eventId).toBe(ev.eventId);
    });
  });
});

// ─── US3: System Settings (T034–T038) ───────────────────────────────────────

describe('US3 – System settings', () => {
  describe('defaults and fallback (T034)', () => {
    it('returns default values when no system_settings rows exist', async () => {
      const a = await admin();
      const res = await request(app).get('/api/admin/settings').set(a.h).expect(200);

      expect(res.body.seat_hold_ttl_minutes).toBe(DEFAULT_SYSTEM_SETTINGS.seat_hold_ttl_minutes);
      expect(res.body.topup_grace_minutes).toBe(DEFAULT_SYSTEM_SETTINGS.topup_grace_minutes);
      expect(res.body.absolute_ceiling_minutes).toBe(DEFAULT_SYSTEM_SETTINGS.absolute_ceiling_minutes);
      expect(res.body.max_tickets_per_buyer).toBe(DEFAULT_SYSTEM_SETTINGS.max_tickets_per_buyer);
      expect(res.body.wallet_topup_min).toBe(DEFAULT_SYSTEM_SETTINGS.wallet_topup_min);
      expect(res.body.wallet_topup_max).toBe(DEFAULT_SYSTEM_SETTINGS.wallet_topup_max);
      expect(res.body.wallet_balance_ceiling).toBe(DEFAULT_SYSTEM_SETTINGS.wallet_balance_ceiling);
      expect(res.body.ai_features_enabled).toBe(DEFAULT_SYSTEM_SETTINGS.ai_features_enabled);
    });

    it('returns defaults when stored rows contain malformed values', async () => {
      const a = await admin();
      // Insert a malformed row directly
      await pool.query(`INSERT INTO system_settings (key, value) VALUES ('seat_hold_ttl_minutes', '"not_a_number"'::jsonb)`);

      const res = await request(app).get('/api/admin/settings').set(a.h).expect(200);
      expect(res.body.seat_hold_ttl_minutes).toBe(DEFAULT_SYSTEM_SETTINGS.seat_hold_ttl_minutes);
    });
  });

  describe('bounds validation (T035)', () => {
    it('accepts valid settings at minimum bounds', async () => {
      const a = await admin();
      const min = {
        seat_hold_ttl_minutes: 1,
        topup_grace_minutes: 1,
        absolute_ceiling_minutes: 2,
        max_tickets_per_buyer: 1,
        wallet_topup_min: 0,
        wallet_topup_max: 0,
        wallet_balance_ceiling: 0,
        ai_features_enabled: false,
        // Zero is a real setting, not an omission: it stops every outbound AI call (feature 008).
        ai_platform_request_ceiling: 0,
        ai_platform_window_hours: 1,
      };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(min).expect(200);
      expect(res.body.seat_hold_ttl_minutes).toBe(1);
      // The AI keys are read-only: `min` asked for `false` and the stored default survives. Spend
      // against an outside provider is an operator decision, not a dial on the console.
      expect(res.body.ai_features_enabled).toBe(DEFAULT_SYSTEM_SETTINGS.ai_features_enabled);
    });

    it('ignores the AI keys, whatever the request asks for', async () => {
      const a = await admin();
      const meddling = {
        ...DEFAULT_SYSTEM_SETTINGS,
        max_tickets_per_buyer: 7,
        ai_features_enabled: !DEFAULT_SYSTEM_SETTINGS.ai_features_enabled,
        ai_platform_request_ceiling: 999_999,
        ai_platform_window_hours: 999,
      };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(meddling).expect(200);

      // The editable half still saves...
      expect(res.body.max_tickets_per_buyer).toBe(7);
      // ...and the read-only half is untouched, in the response and on the next read.
      expect(res.body.ai_features_enabled).toBe(DEFAULT_SYSTEM_SETTINGS.ai_features_enabled);
      expect(res.body.ai_platform_request_ceiling).toBe(
        DEFAULT_SYSTEM_SETTINGS.ai_platform_request_ceiling,
      );
      expect(res.body.ai_platform_window_hours).toBe(
        DEFAULT_SYSTEM_SETTINGS.ai_platform_window_hours,
      );

      const after = await request(app).get('/api/admin/settings').set(a.h).expect(200);
      expect(after.body.ai_platform_request_ceiling).toBe(
        DEFAULT_SYSTEM_SETTINGS.ai_platform_request_ceiling,
      );
    });

    it('accepts valid settings at maximum bounds', async () => {
      const a = await admin();
      const max = {
        seat_hold_ttl_minutes: 30,
        topup_grace_minutes: 15,
        absolute_ceiling_minutes: 30,
        max_tickets_per_buyer: 50,
        wallet_topup_min: 100,
        wallet_topup_max: 1000,
        wallet_balance_ceiling: 10000,
        ai_features_enabled: true,
        ai_platform_request_ceiling: 1_000_000,
        ai_platform_window_hours: 720,
      };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(max).expect(200);
      expect(res.body.seat_hold_ttl_minutes).toBe(30);
    });

    it('rejects seat_hold_ttl_minutes out of bounds', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, seat_hold_ttl_minutes: 0 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });

    it('rejects seat_hold_ttl_minutes above max', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, seat_hold_ttl_minutes: 31 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });

    it('rejects max_tickets_per_buyer = 0', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, max_tickets_per_buyer: 0 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });

    it('rejects non-boolean ai_features_enabled', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, ai_features_enabled: 1 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });

    it('rejects cross-field: grace > ceiling', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, topup_grace_minutes: 15, absolute_ceiling_minutes: 10 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });

    it('rejects cross-field: wallet_topup_min > wallet_topup_max', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, wallet_topup_min: 1_000_000, wallet_topup_max: 500_000, wallet_balance_ceiling: 2_000_000 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });

    it('rejects cross-field: wallet_topup_max > wallet_balance_ceiling', async () => {
      const a = await admin();
      const s = { ...DEFAULT_SYSTEM_SETTINGS, wallet_topup_min: 1000, wallet_topup_max: 5_000_000, wallet_balance_ceiling: 1_000_000 };
      const res = await request(app).put('/api/admin/settings').set(a.h).send(s);
      expect(res.status).toBe(400);
    });
  });

  describe('atomic updates and cache (T036)', () => {
    it('updates all settings atomically', async () => {
      const a = await admin();
      const updated = {
        ...DEFAULT_SYSTEM_SETTINGS,
        seat_hold_ttl_minutes: 5,
        max_tickets_per_buyer: 4,
      };
      await request(app).put('/api/admin/settings').set(a.h).send(updated).expect(200);

      const res = await request(app).get('/api/admin/settings').set(a.h).expect(200);
      expect(res.body.seat_hold_ttl_minutes).toBe(5);
      expect(res.body.max_tickets_per_buyer).toBe(4);
    });

    it('preserves prior values after rejected submission', async () => {
      const a = await admin();
      const valid = { ...DEFAULT_SYSTEM_SETTINGS, seat_hold_ttl_minutes: 10 };
      await request(app).put('/api/admin/settings').set(a.h).send(valid).expect(200);

      // Try an invalid update
      const invalid = { ...DEFAULT_SYSTEM_SETTINGS, seat_hold_ttl_minutes: 999 };
      await request(app).put('/api/admin/settings').set(a.h).send(invalid);

      const res = await request(app).get('/api/admin/settings').set(a.h).expect(200);
      expect(res.body.seat_hold_ttl_minutes).toBe(10); // unchanged
    });
  });

  describe('audit (T037)', () => {
    it('writes audit record on successful settings update', async () => {
      const a = await admin();
      const updated = { ...DEFAULT_SYSTEM_SETTINGS, seat_hold_ttl_minutes: 3 };
      await request(app).put('/api/admin/settings').set(a.h).send(updated).expect(200);

      const rows = await auditRows('system_settings_updated');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const last = rows[rows.length - 1];
      expect(last.target_type).toBe('system_settings');
      expect(last.outcome).toBe('applied');
      expect(last.actor_user_id).toBe(a.userId);
    });

    it('does not write audit on rejected settings update', async () => {
      const a = await admin();
      const before = await countAudit();
      const invalid = { ...DEFAULT_SYSTEM_SETTINGS, seat_hold_ttl_minutes: 0 };
      await request(app).put('/api/admin/settings').set(a.h).send(invalid);
      const after = await countAudit();
      expect(after).toBe(before);
    });

    it('audit includes changed keys and before/after values', async () => {
      const a = await admin();
      const updated = { ...DEFAULT_SYSTEM_SETTINGS, max_tickets_per_buyer: 3 };
      await request(app).put('/api/admin/settings').set(a.h).send(updated).expect(200);

      const rows = await auditRows('system_settings_updated');
      const last = rows[rows.length - 1];
      expect(last.detail).toBeDefined();
      expect(last.detail.changedKeys).toBeDefined();
      expect(last.detail.before).toBeDefined();
      expect(last.detail.after).toBeDefined();
    });
  });

  describe('RBAC (T038)', () => {
    it('denies unauthenticated settings GET', async () => {
      await request(app).get('/api/admin/settings').expect(401);
    });

    it('denies unauthenticated settings PUT', async () => {
      await request(app).put('/api/admin/settings').send(DEFAULT_SYSTEM_SETTINGS).expect(401);
    });

    it('denies Attendee settings GET', async () => {
      const u = await attendee();
      await request(app).get('/api/admin/settings').set(u.h).expect(403);
    });

    it('denies Attendee settings PUT', async () => {
      const u = await attendee();
      await request(app).put('/api/admin/settings').set(u.h).send(DEFAULT_SYSTEM_SETTINGS).expect(403);
    });

    it('denies Organizer settings GET', async () => {
      const o = await organizer();
      await request(app).get('/api/admin/settings').set(o.h).expect(403);
    });

    it('denies Organizer settings PUT', async () => {
      const o = await organizer();
      await request(app).put('/api/admin/settings').set(o.h).send(DEFAULT_SYSTEM_SETTINGS).expect(403);
    });

    it('no data disclosure on unauthorized settings GET', async () => {
      const u = await attendee();
      const res = await request(app).get('/api/admin/settings').set(u.h);
      expect(res.status).toBe(403);
      expect(res.body.seat_hold_ttl_minutes).toBeUndefined();
    });
  });
});
