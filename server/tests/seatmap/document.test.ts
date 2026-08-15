import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ChartDocument } from '@shared/catalog/seatmap-document.js';
import { CHART_DOCUMENT_SCHEMA, emptyDocument } from '@shared/catalog/seatmap-document.js';
import { LAYOUT_MAX_SEATS } from '../../src/config.js';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { seedEvent, seedShowtime, seedTier } from '../helpers/catalogSeed.js';
import { addBlock, addCategory, addSection, removeBlocks, repackRowLabels, setSeatType } from '@/src/components/seatmap/documentOps.js';

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

describe('a block that carries a colour and a shape', () => {
  it('keeps both through the save, for every kind that draws an element', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    // Colour used to be a shape-only control. It is a property of the BLOCK, and `layout_elements`
    // has carried the column for every kind since 0030 — so a painted stage has to come back painted,
    // not be quietly dropped on the way through the projection.
    let d = emptyDocument();
    d = addBlock(d, 'shape', { x: 2000, y: 2000 }, { geometry: 'circle', color: '#4C9A6B' }).doc;
    d = addBlock(d, 'stage', { x: 5000, y: 500 }, { color: '#D93025' }).doc;
    d = addBlock(d, 'bar', { x: 7000, y: 3000 }).doc;

    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;
    const by = (kind: string) =>
      saved.elements.find((e: { kind: string }) => e.kind === kind) as {
        color: string | null;
        geometry: string | null;
        points: { x: number }[] | null;
      };

    expect(by('boundary').color).toBe('#4C9A6B');
    expect(by('boundary').geometry).toBe('circle');
    // Created from the palette, not drawn by hand — it still arrives with an outline to draw.
    expect(by('boundary').points).toHaveLength(32);
    expect(by('stage').color).toBe('#D93025');
    // Unpainted stays unpainted rather than picking up a default on the way through.
    expect(by('bar').color).toBeNull();
  });

  it('reads back the same colours when the chart is re-opened', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    let d = emptyDocument();
    d = addBlock(d, 'stage', { x: 5000, y: 500 }, { color: '#8A0C24' }).doc;
    await save(o, layout.id, { version: layout.version, document: d }).expect(200);

    const opened = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    expect(opened.elements[0].color).toBe('#8A0C24');
    expect(opened.document.blocks[0].color).toBe('#8A0C24');
  });
});

describe('a block that belongs to no section', () => {
  it('saves its seats with a null section instead of being refused', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    // `seats.section_id` is nullable by design (0007, restated by 0024): a section-less seat is
    // representable in a DRAFT and caught by validation at publish, not by the constraint. The editor
    // could not express it — every new block was resolved into `sections[0]` — so this path had never
    // actually been driven end to end.
    let d = emptyDocument();
    d = addBlock(d, 'single-row', { x: 3000, y: 3000 }, { sectionId: null, categoryId: null }).doc;

    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;
    expect(saved.seats.length).toBeGreaterThan(0);
    expect(saved.seats.every((s: { sectionId: number | null }) => s.sectionId === null)).toBe(true);
    expect(saved.sections).toHaveLength(0);
  });

  it('keeps those seats — and their ids — across a second save', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    let d = emptyDocument();
    d = addBlock(d, 'single-row', { x: 3000, y: 3000 }, { sectionId: null, categoryId: null }).doc;
    const first = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;

    // Identity is carried by the seat id in the document, not by (section, row, number) — so a null
    // section must not turn every save into a delete-and-recreate, which would break a sold ticket.
    const again = (await save(o, layout.id, { version: first.version, document: first.document }).expect(200)).body;
    expect(again.seats.map((s: { id: number }) => s.id).sort()).toEqual(
      first.seats.map((s: { id: number }) => s.id).sort(),
    );
  });

  it('refuses to PUBLISH until they are given one', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    let d = emptyDocument();
    d = addBlock(d, 'single-row', { x: 3000, y: 3000 }, { sectionId: null, categoryId: null }).doc;
    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;

    // The whole point of allowing the draft: it is a draft. Publish is where it has to be resolved.
    const res = await request(app)
      .post(`/api/organizer/layouts/${layout.id}/publish`)
      .set(o.h)
      .send({ version: saved.version });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('seat_without_section');
  });
});

