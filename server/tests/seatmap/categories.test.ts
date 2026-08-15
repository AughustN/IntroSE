import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { bindAndGenerate } from '../helpers/seatmapSeed.js';

// Categories — the chart's price classes, separated from the event's prices.
//
// The invariant that matters most here is the snapshot one: a category is chart-side, a sold ticket
// is showtime-side, and no rename or deletion on the chart may reach a ticket somebody has paid for.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** A venue with one drawn layout: two sections, six seats, and no categories beyond the default. */
async function chart(o: { h: Record<string, string> }) {
  const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
  const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'Sơ đồ' }).expect(201)).body;
  const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
  await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: 6 }).expect(201);
  return { venue, layoutId: layout.id, section };
}

const save = (o: { h: Record<string, string> }, layoutId: number, body: Record<string, unknown>) =>
  request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h).send(body);

describe('categories (chart-side price classes)', () => {
  it('creates a category and assigns seats to it, surviving a save round-trip', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o);
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    // A placeholder id, exactly as the editor mints one for a class drawn this session.
    const saved = (
      await save(o, layoutId, {
        version: current.version,
        sections: current.sections,
        categories: [...current.categories, { id: -1, name: 'VIP', color: '#B3453C' }],
        seats: current.seats.map((s: { seatNumber: number }, i: number) =>
          i < 2 ? { ...s, categoryId: -1 } : s,
        ),
        elements: [],
      }).expect(200)
    ).body;

    const vip = saved.categories.find((c: { name: string }) => c.name === 'VIP');
    expect(vip.id).toBeGreaterThan(0); // the placeholder became a real id
    expect(vip.color).toBe('#B3453C');
    expect(saved.seats.filter((s: { categoryId: number }) => s.categoryId === vip.id)).toHaveLength(2);

    // And it is still there on the next read — the round trip, not just the response.
    const reread = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(reread.seats.filter((s: { categoryId: number }) => s.categoryId === vip.id)).toHaveLength(2);
  });

  it('refuses a category colour that is not a hex value — it ends up in a fill', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o);
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    await save(o, layoutId, {
      version: current.version,
      sections: current.sections,
      categories: [{ id: -1, name: 'Xấu', color: 'javascript:alert(1)' }],
      seats: [],
      elements: [],
    }).expect(400);
  });

  it('ORPHANS seats when a category is deleted, never deletes them', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o);
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(current.categories).toHaveLength(1); // the generator's default class

    const after = (
      await save(o, layoutId, {
        version: current.version,
        sections: current.sections,
        categories: [], // drop every class
        seats: current.seats,
        elements: [],
      }).expect(200)
    ).body;

    // Losing a block of work to a mis-click is unrecoverable; an unclassified seat is a fixable issue.
    expect(after.categories).toHaveLength(0);
    expect(after.seats).toHaveLength(6);
    expect(after.seats.every((s: { categoryId: number | null }) => s.categoryId === null)).toBe(true);

    // …and that IS reported, so it cannot be published unnoticed.
    const { issues } = (await request(app).post(`/api/organizer/layouts/${layoutId}/validate`).set(o.h).expect(200)).body;
    expect(issues.some((i: { code: string }) => i.code === 'seat_without_category')).toBe(true);
  });

  it('publishing is refused while a seat has no class, and allowed once it does', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o);
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    await save(o, layoutId, {
      version: current.version,
      sections: current.sections,
      categories: current.categories,
      seats: current.seats.map((s: object) => ({ ...s, categoryId: null })),
      elements: [],
    }).expect(200);
    const refused = await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(422);
    expect(refused.body.error).toBe('layout_invalid');

    const reread = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    await save(o, layoutId, {
      version: reread.version,
      sections: reread.sections,
      categories: reread.categories,
      seats: reread.seats.map((s: object) => ({ ...s, categoryId: reread.categories[0].id })),
      elements: [],
    }).expect(200);
    const published = await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
    expect(published.body.status).toBe('ready');
  });

  it('returns a published chart to DRAFT when it is edited again', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);

    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(current.status).toBe('ready');

    const edited = (
      await save(o, layoutId, {
        version: current.version,
        sections: current.sections,
        categories: current.categories,
        seats: current.seats,
        elements: [],
      }).expect(200)
    ).body;
    // What is live and what is being worked on are not the same document.
    expect(edited.status).toBe('draft');
  });

  it('a category rename NEVER relabels a seat already generated — the map owns its snapshot', async () => {
    const o = await organizer();
    const { venue, layoutId } = await chart(o);
    const ev = (await request(app).post('/api/organizer/events').set(o.h).send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)).body.id;
    const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
      .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }] }).expect(201)).body.id;

    const { categories } = await bindAndGenerate(o.h, { showtime, layoutId });
    const before = await pool.query<{ category_name: string }>(
      `SELECT DISTINCT category_name FROM showtime_seats WHERE showtime_id = $1`,
      [showtime],
    );
    expect(before.rows[0].category_name).toBe(categories[0].name);

    // Sell one of them, then rename the class on the chart.
    await pool.query(
      `UPDATE showtime_seats SET status = 'sold' WHERE id = (SELECT MIN(id) FROM showtime_seats WHERE showtime_id = $1)`,
      [showtime],
    );
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    await save(o, layoutId, {
      version: current.version,
      sections: current.sections,
      categories: current.categories.map((c: object) => ({ ...c, name: 'Đổi tên hoàn toàn' })),
      seats: current.seats,
      elements: [],
    }).expect(200);

    const after = await pool.query<{ category_name: string }>(
      `SELECT DISTINCT category_name FROM showtime_seats WHERE showtime_id = $1`,
      [showtime],
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].category_name).toBe(categories[0].name); // unchanged
  });

  it("refuses another organizer's chart — a refusal, never a silent no-op (SEC-04)", async () => {
    const owner = await organizer();
    const { layoutId } = await chart(owner);
    const current = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(owner.h).expect(200)).body;

    const intruder = await organizer();
    await save(intruder, layoutId, {
      version: current.version,
      sections: current.sections,
      categories: [{ id: -1, name: 'Của tôi bây giờ', color: '#B3453C' }],
      seats: [],
      elements: [],
    }).expect(403);
  });
});
