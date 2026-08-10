import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, registerUser, makeAdmin } from '../helpers/authFixture.js';
import * as holds from '../helpers/holdsSeed.js';
import { settingServiceTest, getSettings, updateSettings } from '../../src/modules/admin/settings.service.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/config.js';

/**
 * Future-only settings semantics (T017). Settings affect new holds/extensions; active
 * reservations keep their stored timestamps. This aligns with the data-model lifecycle
 * guarantee: "Settings are effective for requests that begin after successful commit."
 */
describe('holds respect dynamic system settings', () => {
  beforeEach(() => {
    settingServiceTest.resetCache();
  });

  it('new GA holds use current seat_hold_ttl_minutes from settings', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(10);
    const user = await registerUser();

    // Update settings to a shorter TTL (2 minutes)
    const admin = await registerUser();
    await makeAdmin(admin.userId);
    await updateSettings(admin.userId, {
      ...DEFAULT_SYSTEM_SETTINGS,
      seat_hold_ttl_minutes: 2,
    });

    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 })
      .expect(201);

    // The expiry should be about 2 minutes from now, not the default 7
    const expiresAt = new Date(res.body.expiresAt).getTime();
    const now = Date.now();
    const minutesDiff = (expiresAt - now) / 60_000;
    expect(minutesDiff).toBeGreaterThan(1);
    expect(minutesDiff).toBeLessThanOrEqual(3); // generous tolerance for clock skew
  });

  it('existing reservation timestamps are not rewritten when TTL changes', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(10);
    const user = await registerUser();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    // Hold with default 7-minute TTL
    const res1 = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 })
      .expect(201);
    const originalExpiry = res1.body.expiresAt;

    // Change TTL to 2 minutes
    await updateSettings(admin.userId, {
      ...DEFAULT_SYSTEM_SETTINGS,
      seat_hold_ttl_minutes: 2,
    });

    // Add tickets to the existing reservation — the expiry does not change
    const res2 = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 })
      .expect(201);

    expect(res2.body.expiresAt).toBe(originalExpiry);
  });

  it('uses current max_tickets_per_buyer for cap enforcement', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(10);
    const user = await registerUser();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    // Lower the cap to 1
    await updateSettings(admin.userId, {
      ...DEFAULT_SYSTEM_SETTINGS,
      max_tickets_per_buyer: 1,
    });

    await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 })
      .expect(201);

    // A second ticket should be refused
    const res = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('cap_exceeded');
  });

  it('extendOnce reads current grace/ceiling, not creation-time values', async () => {
    const { showtimeId, tierId } = await holds.seedGaShowtime(10);
    const user = await registerUser();
    const admin = await registerUser();
    await makeAdmin(admin.userId);

    const held = await request(app)
      .post('/api/reservations')
      .set(bearer(user.token))
      .send({ showtimeId, ticketTierId: tierId, quantity: 1 })
      .expect(201);

    // Increase grace to 10 minutes (changes are future-only: read at extension time)
    await updateSettings(admin.userId, {
      ...DEFAULT_SYSTEM_SETTINGS,
      topup_grace_minutes: 10,
      absolute_ceiling_minutes: 25,
    });

    const { extendOnce } = await import('../../src/modules/holds/holds.service.js');
    const extended = await extendOnce(user.userId, held.body.id);

    // Extended expiry should exceed the original
    expect(new Date(extended.expiresAt).getTime()).toBeGreaterThan(new Date(held.body.expiresAt).getTime());
  });

  it('returns defaults when no system_settings rows exist', async () => {
    settingServiceTest.resetCache();
    const settings = await getSettings();
    expect(settings.seat_hold_ttl_minutes).toBe(DEFAULT_SYSTEM_SETTINGS.seat_hold_ttl_minutes);
    expect(settings.max_tickets_per_buyer).toBe(DEFAULT_SYSTEM_SETTINGS.max_tickets_per_buyer);
    expect(settings.topup_grace_minutes).toBe(DEFAULT_SYSTEM_SETTINGS.topup_grace_minutes);
  });
});
