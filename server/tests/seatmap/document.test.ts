import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ChartDocument } from '@shared/catalog/seatmap-document.js';
import { CHART_DOCUMENT_SCHEMA, emptyDocument } from '@shared/catalog/seatmap-document.js';
import { LAYOUT_MAX_SEATS } from '../../src/config.js';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { addBlock, addCategory, addSection } from '@/src/components/seatmap/documentOps.js';

// Saving a chart as an authoring DOCUMENT (`venue_layouts.document`), projected one way into the
// normalized rows.
//
// The property every test here circles is the same one: a seat keeps its database row — and therefore
// every `showtime_seats.seat_id` pointing at it — for exactly as long as its label is unchanged. That
// is what lets an organizer re-shape a block without detaching a sold ticket.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

async function freshLayout(o: { h: Record<string, string> }) {
  const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
  const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'Sơ đồ' }).expect(201)).body;
  return { venue, layout };
}

/** A 2 × 3 parametric block, with placeholder ids as the editor would mint them. */
function doc(over: Partial<ChartDocument> = {}, seatsPerRow = 3): ChartDocument {
  return {
    schemaVersion: CHART_DOCUMENT_SCHEMA,
    gridSize: 50,
    sections: [{ id: -1, name: 'Khu A' }],
    categories: [{ id: -2, name: 'VIP', color: '#B3453C' }],
    blocks: [
      {
        key: 'b1',
        kind: 'seating-block',
        title: 'Khu A',
        x: 1000,
        y: 1000,
        rotation: 0,
        width: 500,
        height: 300,
        sectionId: -1,
        categoryId: -2,
        params: { rowsCount: 2, seatsPerRow, seatSpacing: 150, rowSpacing: 150 },
        seats: Array.from({ length: 2 * seatsPerRow }, (_, i) => ({
          seatId: -(100 + i),
          rowLabel: String.fromCharCode(65 + Math.floor(i / seatsPerRow)),
          seatNumber: (i % seatsPerRow) + 1,
          dx: (i % seatsPerRow) * 150,
          dy: Math.floor(i / seatsPerRow) * 150,
          rotation: 0,
        })),
      },
    ],
    ...over,
  };
}

const save = (o: { h: Record<string, string> }, layoutId: number, body: Record<string, unknown>) =>
  request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h).send(body);

