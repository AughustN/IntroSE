import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import * as seed from '../helpers/catalogSeed.js';

describe('event detail (US2)', () => {
  it('returns full detail by slug with integer VND prices (FR-006, SC-009)', async () => {
    const { slug } = await seed.seedVisibleGaEvent({ title: 'Gala Night' });
    const res = await request(app).get(`/api/events/${slug}`).expect(200);
    expect(res.body.title).toBe('Gala Night');
    expect(res.body.eventType).toBe('general_admission');
    expect(res.body.tiers.length).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.tiers[0].price)).toBe(true);
    expect(res.body.seo.title).toBeTruthy();
  });

  it('404s for a draft slug — never leaks a hidden event (FR-009, SC-004)', async () => {
    const org = await seed.seedOrganizer(await seed.seedUser());
    await seed.seedEvent({ organizerId: org, status: 'draft', moderation: 'pending_review', slug: 'hidden-draft' });
    await request(app).get('/api/events/hidden-draft').expect(404);
  });
});