describe('a shape assigned to a section', () => {
  it('still belongs to it after the document is dropped and re-adopted', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    // Drawing the outline of a stand and saying which stand it is, then putting seats inside it, is the
    // ordinary way a venue gets drawn. The assignment lived only in `venue_layouts.document` — so the
    // first table or standing area placed anywhere in the chart, which nulls that column by design,
    // silently detached every shape from its section.
    let d = emptyDocument();
    const sec = addSection(d, 'Khu A');
    d = sec.doc;
    d = addBlock(d, 'shape', { x: 3000, y: 3000 }, { sectionId: sec.id, geometry: 'rect' }).doc;

    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;
    const sectionId = saved.sections[0].id as number;
    expect(saved.elements[0].sectionId).toBe(sectionId);

    await request(app).post(`/api/organizer/layouts/${layout.id}/tables`).set(o.h)
      .send({ sectionId, name: 'Bàn 1', shape: 'round', x: 5000, y: 5000, width: 600, height: 600, rotation: 0, seatCount: 6 })
      .expect(201);

    const reopened = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const shape = reopened.elements.find((e: { kind: string }) => e.kind === 'boundary');
    expect(shape.sectionId).toBe(sectionId);
    // And it comes back on the BLOCK, so the inspector shows it rather than reading "chưa thuộc khu".
    const block = reopened.document.blocks.find((b: { kind: string }) => b.kind === 'shape');
    expect(block.sectionId).toBe(sectionId);
  });

  it('keeps a capacity zone pointed at its price class through the same re-adoption', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    // The same line lost this, and it costs more: a zone's capacity is SOLD against its class's tier,
    // so an unassigned zone is `zone_without_category` and the chart stops being publishable — after a
    // table was placed somewhere else entirely.
    let d = emptyDocument();
    const cat = addCategory(d, 'Sàn');
    d = cat.doc;
    const sec = addSection(d, 'Khu A');
    d = sec.doc;
    d = addBlock(d, 'ga-zone', { x: 4000, y: 4000 }, { categoryId: cat.id }).doc;
    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;
    const categoryId = saved.categories[0].id as number;
    expect(saved.elements[0].categoryId).toBe(categoryId);

    await request(app).post(`/api/organizer/layouts/${layout.id}/tables`).set(o.h)
      .send({ sectionId: saved.sections[0].id, name: 'Bàn 1', shape: 'round', x: 8000, y: 8000, width: 600, height: 600, rotation: 0, seatCount: 6 })
      .expect(201);

    const reopened = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const zone = reopened.elements.find((e: { kind: string }) => e.kind === 'area');
    expect(zone.categoryId).toBe(categoryId);
    expect(zone.capacity).toBeGreaterThan(0);
  });
});