describe('a chart saved as a document', () => {
  it('projects into real rows and stores the document with REAL ids, never placeholders', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    const saved = (await save(o, layout.id, { version: layout.version, document: doc() }).expect(200)).body;

    // The projection produced sellable rows.
    expect(saved.seats).toHaveLength(6);
    expect(saved.sections).toHaveLength(1);
    expect(saved.categories).toHaveLength(1);
    expect(saved.seats.every((s: { id: number }) => s.id > 0)).toBe(true);
    // Positions are block origin + offset.
    expect(saved.seats.map((s: { x: number }) => s.x)).toContain(1000);
    expect(saved.seats.map((s: { x: number }) => s.x)).toContain(1300);

    // And the stored document was rewritten with the database's own ids.
    const { rows } = await pool.query<{ document: ChartDocument }>(
      `SELECT document FROM venue_layouts WHERE id = $1`,
      [layout.id],
    );
    const stored = rows[0].document;
    const storedIds = stored.blocks[0].seats!.map((s) => s.seatId);
    expect(storedIds.every((id) => id > 0)).toBe(true);
    expect(new Set(storedIds)).toEqual(new Set(saved.seats.map((s: { id: number }) => s.id)));
    // Section and category placeholders were resolved too.
    expect(saved.document.sections[0].id).toBeGreaterThan(0);
  });

  it('GROWING a block keeps every existing seat row', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const first = (await save(o, layout.id, { version: layout.version, document: doc() }).expect(200)).body;
    const idOf = (seats: { rowLabel: string; seatNumber: number; id: number }[]) =>
      new Map(seats.map((s) => [`${s.rowLabel}${s.seatNumber}`, s.id]));
    const before = idOf(first.seats);

    // Take the STORED document (real ids) and widen the block, as the inspector would.
    const grown: ChartDocument = JSON.parse(JSON.stringify(first.document));
    grown.blocks[0].params!.seatsPerRow = 4;
    grown.blocks[0].seats!.push(
      { seatId: -900, rowLabel: 'A', seatNumber: 4, dx: 450, dy: 0, rotation: 0 },
      { seatId: -901, rowLabel: 'B', seatNumber: 4, dx: 450, dy: 150, rotation: 0 },
    );

    const second = (await save(o, layout.id, { version: first.version, document: grown }).expect(200)).body;
    expect(second.seats).toHaveLength(8);

    const after = idOf(second.seats);
    // The six original labels still point at the SAME rows.
    for (const [label, id] of before) expect(after.get(label)).toBe(id);
    // The two new ones are new rows.
    expect(after.get('A4')).toBeGreaterThan(0);
    expect(before.has('A4')).toBe(false);
  });

  it('saving the same document twice changes nothing but the version', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const first = (await save(o, layout.id, { version: layout.version, document: doc() }).expect(200)).body;
    const second = (await save(o, layout.id, { version: first.version, document: first.document }).expect(200)).body;

    expect(second.seats.map((s: { id: number }) => s.id).sort()).toEqual(
      first.seats.map((s: { id: number }) => s.id).sort(),
    );
    expect(second.version).toBe(first.version + 1);
  });

  it('refuses a stale version, leaving the stored document as the first save left it', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const first = (await save(o, layout.id, { version: layout.version, document: doc() }).expect(200)).body;
    await save(o, layout.id, { version: layout.version, document: doc({}, 5) })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('stale_version'));

    const reread = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    expect(reread.seats).toHaveLength(first.seats.length);
  });

  it('counts the ceiling from the PROJECTION, not from what the client claims', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    // A tiny document whose parameters would project past the ceiling if it were regenerated is not
    // the risk; the risk is a document that literally carries too many seats.
    const huge = doc();
    huge.blocks[0].seats = Array.from({ length: LAYOUT_MAX_SEATS + 1 }, (_, i) => ({
      seatId: -(1000 + i),
      rowLabel: 'A',
      seatNumber: i + 1,
      dx: (i % 60) * 150,
      dy: Math.floor(i / 60) * 150,
      rotation: 0,
    }));
    await save(o, layout.id, { version: layout.version, document: huge })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('seat_limit_reached'));
  });

  it('rejects a malformed document at the boundary rather than storing it', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    // The exact shape that crashed the reference editor's canvas: no `categories`.
    await save(o, layout.id, {
      version: layout.version,
      document: { schemaVersion: 1, gridSize: 50, sections: [], blocks: [] },
    }).expect(400);
    // And a colour that is not a colour, which would land in an SVG `fill`.
    const bad = doc();
    bad.categories[0].color = 'javascript:alert(1)';
    await save(o, layout.id, { version: layout.version, document: bad }).expect(400);
  });
});

describe('a chart that predates documents', () => {
  it('is ADOPTED on read, losslessly, with params absent so nothing can silently relabel it', async () => {
    const o = await organizer();
    const { venue, layout } = await freshLayout(o);
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h)
      .send({ sectionId: section, rowLabel: 'A', count: 5 }).expect(201);

    // No document has ever been written for this layout.
    const { rows } = await pool.query<{ document: unknown }>(`SELECT document FROM venue_layouts WHERE id = $1`, [layout.id]);
    expect(rows[0].document).toBeNull();

    const read = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const document = read.document as ChartDocument;
    expect(document).not.toBeNull();

    // Every seat is present, with its real id, and no block claims to be parametric.
    const docSeats = document.blocks.flatMap((b) => b.seats ?? []);
    expect(docSeats.map((s) => s.seatId).sort()).toEqual(read.seats.map((s: { id: number }) => s.id).sort());
    for (const b of document.blocks) expect(b.params).toBeUndefined();
  });
});

