import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { seedEvent, seedShowtime, seedTier } from '../helpers/catalogSeed.js';
import { defaultLayoutOf } from '../helpers/seatmapSeed.js';

// `showtime_seats.seat_id` is a plain `REFERENCES seats(id)` with no ON DELETE clause
// (0002_catalog.sql:129), so `saveLayout`'s "delete the seats not in this save" raises 23503 for any
// seat a showtime has generated inventory from. Until now nothing caught that, and the comment above
// the DELETE claimed the opposite — so a save omitting a bound seat produced a bare 500.
//
// These tests pin the refusal. They matter more than they look: the seat-map document work that
// follows rewrites every seat on every save, so "a bound seat may not be dropped" moves from a latent
// edge case to the rule the whole feature rests on.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/**
 * A venue whose default layout has `count` seats, bound to a showtime that generated inventory.
 *
 * The layout half goes through the API because that is what these tests exercise; the event/showtime/
 * inventory half is inserted directly, the pattern `catalogSeed.ts` establishes. Going through the
 * write API for all of it cost ~10 sequential round trips against the remote test database and blew
 * the 20 s per-test budget every run.
 */
async function liveLayout(o: { h: Record<string, string>; userId: number }, count = 4) {
  const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V', city: 'Hà Nội', rawAddress: 'a' }).expect(201)).body.id;
  const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
  await request(app).post(`/api/organizer/venues/${venue}/seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count }).expect(201);
  const layoutId = await defaultLayoutOf(venue);

  const { rows: org } = await pool.query<{ id: number }>(`SELECT id FROM organizers WHERE user_id = $1`, [o.userId]);
  const ev = await seedEvent({ organizerId: org[0].id, eventType: 'seated', category: 'theatre' });
  const showtime = await seedShowtime(ev.id, venue);
  const tier = await seedTier(showtime, { label: 'VIP', price: 500_000, total: null });

  // One bookable row per layout seat — what `generateSeatMap` would have written.
  await pool.query(
    `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status, pos_x, pos_y, rotation,
                                 row_label, seat_number, section_name)
     SELECT $1, s.id, $2, 'available', s.pos_x, s.pos_y, s.rotation, s.row_label, s.seat_number, 'Khu A'
       FROM seats s WHERE s.layout_id = $3`,
    [showtime, tier, layoutId],
  );
  await pool.query(`UPDATE showtimes SET layout_id = $2 WHERE id = $1`, [showtime, layoutId]);

  return { venue, section, showtime, layoutId };
}

const put = (o: { h: Record<string, string> }, layoutId: number, body: Record<string, unknown>) =>
  request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h).send(body);

describe('a seat a showtime generated from is archived by a save, never destroyed', () => {
  it('takes the seat out of the chart while its row and its bookings survive', async () => {
    const o = await organizer();
    const { showtime, layoutId } = await liveLayout(o, 4);
    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(before.seats).toHaveLength(4);
    const dropped = before.seats[0].id as number;

    // This save used to be refused with 409 `seat_in_use` — which protected the booking and left an
    // organizer who simply wanted the seat gone with nothing they could do about it (§18).
    const saved = await put(o, layoutId, {
      version: before.version,
      sections: before.sections,
      categories: before.categories,
      seats: before.seats.slice(1), // drop one bound seat
      elements: [],
    }).expect(200);

    // Gone from the chart…
    expect(saved.body.seats).toHaveLength(3);
    expect(saved.body.seats.some((s: { id: number }) => s.id === dropped)).toBe(false);

    // …and still in the database, archived, with everything a booking points at intact.
    const row = await pool.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM seats WHERE id = $1`,
      [dropped],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].archived_at).not.toBeNull();

    // The showtime is untouched: it sells from its own snapshot, which still has all four.
    const inv = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM showtime_seats WHERE showtime_id = $1`,
      [showtime],
    );
    expect(inv.rows[0].n).toBe(4);
  });

  it('archives on BINDING, not on sale — an available generated seat counts', async () => {
    const o = await organizer();
    const { layoutId } = await liveLayout(o, 3);
    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    // Every generated seat starts `available`; the FK does not care about status, and neither does this.
    await put(o, layoutId, {
      version: before.version,
      sections: before.sections,
      categories: before.categories,
      seats: [],
      elements: [],
    }).expect(200);

    const rows = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seats WHERE layout_id = $1 AND archived_at IS NOT NULL`,
      [layoutId],
    );
    expect(rows.rows[0].n).toBe(3);
  });

  it('still allows a save that keeps every bound seat, including moving them', async () => {
    const o = await organizer();
    const { layoutId } = await liveLayout(o, 3);
    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    // FR-005: editing a layout is never gated on inventory. Moving a sold seat is allowed here; the
    // showtime keeps its snapshot until an explicit re-apply.
    const saved = await put(o, layoutId, {
      version: before.version,
      sections: before.sections,
      categories: before.categories,
      seats: before.seats.map((s: { x: number }) => ({ ...s, x: s.x + 200 })),
      elements: [],
    }).expect(200);
    expect(saved.body.seats).toHaveLength(3);
    expect(saved.body.seats.map((s: { x: number }) => s.x)).toEqual(
      before.seats.map((s: { x: number }) => s.x + 200),
    );
  });

  it('lets an UNBOUND layout drop seats freely', async () => {
    const o = await organizer();
    const venue = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'V2', city: 'HN', rawAddress: 'a' }).expect(201)).body.id;
    const layout = (await request(app).post(`/api/organizer/venues/${venue}/layouts`).set(o.h).send({ name: 'Nháp' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: 5 }).expect(201);

    const before = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const saved = await put(o, layout.id, {
      version: before.version,
      sections: before.sections,
      categories: before.categories,
      seats: [],
      elements: [],
    }).expect(200);
    expect(saved.body.seats).toHaveLength(0);
  });
});

describe('a clone gets its own seat rows', () => {
  it('gives every cloned seat a fresh id, distinct from the source', async () => {
    const o = await organizer();
    const source = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'Nguồn', city: 'HN', rawAddress: 'a' }).expect(201)).body.id;
    const target = (await request(app).post('/api/organizer/venues').set(o.h).send({ name: 'Đích', city: 'HN', rawAddress: 'a' }).expect(201)).body.id;
    const layout = (await request(app).post(`/api/organizer/venues/${source}/layouts`).set(o.h).send({ name: 'Gốc' }).expect(201)).body;
    const section = (await request(app).post(`/api/organizer/venues/${source}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)).body.id;
    await request(app).post(`/api/organizer/layouts/${layout.id}/generate-seats`).set(o.h).send({ sectionId: section, rowLabel: 'A', count: 4 }).expect(201);

    const before = (await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)).body;
    const clone = (await request(app).post(`/api/organizer/layouts/${layout.id}/clone`).set(o.h)
      .send({ targetVenueId: target, name: 'Bản sao' }).expect(201)).body;

    // The seat-id map added for the document port depends on this being true: a clone that shared ids
    // with its source would let one layout's save delete the other's seats.
    const sourceIds = new Set<number>(before.seats.map((s: { id: number }) => s.id));
    expect(clone.seats).toHaveLength(4);
    for (const s of clone.seats as { id: number }[]) expect(sourceIds.has(s.id)).toBe(false);
  });
});
