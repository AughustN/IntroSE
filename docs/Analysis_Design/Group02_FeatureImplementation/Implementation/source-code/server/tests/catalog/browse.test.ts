import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import * as seed from '../helpers/catalogSeed.js';

describe('catalog browse & search (US1)', () => {
  it('lists only visible events — hides draft, pending-review, and suspended-organizer events (SC-004)', async () => {
    await seed.seedVisibleGaEvent({ title: 'Live Concert' });
    const org2 = await seed.seedOrganizer(await seed.seedUser());
    await seed.seedEvent({ organizerId: org2, status: 'draft', moderation: 'pending_review', title: 'Draft One' });
    await seed.seedEvent({ organizerId: org2, status: 'on_sale', moderation: 'pending_review', title: 'Pending One' });
    const orgSusp = await seed.seedOrganizer(await seed.seedUser(), 'suspended');
    await seed.seedEvent({ organizerId: orgSusp, status: 'on_sale', moderation: 'approved', title: 'Suspended Org Event' });

    const res = await request(app).get('/api/events').expect(200);
    const titles = res.body.events.map((e: { title: string }) => e.title);
    expect(titles).toContain('Live Concert');
    expect(titles).not.toContain('Draft One');
    expect(titles).not.toContain('Pending One');
    expect(titles).not.toContain('Suspended Org Event');
  });

  it('filters by category and ranks a title keyword match first (FR-002/003)', async () => {
    await seed.seedVisibleGaEvent({ title: 'Rock Night', category: 'music' });
    await seed.seedVisibleGaEvent({ title: 'Pottery Workshop', category: 'workshop' });

    const byCat = await request(app).get('/api/events?category=workshop').expect(200);
    expect(byCat.body.events.every((e: { category: string }) => e.category === 'workshop')).toBe(true);

    const byQ = await request(app).get('/api/events?q=rock').expect(200);
    expect(byQ.body.events[0].title).toBe('Rock Night');
  });

  it('shows sold-out events labelled and last; availability=available hides them (FR-004, SC-005)', async () => {
    await seed.seedVisibleGaEvent({ title: 'Has Tickets' });
    const org = await seed.seedOrganizer(await seed.seedUser());
    const venue = await seed.seedVenue(await seed.seedUser());
    const ev = await seed.seedEvent({ organizerId: org, title: 'Sold Out Show' });
    const st = await seed.seedShowtime(ev.id, venue);
    await seed.seedTier(st, { total: 10, sold: 10 }); // no remaining → sold out

    const all = await request(app).get('/api/events').expect(200);
    const soldOut = all.body.events.find((e: { title: string }) => e.title === 'Sold Out Show');
    expect(soldOut.soldOut).toBe(true);
    const idxAvail = all.body.events.findIndex((e: { title: string }) => e.title === 'Has Tickets');
    const idxSold = all.body.events.findIndex((e: { title: string }) => e.title === 'Sold Out Show');
    expect(idxAvail).toBeLessThan(idxSold); // available sorted before sold-out

    const avail = await request(app).get('/api/events?availability=available').expect(200);
    expect(avail.body.events.map((e: { title: string }) => e.title)).not.toContain('Sold Out Show');
  });
});
