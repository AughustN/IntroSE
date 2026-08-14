import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

// Two save refusals, both reported from a real chart.
//
// Seeded to match the dev chart that surfaced them:
//   1 section, 1 category, document NULL (so it is ADOPTED on read),
//   90 seats all in row 'A', seat_number 11..100, pos_x 1500..10000, pos_y 5740.
// The spacing works out at ~95 units against a 100-unit seat diameter, so the seats overlap — which
// should block PUBLISH but must not block a save.

describe('saving a chart adopted from pre-document rows', () => {
  it('round-trips: adopted on read, accepted on save', async () => {
    const o = await registerUser();
    await makeApprovedOrganizer(o.userId);
    const h = bearer(o.token);

    const venue = (
      await request(app).post('/api/organizer/venues').set(h)
        .send({ name: `Repro${Date.now()}`, city: 'Hà Nội', rawAddress: 'a' }).expect(201)
    ).body.id;
    const section = (
      await request(app).post(`/api/organizer/venues/${venue}/sections`).set(h).send({ name: 'Khu A' }).expect(201)
    ).body.id;
    const layoutId = (
      await pool.query<{ id: number }>(`SELECT layout_id AS id FROM sections WHERE id = $1`, [section])
    ).rows[0].id;
    const categoryId = (
      await pool.query<{ id: number }>(
        `INSERT INTO layout_categories (layout_id, name, color) VALUES ($1, 'Khu A', '#D93025') RETURNING id`,
        [layoutId],
      )
    ).rows[0].id;

    // 90 seats spanning the full width, exactly as the dev rows do.
    for (let i = 0; i < 90; i++) {
      const x = Math.round(1500 + (8500 * i) / 89);
      await pool.query(
        `INSERT INTO seats (layout_id, section_id, category_id, row_label, seat_number, seat_type, pos_x, pos_y, rotation)
         VALUES ($1, $2, $3, 'A', $4, 'single', $5, 5740, 0)`,
        [layoutId, section, categoryId, 11 + i, x],
      );
    }
    await pool.query(`UPDATE venue_layouts SET document = NULL WHERE id = $1`, [layoutId]);

    const opened = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(h).expect(200)).body;
    expect(opened.seats).toHaveLength(90);
    expect(opened.document.blocks).toHaveLength(1);

    // The save the editor makes: version + the document it was handed, unchanged.
    const res = await request(app).put(`/api/organizer/layouts/${layoutId}`).set(h)
      .send({ version: opened.version, document: opened.document });
    expect(res.status).toBe(200);
    expect(res.body.seats).toHaveLength(90);
  });

  it('names the DUPLICATE SEAT when two blocks share a row label', async () => {
    const o = await registerUser();
    await makeApprovedOrganizer(o.userId);
    const h = bearer(o.token);
    const venue = (
      await request(app).post('/api/organizer/venues').set(h)
        .send({ name: `Repro2${Date.now()}`, city: 'Hà Nội', rawAddress: 'a' }).expect(201)
    ).body.id;
    const section = (
      await request(app).post(`/api/organizer/venues/${venue}/sections`).set(h).send({ name: 'Khu A' }).expect(201)
    ).body.id;
    const layoutId = (
      await pool.query<{ id: number }>(`SELECT layout_id AS id FROM sections WHERE id = $1`, [section])
    ).rows[0].id;
    const opened = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(h).expect(200)).body;

    // Hand-built on purpose: `addBlock` now shifts a new block's lettering past the section's existing
    // rows, so the editor cannot produce this. What is under test is the REFUSAL — this collision used
    // to come back as `layout_name_taken` \"a name is duplicated\", on a chart with no name conflict in
    // it and nothing for the organizer to look for.
    const seatsOf = (n: number) =>
      Array.from({ length: 10 }, (_, i) => ({
        seatId: -(n * 100 + i + 1),
        rowLabel: 'A',
        seatNumber: i + 1,
        dx: i * 150,
        dy: 0,
        rotation: 0,
      }));
    const block = (key: string, x: number, n: number) => ({
      key, kind: 'seating-block', title: 'Khối ghế', x, y: 2000, rotation: 0,
      width: 900, height: 750, sectionId: section, categoryId: null,
      params: { rowsCount: 1, seatsPerRow: 10, seatSpacing: 150, rowSpacing: 150 },
      seats: seatsOf(n),
    });

    const doc = { ...opened.document, blocks: [block('b-1', 1000, 1), block('b-2', 4000, 2)] };
    const res = await request(app).put(`/api/organizer/layouts/${layoutId}`).set(h)
      .send({ version: opened.version, document: doc });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_seat_label');
    expect(res.body.message).toContain('hàng');
  });
});
