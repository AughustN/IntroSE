import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function createApprovedOrganizer(name: string) {
  const user = await registerUser();
  const orgId = await makeApprovedOrganizer(user.userId);
  return { ...user, orgId, name };
}

describe('Organizer Workspace Server-Side RBAC & Data Scoping Audit [SEC-04]', () => {
  it('strictly scopes GET /api/organizer/events to the authenticated session user (never leaks cross-organizer events)', async () => {
    const orgA = await createApprovedOrganizer('Organizer A');
    const orgB = await createApprovedOrganizer('Organizer B');

    // Organizer A creates Event A
    const evA = await request(app)
      .post('/api/organizer/events')
      .set(bearer(orgA.token))
      .send({
        title: 'Event Exclusive To A',
        categoryCode: 'music',
        description: 'Description A',
        eventType: 'general_admission',
      })
      .expect(201);

    // Organizer B creates Event B
    const evB = await request(app)
      .post('/api/organizer/events')
      .set(bearer(orgB.token))
      .send({
        title: 'Event Exclusive To B',
        categoryCode: 'workshop',
        description: 'Description B',
        eventType: 'general_admission',
      })
      .expect(201);

    // Query events as Organizer A
    const listA = await request(app)
      .get('/api/organizer/events')
      .set(bearer(orgA.token))
      .expect(200);

    const titlesA = listA.body.map((e: { title: string }) => e.title);
    expect(titlesA).toContain('Event Exclusive To A');
    expect(titlesA).not.toContain('Event Exclusive To B');

    // Query events as Organizer B
    const listB = await request(app)
      .get('/api/organizer/events')
      .set(bearer(orgB.token))
      .expect(200);

    const titlesB = listB.body.map((e: { title: string }) => e.title);
    expect(titlesB).toContain('Event Exclusive To B');
    expect(titlesB).not.toContain('Event Exclusive To A');
  });

  it('strictly scopes GET /api/organizer/analytics/dashboard to session user and ignores spoofed client organizer_id params', async () => {
    const orgA = await createApprovedOrganizer('Organizer A');
    const orgB = await createApprovedOrganizer('Organizer B');

    // Create & Publish Event for Organizer A
    const evA = await request(app)
      .post('/api/organizer/events')
      .set(bearer(orgA.token))
      .send({
        title: 'Analytics Test Event A',
        categoryCode: 'music',
        description: 'Desc A',
        eventType: 'general_admission',
      })
      .expect(201);

    const venueA = await request(app)
      .post('/api/organizer/venues')
      .set(bearer(orgA.token))
      .send({ name: 'Venue A', city: 'TP.HCM', rawAddress: 'Addr A' })
      .expect(201);

    await request(app)
      .post(`/api/organizer/events/${evA.body.id}/showtimes`)
      .set(bearer(orgA.token))
      .send({
        venueId: venueA.body.id,
        startsAt: soon(),
        tiers: [{ label: 'VIP A', price: 500000, totalQuantity: 100 }],
      })
      .expect(201);

    // Fetch analytics as Organizer A
    const analyticsA = await request(app)
      .get('/api/organizer/analytics/dashboard')
      .set(bearer(orgA.token))
      .expect(200);

    expect(analyticsA.body.data.overview.event_counts_by_status).toBeDefined();

    // Fetch analytics as Organizer B (should see 0 for Organizer A's events)
    const analyticsB = await request(app)
      .get('/api/organizer/analytics/dashboard')
      .set(bearer(orgB.token))
      .expect(200);

    expect(analyticsB.body.data.overview.total_tickets_sold).toBe(0);

    // Attempt IDOR parameter spoofing: Organizer B trying to pass Organizer A's orgId as query param
    const spoofedAnalyticsB = await request(app)
      .get(`/api/organizer/analytics/dashboard?organizer_id=${orgA.orgId}&organizerId=${orgA.orgId}`)
      .set(bearer(orgB.token))
      .expect(200);

    // Backend must ignore client-supplied organizer_id and return Organizer B's scoped data (0 tickets)
    expect(spoofedAnalyticsB.body.data.overview.total_tickets_sold).toBe(0);
  });

  it('enforces ownership checks on mutations and prevents cross-organizer modifications (IDOR prevention)', async () => {
    const orgA = await createApprovedOrganizer('Organizer A');
    const orgB = await createApprovedOrganizer('Organizer B');

    const evA = await request(app)
      .post('/api/organizer/events')
      .set(bearer(orgA.token))
      .send({
        title: 'Original Title A',
        categoryCode: 'music',
        description: 'Desc A',
        eventType: 'general_admission',
      })
      .expect(201);

    // Organizer B attempts to edit Organizer A's event -> 403
    await request(app)
      .patch(`/api/organizer/events/${evA.body.id}`)
      .set(bearer(orgB.token))
      .send({ title: 'Hacked Title By B' })
      .expect(403);

    // Organizer B attempts to publish Organizer A's event -> 403
    await request(app)
      .post(`/api/organizer/events/${evA.body.id}/publish`)
      .set(bearer(orgB.token))
      .expect(403);

    // Organizer B attempts to cancel Organizer A's event -> 403
    await request(app)
      .post(`/api/organizer/events/${evA.body.id}/cancel`)
      .set(bearer(orgB.token))
      .send({ reason: "Kiểm tra quyền hủy sự kiện" })
      .expect(403);
  });
});
