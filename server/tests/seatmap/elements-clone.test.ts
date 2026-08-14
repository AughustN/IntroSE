import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LAYOUT_MAX_ELEMENTS } from '../../src/config.js';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { bindAndGenerate } from '../helpers/seatmapSeed.js';

// Non-sellable elements (US5: FR-016..FR-019, SC-009) and reuse (US8: FR-036/FR-037, SC-013).

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function venueOf(o: { h: Record<string, string> }, name = 'V'): Promise<number> {
  return (await request(app).post('/api/organizer/venues').set(o.h).send({ name, city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
}

const element = (patch: Record<string, unknown> = {}) => ({
  kind: 'stage' as const, x: 5000, y: 600, width: 3000, height: 400, rotation: 0, label: 'Sân khấu', ...patch,
});

describe('non-sellable elements (US5)', () => {
  it('a layout full of elements still generates exactly ONE bookable seat per seat (SC-009)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: 6 }).expect(201);

    const current = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h).send({
      version: current.version,
      sections: current.sections,
      categories: current.categories,
      seats: current.seats,
      elements: [
        element(),
        element({ kind: 'aisle', label: 'Lối đi', x: 3000, y: 3000, width: 200, height: 2000 }),
        element({ kind: 'door', label: 'Cửa', x: 800, y: 800, width: 400, height: 150 }),
        element({ kind: 'bar', label: 'Quầy', x: 8000, y: 2000, width: 1200, height: 400 }),
        element({ kind: 'label', label: 'Khu VIP', x: 5000, y: 4000, width: 800, height: 250 }),
      ],
    }).expect(200);

    const ev = (await request(app).post('/api/organizer/events').set(o.h).send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)).body.id;
    const showtime = (await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(o.h)
      .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }] }).expect(201)).body.id;

    await bindAndGenerate(o.h, { showtime, layoutId: layout.id });

    // Five elements on the map, and not one of them became inventory (FR-017).
    const bookable = await pool.query(`SELECT count(*)::int AS c FROM showtime_seats WHERE showtime_id = $1`, [showtime]);
    expect(bookable.rows[0].c).toBe(6);
  });

  it('stores a script-like label as literal text — it is data, never markup (FR-018)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;

    const nasty = '<img src=x onerror=alert(1)>';
    const saved = await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h)
      .send({ version: layout.version, sections: [], categories: [], seats: [], elements: [element({ kind: 'label', label: nasty })] })
      .expect(200);

    // Round-trips byte-for-byte: no stripping, no interpreting. Escaping happens at render.
    expect(saved.body.elements[0].label).toBe(nasty);
  });

  it('a boundary polygon survives a save round-trip through the editor (FR-058)', async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;

    const points = [{ x: 1000, y: 1000 }, { x: 9000, y: 1000 }, { x: 9000, y: 9000 }, { x: 1000, y: 9000 }];
    const saved = await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h)
      .send({ version: layout.version, sections: [], categories: [], seats: [], elements: [element({ kind: 'boundary', label: null, points })] })
      .expect(200);
    expect(saved.body.elements[0].points).toEqual(points);

    // The round-trip is the whole point: the editor GETs, then PUTs back what it was handed. A read
    // that dropped the vertices erased the polygon on the very next save.
    const reread = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    expect(reread.elements[0].points).toEqual(points);

    const resaved = await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h)
      .send({ version: reread.version, sections: reread.sections, categories: reread.categories, seats: reread.seats, elements: reread.elements })
      .expect(200);
    expect(resaved.body.elements[0].points).toEqual(points);
  });

  it(`refuses the element past the ceiling of ${LAYOUT_MAX_ELEMENTS} (FR-019)`, async () => {
    const o = await organizer();
    const venue = await venueOf(o);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'L' }).expect(201)).body;

    const tooMany = Array.from({ length: LAYOUT_MAX_ELEMENTS + 1 }, () => element());
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h)
      .send({ version: layout.version, sections: [], categories: [], seats: [], elements: tooMany })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('element_limit_reached'));
  });
});

describe('clone and template (US8)', () => {
  it('clones seats, sections, elements and alignment as an INDEPENDENT draft (SC-013)', async () => {
    const o = await organizer();
    const source = await venueOf(o, 'Nguồn');
    const target = await venueOf(o, 'Đích');

    const layout = (await request(app).post(`/api/organizer/venues/${source}/layouts`).set(o.h).send({ name: 'Gốc' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${source}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: 4 }).expect(201);

    const withElements = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    await request(app).put(`/api/organizer/layouts/${layout.id}`).set(o.h)
      .send({ version: withElements.version, isTemplate: true, sections: withElements.sections, categories: withElements.categories, seats: withElements.seats, elements: [element()] })
      .expect(200);

    const clone = (await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(o.h)
      .send({ targetVenueId: target, name: 'Bản sao' }).expect(201)).body;

    expect(clone.venueId).toBe(target);
    expect(clone.status).toBe('draft'); // a clone always starts as a draft
    expect(clone.seats).toHaveLength(4);
    expect(clone.sections).toHaveLength(1);
    expect(clone.elements).toHaveLength(1);
    expect(clone.id).not.toBe(layout.id);

    // Editing the clone leaves the source untouched — a copy, never a live link.
    await request(app).put(`/api/organizer/layouts/${clone.id}`).set(o.h)
      .send({ version: clone.version, sections: clone.sections, categories: clone.categories, seats: [], elements: [] })
      .expect(200);

    const sourceAfter = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    expect(sourceAfter.seats).toHaveLength(4);
  });

  it('carries its tables, and each cloned seat still points at its own cloned table', async () => {
    const o = await organizer();
    const source = await venueOf(o, 'Nguồn');
    const target = await venueOf(o, 'Đích');

    const layout = (await request(app).post(`/api/organizer/venues/${source}/layouts`).set(o.h).send({ name: 'Tiệc' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${source}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    const table = (await request(app).post(`/api/organizer/layouts/${layout.id}/tables`).set(o.h)
      .send({ sectionId: section, name: 'Bàn 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 0, seatCount: 6 })
      .expect(201)).body;

    const clone = (await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(o.h)
      .send({ targetVenueId: target, name: 'Bản sao' }).expect(201)).body;

    // A gala layout whose tables were dropped came out as loose seats with nothing to sit at.
    expect(clone.tables).toHaveLength(1);
    expect(clone.tables[0].name).toBe('Bàn 1');
    expect(clone.tables[0].id).not.toBe(table.id);
    expect(clone.seats).toHaveLength(6);

    // Every seat points at the CLONE's table, never back at the source's.
    const clonedTableId = clone.tables[0].id;
    expect(clone.seats.map((s: { tableId: number | null }) => s.tableId)).toEqual(Array(6).fill(clonedTableId));
  });

  it("refuses cloning another organizer's layout (FR-037)", async () => {
    const a = await organizer();
    const venue = await venueOf(a);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(a.h).send({ name: 'A' }).expect(201)).body;

    const b = await organizer();
    const bVenue = await venueOf(b, 'B');
    await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(b.h)
      .send({ targetVenueId: bVenue, name: 'Trộm' })
      .expect(403);
  });

  it("refuses cloning INTO another organizer's venue", async () => {
    const a = await organizer();
    const venue = await venueOf(a);
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(a.h).send({ name: 'A' }).expect(201)).body;

    const b = await organizer();
    const bVenue = await venueOf(b, 'B');
    await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(a.h)
      .send({ targetVenueId: bVenue, name: 'Sang nhà người khác' })
      .expect(403);
  });
});