describe('re-lettering rows after a delete', () => {
  /** Two 5×10 blocks in one section: A–E, then F–J. */
  const twoBlocks = () => {
    let d = emptyDocument();
    const sec = addSection(d, 'Khu A');
    d = sec.doc;
    const first = addBlock(d, 'seating-block', { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, 'seating-block', { x: 5000, y: 1000 }, { sectionId: sec.id });
    return { doc: second.doc, first: first.key, second: second.key };
  };

  it('renames the survivors WITHOUT replacing them — same seat ids, new labels', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const c = twoBlocks();

    const saved = (await save(o, layout.id, { version: layout.version, document: c.doc }).expect(200)).body;
    expect(saved.seats).toHaveLength(100);
    const survivors = saved.seats
      .filter((s: { rowLabel: string }) => s.rowLabel >= 'F')
      .map((s: { id: number }) => s.id);
    expect(survivors).toHaveLength(50);

    // Delete A–E and close the gap, exactly as the editor does it.
    const packed = repackRowLabels(removeBlocks(saved.document, new Set([c.first])));
    const after = (await save(o, layout.id, { version: saved.version, document: packed }).expect(200)).body;

    // The safety property: F1 became A1, and it is the SAME ROW — renamed, not replaced. Through
    // `regenerateBlock` every id here would be fresh and the originals would have been deleted.
    expect(after.seats).toHaveLength(50);
    const ids = new Set(after.seats.map((s: { id: number }) => s.id));
    expect(survivors.filter((id: number) => !ids.has(id))).toEqual([]);
    expect([...new Set(after.seats.map((s: { rowLabel: string }) => s.rowLabel))].sort()).toEqual([
      'A', 'B', 'C', 'D', 'E',
    ]);
  });

  it('re-letters a chart a showtime is already selling, without disturbing the tickets', async () => {
    const o = await organizer();
    const { venue, layout } = await freshLayout(o);
    const c = twoBlocks();
    const saved = (await save(o, layout.id, { version: layout.version, document: c.doc }).expect(200)).body;

    // Bind the F–J seats to a showtime, as `generateSeatMap` would. Only those: a seat a showtime has
    // generated from cannot be DELETED, which is a different rule and already has its own test — what
    // is under test here is whether such a seat can be RENAMED.
    const { rows: org } = await pool.query<{ id: number }>(`SELECT id FROM organizers WHERE user_id = $1`, [o.userId]);
    const ev = await seedEvent({ organizerId: org[0].id, eventType: 'seated', category: 'theatre' });
    const showtime = await seedShowtime(ev.id, venue);
    const tier = await seedTier(showtime, { label: 'VIP', price: 500_000, total: null });
    await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, pos_x, pos_y, rotation,
                                   row_label, seat_number, section_name)
       SELECT $1, s.id, $2, 'available', s.pos_x, s.pos_y, s.rotation, s.row_label, s.seat_number, 'Khu A'
         FROM seats s WHERE s.layout_id = $3 AND s.row_label >= 'F'`,
      [showtime, tier, layout.id],
    );

    const packed = repackRowLabels(removeBlocks(saved.document, new Set([c.first])));
    // Not 409. A re-letter that went through `regenerateBlock` would have asked the server to DELETE
    // 50 seats a showtime had generated from, and `seat_in_use` would have refused the whole save.
    const after = (await save(o, layout.id, { version: saved.version, document: packed }).expect(200)).body;
    expect(after.seats).toHaveLength(50);

    // And the showtime is untouched: `showtime_seats` carries its OWN row_label, snapshotted when it
    // bound these seats, so a ticket issued for F1 still says F1 while the chart now calls it A1.
    const { rows } = await pool.query<{ row_label: string; n: string }>(
      `SELECT row_label, COUNT(*)::text AS n FROM showtime_seats WHERE showtime_id = $1
        GROUP BY row_label ORDER BY row_label`,
      [showtime],
    );
    expect(rows.map((r) => r.row_label)).toEqual(['F', 'G', 'H', 'I', 'J']);
  });
});

describe('seat types', () => {
  it('stores a love seat as a love seat, and everything else as single', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);

    // `seats.seat_type` has allowed 'double' since 0002 and nothing in the product could ever write
    // one: the editor had no control, and the projection defaulted every seat to 'single'. So this
    // column had three legal values and two reachable ones.
    const made = addBlock(emptyDocument(), 'single-row', { x: 2000, y: 2000 });
    const key = made.key;
    const refs = made.doc.blocks
      .find((b) => b.key === key)!
      .seats!.slice(0, 2)
      .map((_, index) => ({ blockKey: key, index }));
    const d = setSeatType(made.doc, refs, 'double');

    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;
    const types = saved.seats.map((s: { seatType: string }) => s.seatType);
    expect(types.filter((t: string) => t === 'double')).toHaveLength(2);
    expect(types.filter((t: string) => t === 'single')).toHaveLength(saved.seats.length - 2);

    // And it comes back on the DOCUMENT too, so re-opening the chart shows the control set correctly
    // rather than reporting every seat as ordinary.
    const reopened = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const docSeats = reopened.document.blocks.flatMap((b: { seats?: { seatType?: string }[] }) => b.seats ?? []);
    expect(docSeats.filter((s: { seatType?: string }) => s.seatType === 'double')).toHaveLength(2);
  });
});

describe('rows as first-class objects (0032)', () => {
  const twoBlocks = () => {
    let d = emptyDocument();
    const sec = addSection(d, 'Khu A');
    d = sec.doc;
    const first = addBlock(d, 'seating-block', { x: 1000, y: 1000 }, { sectionId: sec.id });
    d = first.doc;
    const second = addBlock(d, 'seating-block', { x: 5000, y: 1000 }, { sectionId: sec.id });
    return { doc: second.doc, first: first.key, second: second.key };
  };

  it('creates one row per label and points every seat at its own', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const saved = (await save(o, layout.id, { version: layout.version, document: twoBlocks().doc }).expect(200)).body;

    expect(saved.rows.map((r: { label: string }) => r.label).sort()).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    );
    const byLabel = new Map(saved.rows.map((r: { label: string; id: number }) => [r.label, r.id]));
    expect(saved.seats.every((s: { rowLabel: string; rowId: number }) => s.rowId === byLabel.get(s.rowLabel))).toBe(true);
  });

  it('does not create a second set of rows when the same chart is saved again', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const first = (await save(o, layout.id, { version: layout.version, document: twoBlocks().doc }).expect(200)).body;

    // The projection MINTS a placeholder id for every row it derives, so unless those are stitched
    // back into the stored document the second save presents them as new rows again — and
    // `layout_rows_label_idx` refuses with a bare 23505, on the second save of every chart.
    const again = (await save(o, layout.id, { version: first.version, document: first.document }).expect(200)).body;
    expect(again.rows).toHaveLength(10);
    expect(again.rows.map((r: { id: number }) => r.id).sort()).toEqual(
      first.rows.map((r: { id: number }) => r.id).sort(),
    );
  });

  it('renames a row without replacing it', async () => {
    const o = await organizer();
    const { layout } = await freshLayout(o);
    const c = twoBlocks();
    const saved = (await save(o, layout.id, { version: layout.version, document: c.doc }).expect(200)).body;
    const wasF = saved.rows.find((r: { label: string }) => r.label === 'F').id as number;

    // Delete A–E and pull F–J back onto A–E.
    const packed = repackRowLabels(removeBlocks(saved.document, new Set([c.first])));
    const after = (await save(o, layout.id, { version: saved.version, document: packed }).expect(200)).body;

    // The row that was F is the row that is now A. Its id is what anything hung off a row would key
    // on, so a renumber must move the label and nothing else (§12, §42 Rule 1).
    expect(after.rows).toHaveLength(5);
    expect(after.rows.find((r: { id: number }) => r.id === wasF).label).toBe('A');
  });

  it('gives a clone its OWN rows rather than the source’s', async () => {
    const o = await organizer();
    const { venue, layout } = await freshLayout(o);
    // One small block, not two full ones: `cloneLayout` copies seats with one INSERT per seat, so a
    // 100-seat chart is 100 sequential round trips to a remote database and blows the 20 s budget.
    let d = emptyDocument();
    const sec = addSection(d, 'Khu A');
    d = sec.doc;
    d = addBlock(d, 'single-row', { x: 1000, y: 1000 }, { sectionId: sec.id }).doc;
    const saved = (await save(o, layout.id, { version: layout.version, document: d }).expect(200)).body;

    const copyId = (
      await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(o.h)
        .send({ targetVenueId: venue, name: 'Bản sao' }).expect(201)
    ).body.id;
    const copy = (await request(app).get(`/api/organizer/layouts/${copyId}`).set(o.h).expect(200)).body;

    const sourceIds = new Set(saved.rows.map((r: { id: number }) => r.id));
    expect(copy.rows).toHaveLength(1);
    expect(copy.rows.some((r: { id: number }) => sourceIds.has(r.id))).toBe(false);
    // And the copy's seats point at the copy's rows, not the original's.
    const copyIds = new Set(copy.rows.map((r: { id: number }) => r.id));
    expect(copy.seats.every((s: { rowId: number }) => copyIds.has(s.rowId))).toBe(true);
  });
});
