import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { bindAndGenerate } from '../helpers/seatmapSeed.js';

// The seat map library (feature 006 stage 2) — every chart an organizer owns, across venues.
//
// The property under test is that the LIST and the REFUSALS agree. The library disables archive and
// delete from `usageCount`, and the server refuses them from `layoutInUse`; if those two ever drift
// the UI starts offering buttons that fail, which is worse than not offering them at all.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function venueWithChart(o: { h: Record<string, string> }, venueName: string, chartName: string) {
  const venue = (
    await request(app).post('/api/organizer/venues').set(o.h)
      .send({ name: venueName, city: 'Hà Nội', rawAddress: 'a' }).expect(201)
  ).body.id;
  const layout = (
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h)
      .send({ name: chartName }).expect(201)
  ).body;
  return { venue, layoutId: layout.id as number };
}

describe('the seat map library', () => {
  it('lists charts from EVERY venue the organizer owns, newest edit first', async () => {
    const o = await organizer();
    await venueWithChart(o, 'Nhà hát A', 'Sơ đồ A');
    const second = await venueWithChart(o, 'Nhà hát B', 'Sơ đồ B');
    // Touch the second so the ordering is not an accident of creation order.
    await request(app).patch(`/api/organizer/layouts/${second.layoutId}`).set(o.h)
      .send({ name: 'Sơ đồ B đã đổi tên' }).expect(200);

    const { layouts } = (await request(app).get('/api/organizer/layouts').set(o.h).expect(200)).body;

    // Each venue gets a default chart at creation, so assert on the ones this test named.
    const named = layouts.filter((l: { name: string }) => l.name.startsWith('Sơ đồ '));
    expect(named).toHaveLength(2);
    expect(named[0].name).toBe('Sơ đồ B đã đổi tên');
    expect(new Set(named.map((l: { venueName: string }) => l.venueName))).toEqual(
      new Set(['Nhà hát A', 'Nhà hát B']),
    );
    expect(named.every((l: { usageCount: number }) => l.usageCount === 0)).toBe(true);
  });

  it('never leaks another organizer’s chart (SEC-04)', async () => {
    const mine = await organizer();
    const theirs = await organizer();
    await venueWithChart(theirs, 'Của người khác', 'Sơ đồ riêng');

    const { layouts } = (await request(app).get('/api/organizer/layouts').set(mine.h).expect(200)).body;
    expect(layouts.find((l: { name: string }) => l.name === 'Sơ đồ riêng')).toBeUndefined();
  });

  it('counts the showtimes selling from a chart, and refuses to archive while they do', async () => {
    const o = await organizer();
    const { venue } = await venueWithChart(o, 'Nhà hát C', 'Sơ đồ C');
    const section = (
      await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)
    ).body.id;
    const layoutId = (
      await pool.query<{ id: number }>(`SELECT layout_id AS id FROM sections WHERE id = $1`, [section])
    ).rows[0].id;
    await request(app).post(`/api/organizer/layouts/${layoutId}/generate-seats`).set(o.h)
      .send({ sectionId: section, rowLabel: 'A', count: 4 }).expect(201);

    const ev = (
      await request(app).post('/api/organizer/events').set(o.h)
        .send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)
    ).body.id;
    const showtime = (
      await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
        .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }] })
        .expect(201)
    ).body.id;
    await bindAndGenerate(o.h, { showtime, layoutId });

    const { layouts } = (await request(app).get('/api/organizer/layouts').set(o.h).expect(200)).body;
    const bound = layouts.find((l: { id: number }) => l.id === layoutId);
    expect(bound.usageCount).toBe(1);

    // The count the library disables its buttons from, and the refusal, must agree.
    await request(app).post(`/api/organizer/layouts/${layoutId}/archive`).set(o.h).expect(409);
  });

  it('archives an unused chart and brings it back as a DRAFT, not as published', async () => {
    const o = await organizer();
    const { layoutId } = await venueWithChart(o, 'Nhà hát D', 'Sơ đồ D');

    expect((await request(app).post(`/api/organizer/layouts/${layoutId}/archive`).set(o.h).expect(200)).body.status)
      .toBe('archived');

    // Restoring to `ready` would put a chart back on sale without passing the publish gate again.
    expect((await request(app).post(`/api/organizer/layouts/${layoutId}/restore`).set(o.h).expect(200)).body.status)
      .toBe('draft');
  });

  it('renames without a version — a relabel is not a geometry conflict', async () => {
    const o = await organizer();
    const { layoutId } = await venueWithChart(o, 'Nhà hát E', 'Tên cũ');

    const renamed = (
      await request(app).patch(`/api/organizer/layouts/${layoutId}`).set(o.h).send({ name: 'Tên mới' }).expect(200)
    ).body;
    expect(renamed.name).toBe('Tên mới');
    // The version is untouched: an open editor's pending save must still be accepted.
    expect(renamed.version).toBe(1);
  });

  it('refuses a duplicate name inside one venue, and another organizer’s chart', async () => {
    const o = await organizer();
    const { venue, layoutId } = await venueWithChart(o, 'Nhà hát F', 'Sơ đồ một');
    await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'Sơ đồ hai' }).expect(201);
    await request(app).patch(`/api/organizer/layouts/${layoutId}`).set(o.h).send({ name: 'Sơ đồ hai' }).expect(409);

    const other = await organizer();
    await request(app).patch(`/api/organizer/layouts/${layoutId}`).set(other.h).send({ name: 'Cướp' }).expect(403);
    await request(app).post(`/api/organizer/layouts/${layoutId}/archive`).set(other.h).expect(403);
  });
});
