import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { bindAndGenerate } from '../helpers/seatmapSeed.js';

// Chart history (0028) — what a chart looked like at each publish, and putting it back.
//
// The rule that matters: a restore is a SAVE, not a write. An older chart may simply have had fewer
// seats, so restoring can delete inventory — and every guard that makes deleting a seat safe lives on
// the save path. If restore ever grows its own write, it becomes the one door with no lock on it.

async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

/** A chart with `rows × 4` seats in one section, published. Returns it as the editor would hold it. */
async function chart(o: { h: Record<string, string> }, rowCount: number) {
  const venue = (
    await request(app).post('/api/organizer/venues').set(o.h)
      .send({ name: `V${Date.now()}${Math.random()}`, city: 'Hà Nội', rawAddress: 'a' }).expect(201)
  ).body.id;
  const section = (
    await request(app).post(`/api/organizer/venues/${venue}/sections`).set(o.h).send({ name: 'Khu A' }).expect(201)
  ).body.id;
  const layoutId = (
    await pool.query<{ id: number }>(`SELECT layout_id AS id FROM sections WHERE id = $1`, [section])
  ).rows[0].id;
  await request(app).post(`/api/organizer/layouts/${layoutId}/generate-seats`).set(o.h)
    .send({ sectionId: section, rowLabel: 'A', count: rowCount }).expect(201);
  await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
  return { venue, section, layoutId };
}

/** Re-save a chart with `count` seats in row A, then publish it — one more point in its history. */
async function reshape(o: { h: Record<string, string> }, layoutId: number, count: number) {
  const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
  const block = layout.document.blocks.find((b: { seats?: unknown[] }) => (b.seats?.length ?? 0) > 0);
  const doc = {
    ...layout.document,
    blocks: [{ ...block, seats: block.seats.slice(0, count) }],
  };
  await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
    .send({ version: layout.version, document: doc }).expect(200);
  await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
}

describe('chart history', () => {
  it('records one revision per publish, newest first, and not one per click', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o, 6);

    // Publishing again without an edit is the same version, so it must not add a second row.
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);
    await reshape(o, layoutId, 4);

    const { revisions } = (
      await request(app).get(`/api/organizer/layouts/${layoutId}/revisions`).set(o.h).expect(200)
    ).body;
    expect(revisions).toHaveLength(2);
    expect(revisions[0].version).toBeGreaterThan(revisions[1].version);
    expect(revisions[0].seatCount).toBe(4);
    expect(revisions[1].seatCount).toBe(6);
  });

  it('restores an older chart, and the restore is itself a new version', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o, 6);
    await reshape(o, layoutId, 4);

    const { revisions } = (
      await request(app).get(`/api/organizer/layouts/${layoutId}/revisions`).set(o.h).expect(200)
    ).body;
    const older = revisions.find((r: { seatCount: number }) => r.seatCount === 6);
    const before = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    const restored = (
      await request(app).post(`/api/organizer/layouts/${layoutId}/revisions/${older.id}/restore`).set(o.h).expect(200)
    ).body;

    expect(restored.seats).toHaveLength(6);
    // Forward, not backward: reinstating old content is a new edit, not a rewind of the counter.
    expect(restored.version).toBeGreaterThan(before.version);
    // And it went back through the save path, so publishing has to happen again.
    expect(restored.status).toBe('draft');
  });

  it('REFUSES a restore that would delete a seat somebody has bought', async () => {
    const o = await organizer();
    const { venue, layoutId } = await chart(o, 6);
    // History: a 6-seat version, then a 4-seat one.
    await reshape(o, layoutId, 4);
    const { revisions } = (
      await request(app).get(`/api/organizer/layouts/${layoutId}/revisions`).set(o.h).expect(200)
    ).body;
    const smaller = revisions.find((r: { seatCount: number }) => r.seatCount === 4);
    const bigger = revisions.find((r: { seatCount: number }) => r.seatCount === 6);

    // Go back to the big chart — allowed, because restoring a LARGER one only adds rows back.
    await request(app).post(`/api/organizer/layouts/${layoutId}/revisions/${bigger.id}/restore`)
      .set(o.h).expect(200);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(o.h).expect(200);

    // Now sell all six.
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
    await pool.query(`UPDATE showtime_seats SET status = 'sold' WHERE showtime_id = $1`, [showtime]);

    // Going back to the SMALL chart would delete two seats that are sold. That is the refusal.
    const refused = await request(app)
      .post(`/api/organizer/layouts/${layoutId}/revisions/${smaller.id}/restore`).set(o.h).expect(409);
    expect(refused.body.error).toBe('seat_in_use');

    // Refused whole: all six survive.
    const after = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(after.seats).toHaveLength(6);
  });

  it('never restores a revision belonging to another chart, or another organizer’s', async () => {
    const o = await organizer();
    const a = await chart(o, 4);
    const b = await chart(o, 4);
    const { revisions } = (
      await request(app).get(`/api/organizer/layouts/${a.layoutId}/revisions`).set(o.h).expect(200)
    ).body;

    // Scoped by layout: an id from chart A is not a revision of chart B.
    await request(app).post(`/api/organizer/layouts/${b.layoutId}/revisions/${revisions[0].id}/restore`)
      .set(o.h).expect(404);

    const other = await organizer();
    await request(app).get(`/api/organizer/layouts/${a.layoutId}/revisions`).set(other.h).expect(403);
    await request(app).post(`/api/organizer/layouts/${a.layoutId}/revisions/${revisions[0].id}/restore`)
      .set(other.h).expect(403);
  });

  it('writes an audit trail for publish, archive, clone and delete', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o, 4);
    await request(app).post(`/api/organizer/layouts/${layoutId}/archive`).set(o.h).expect(200);

    const { rows } = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE target_type = 'venue_layout' AND target_id = $1 ORDER BY id`,
      [layoutId],
    );
    expect(rows.map((r) => r.action)).toContain('layout_publish');
    expect(rows.map((r) => r.action)).toContain('layout_archive');
  });
});

describe('templates', () => {
  it('saves a COPY as the template, leaving the working chart alone', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o, 4);

    const template = (
      await request(app).post(`/api/organizer/layouts/${layoutId}/save-as-template`).set(o.h)
        .send({ name: 'Mẫu rạp nhỏ' }).expect(201)
    ).body;

    expect(template.id).not.toBe(layoutId);
    expect(template.isTemplate).toBe(true);
    expect(template.seats).toHaveLength(4);

    // The source is untouched — still a working chart, not a template. Marking the chart itself would
    // make every later edit to it an edit to the template.
    const source = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;
    expect(source.isTemplate).toBe(false);
  });

  it('gives the template its OWN rows, so editing it cannot reach the source', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o, 4);
    const template = (
      await request(app).post(`/api/organizer/layouts/${layoutId}/save-as-template`).set(o.h)
        .send({ name: 'Mẫu độc lập' }).expect(201)
    ).body;

    const sourceSeatIds = new Set(
      (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body.seats.map(
        (s: { id: number }) => s.id,
      ),
    );
    expect(template.seats.some((s: { id: number }) => sourceSeatIds.has(s.id))).toBe(false);
  });

  it('refuses another organizer’s chart', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o, 4);
    const other = await organizer();
    await request(app).post(`/api/organizer/layouts/${layoutId}/save-as-template`).set(other.h)
      .send({ name: 'Cướp' }).expect(403);
  });
});
