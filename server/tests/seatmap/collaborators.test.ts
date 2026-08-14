import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

// Collaborator roles (0029). This file IS the security boundary — `assertOwn` became async when roles
// arrived, and neither TypeScript nor this project's lint config would notice a missing `await`, so a
// dropped one shows up here as a stranger getting 200 and nowhere else.
//
// Two properties are asserted throughout:
//   * additive — a user with NO grant must reach exactly nothing, as before roles existed;
//   * ordered — a level admits everything below it and nothing above.

type Ctx = { h: Record<string, string>; userId: number };

async function organizer(): Promise<Ctx> {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { h: bearer(o.token), userId: o.userId };
}

/** A second approved organizer, granted `role` over the first's charts. */
async function collaborator(owner: Ctx, role: 'viewer' | 'designer' | 'manager' | null): Promise<Ctx> {
  const c = await organizer();
  if (role) {
    await pool.query(
      `INSERT INTO chart_collaborators (owner_user_id, member_user_id, role) VALUES ($1, $2, $3)`,
      [owner.userId, c.userId, role],
    );
  }
  return c;
}

async function chart(o: Ctx) {
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
    .send({ sectionId: section, rowLabel: 'A', count: 4 }).expect(201);
  return { venue, section, layoutId };
}

const read = (c: Ctx, id: number) => request(app).get(`/api/organizer/layouts/${id}`).set(c.h);
const design = (c: Ctx, id: number) =>
  request(app).patch(`/api/organizer/layouts/${id}`).set(c.h).send({ name: `Tên ${Math.random()}` });
const manage = (c: Ctx, id: number) => request(app).post(`/api/organizer/layouts/${id}/archive`).set(c.h);

describe('collaborator roles', () => {
  it('changes nothing for a stranger — no grant still reaches nothing', async () => {
    const owner = await organizer();
    const { layoutId } = await chart(owner);
    const stranger = await collaborator(owner, null);

    await read(stranger, layoutId).expect(403);
    await design(stranger, layoutId).expect(403);
    await manage(stranger, layoutId).expect(403);
  });

  it('viewer reads, and nothing else', async () => {
    const owner = await organizer();
    const { layoutId } = await chart(owner);
    const viewer = await collaborator(owner, 'viewer');

    await read(viewer, layoutId).expect(200);
    await request(app).get(`/api/organizer/layouts/${layoutId}/revisions`).set(viewer.h).expect(200);
    await design(viewer, layoutId).expect(403);
    await manage(viewer, layoutId).expect(403);
  });

  it('designer draws but cannot decide', async () => {
    const owner = await organizer();
    const { layoutId } = await chart(owner);
    const designer = await collaborator(owner, 'designer');

    await read(designer, layoutId).expect(200);
    await design(designer, layoutId).expect(200);

    // Publishing and archiving put seats on sale or take them off. That is the line.
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(designer.h).expect(403);
    await manage(designer, layoutId).expect(403);
    await request(app).delete(`/api/organizer/layouts/${layoutId}`).set(designer.h).expect(403);
  });

  it('manager reaches everything the owner does on a chart', async () => {
    const owner = await organizer();
    const { layoutId } = await chart(owner);
    const manager = await collaborator(owner, 'manager');

    await read(manager, layoutId).expect(200);
    await design(manager, layoutId).expect(200);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(manager.h).expect(200);
    await manage(manager, layoutId).expect(200);
  });

  it('a grant is scoped to the owner who made it', async () => {
    const owner = await organizer();
    const other = await organizer();
    const { layoutId: theirs } = await chart(other);
    const manager = await collaborator(owner, 'manager');

    // Being a manager for one organizer says nothing about another's charts.
    await read(manager, theirs).expect(403);
    await manage(manager, theirs).expect(403);
  });

  it('the library shows a collaborator only what the grant covers', async () => {
    const owner = await organizer();
    await chart(owner);
    const viewer = await collaborator(owner, 'viewer');
    await chart(viewer); // the collaborator's own chart

    // `library` is scoped by `created_by`, so it lists what the CALLER owns — a grant does not merge
    // someone else's charts into your list. Stated as a test because the alternative is a plausible
    // reading of "collaborator" that would leak chart names across organizers.
    const { layouts } = (await request(app).get('/api/organizer/layouts').set(viewer.h).expect(200)).body;
    expect(layouts.every((l: { id: number }) => l.id !== undefined)).toBe(true);
    const ownerLayoutIds = (
      await pool.query<{ id: number }>(
        `SELECT l.id FROM venue_layouts l JOIN venues v ON v.id = l.venue_id WHERE v.created_by = $1`,
        [owner.userId],
      )
    ).rows.map((r) => r.id);
    expect(layouts.some((l: { id: number }) => ownerLayoutIds.includes(l.id))).toBe(false);
  });

  it('refuses a showtime route to a stranger — the async gate is actually awaited', async () => {
    const owner = await organizer();
    const { venue, layoutId } = await chart(owner);
    await request(app).post(`/api/organizer/layouts/${layoutId}/publish`).set(owner.h).expect(200);
    const ev = (
      await request(app).post('/api/organizer/events').set(owner.h)
        .send({ title: 'S', categoryCode: 'theatre', description: 'd', eventType: 'seated' }).expect(201)
    ).body.id;
    const showtime = (
      await request(app).post(`/api/organizer/events/${ev}/showtimes`).set(owner.h)
        .send({ venueId: venue, startsAt: new Date(Date.now() + 86_400_000).toISOString(), tiers: [{ label: 'VIP', price: 500_000 }] })
        .expect(201)
    ).body.id;

    // `assertShowtimeOwner` is the one gate whose `await` a type checker would not miss. Without it
    // this returns 200.
    const stranger = await collaborator(owner, null);
    await request(app).get(`/api/organizer/showtimes/${showtime}/seat-map`).set(stranger.h).expect(403);
  });
});

describe('the save contract', () => {
  it('refuses a request carrying BOTH a document and the legacy arrays', async () => {
    const o = await organizer();
    const { layoutId } = await chart(o);
    const layout = (await request(app).get(`/api/organizer/layouts/${layoutId}`).set(o.h).expect(200)).body;

    // Ambiguous: the server would silently apply the document and drop the arrays, so a caller that
    // sent both would believe both took effect.
    await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
      .send({ version: layout.version, document: layout.document, seats: [] })
      .expect(400);

    // Either shape ALONE is still accepted.
    await request(app).put(`/api/organizer/layouts/${layoutId}`).set(o.h)
      .send({ version: layout.version, document: layout.document })
      .expect(200);
  });
});