describe('geometry changed outside the document', () => {
  it('forgets the document when a table is placed, and re-adopts on the next read', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    // The document creates the section; asking the venue-level endpoint for one first would land a
    // second "Khu A" on the SAME layout (it resolves to the venue's default, which is this one) and
    // trip `UNIQUE (layout_id, name)`.
    const saved = (await save(o, layout.id, { version: layout.version, document: doc() }).expect(200)).body;
    const section = saved.sections[0].id as number;

    const stored = await pool.query<{ document: unknown }>(`SELECT document FROM venue_layouts WHERE id = $1`, [layout.id]);
    expect(stored.rows[0].document).not.toBeNull();

    await request(app).post(`/api/organizer/layouts/${layout.id}/tables`).set(o.h)
      .send({ sectionId: section, name: 'Bàn 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 0, seatCount: 6 })
      .expect(201);

    // The column is cleared — a table's seats are generated outside the document, so the document no
    // longer describes the layout.
    const after = await pool.query<{ document: unknown }>(`SELECT document FROM venue_layouts WHERE id = $1`, [layout.id]);
    expect(after.rows[0].document).toBeNull();

    // The read still hands the editor a usable document, adopted from the rows — including the table's
    // seats — but the parametric intent is gone. That cost is asserted rather than left to be
    // discovered.
    const read = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const document = read.document as ChartDocument;
    expect(document.blocks.flatMap((b) => b.seats ?? [])).toHaveLength(read.seats.length);
    for (const b of document.blocks) expect(b.params).toBeUndefined();
  });
});

describe('cloning a chart that has a document', () => {
  it('re-points the clone’s document at its OWN rows', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const target = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'Đích', city: 'HN', rawAddress: 'a' }).expect(201)).body.id;
    const first = (await save(o, layout.id, { version: layout.version, document: doc() }).expect(200)).body;
    const sourceSeatIds = new Set<number>(first.seats.map((s: { id: number }) => s.id));

    const clone = (await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(o.h)
      .send({ targetVenueId: target, name: 'Bản sao' }).expect(201)).body;

    const { rows } = await pool.query<{ document: ChartDocument | null }>(
      `SELECT document FROM venue_layouts WHERE id = $1`,
      [clone.id],
    );
    const cloned = rows[0].document;
    expect(cloned).not.toBeNull();

    // Not one of the source's seat ids survives into the clone's document. Without this the clone's
    // first save would delete every seat it has.
    for (const s of cloned!.blocks.flatMap((b) => b.seats ?? [])) {
      expect(sourceSeatIds.has(s.seatId)).toBe(false);
    }
    // And they name the clone's actual rows.
    const cloneSeatIds = new Set<number>(clone.seats.map((s: { id: number }) => s.id));
    for (const s of cloned!.blocks.flatMap((b) => b.seats ?? [])) {
      expect(cloneSeatIds.has(s.seatId)).toBe(true);
    }
  });
});

describe('a chart the editor actually produced', () => {
  it('saves a design built with the editor’s own block operations', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    // Driving `documentOps` rather than a hand-written payload: a fixture that merely RESEMBLES what
    // the editor sends is the kind of test that passes while the product is broken.
    let d = emptyDocument();
    const sec = addSection(d, 'Khu A');
    d = sec.doc;
    const cat = addCategory(d, 'VIP');
    d = cat.doc;
    d = addBlock(d, 'seating-block', { x: 2000, y: 2000 }, { sectionId: sec.id, categoryId: cat.id }).doc;
    d = addBlock(d, 'stage', { x: 5000, y: 500 }).doc;
    d = addBlock(d, 'aisle', { x: 3000, y: 3000 }).doc;
    d = addBlock(d, 'wheelchair', { x: 800, y: 800 }).doc;

    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;
    expect(saved.seats).toHaveLength(50);
    // Every decoration kind the palette offers must survive the round trip, not be reduced to a shape.
    expect(saved.elements.map((e: { kind: string }) => e.kind).sort()).toEqual(['aisle', 'stage', 'wheelchair']);
  });

  it('KEEPS a table’s seats when the chart is saved', async () => {
    const o = await organizer();
    const { venue, layout } = await freshLayout(o);
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${layout.id}/tables`).set(o.h)
      .send({ sectionId: section, name: 'Bàn 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 0, seatCount: 8 })
      .expect(201);

    const opened = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    expect(opened.seats).toHaveLength(8);

    // Saving the chart back UNTOUCHED is the first thing an organizer does after moving anything, and
    // it used to return 200 while silently deleting every seat the table owned — or, once a showtime
    // had bound them, to refuse the save entirely with `seat_in_use`.
    const saved = (await save(o, layout.id, { version: opened.version, document: opened.document }).expect(200)).body;
    expect(saved.seats).toHaveLength(8);
    expect(saved.tables).toHaveLength(1);
    expect(saved.seats.every((s: { tableId: number | null }) => s.tableId !== null)).toBe(true);
  });
});
