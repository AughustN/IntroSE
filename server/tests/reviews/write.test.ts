import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import { giveTicket, seedFutureEvent, seedPastEvent } from '../helpers/reviewSeed.js';

const post = (token: string, eventId: number, body: Record<string, unknown>) =>
  request(app).post(`/api/events/${eventId}/reviews`).set(bearer(token)).send(body);

/**
 * The gate.
 *
 * Every refusal here is the reason a rating on this site is worth reading. They are written before
 * the happy path on purpose: a filter added after a working write path is one somebody can forget
 * to apply, while a write path built behind the filter cannot exist without it.
 */
describe('who may write a review', () => {
  it('accepts a paid ticket holder once the event has started (FR-002)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const res = await post(token, event.eventId, { rating: 4, body: 'Rất đáng đi.' }).expect(200);

    expect(res.body.rating).toBe(4);
    expect(res.body.body).toBe('Rất đáng đi.');
    expect(res.body.edited).toBe(false);
    expect(res.body.author.nickname).toBeTruthy();
  });

  it('refuses somebody with no ticket, naming the rule (FR-002)', async () => {
    const event = await seedPastEvent();
    const { token } = await registerUser();

    const res = await post(token, event.eventId, { rating: 5 }).expect(403);
    expect(res.body.error ?? res.body.code).toBe('no_ticket');
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM event_reviews');
    expect(rows[0]!.n).toBe('0');
  });

  it('refuses a ticket whose order was never paid (FR-003)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event, { paymentStatus: 'pending' });

    await post(token, event.eventId, { rating: 5 }).expect(403);
  });

  it('refuses a voided ticket — a refund takes the standing with it (FR-003)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event, { qrStatus: 'void' });

    await post(token, event.eventId, { rating: 5 }).expect(403);
  });

  it('refuses an event that has not started (FR-003a)', async () => {
    const event = await seedFutureEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const res = await post(token, event.eventId, { rating: 5 }).expect(403);
    expect(res.body.error ?? res.body.code).toBe('event_not_started');
  });

  it('refuses an unauthenticated caller and stores nothing', async () => {
    const event = await seedPastEvent();
    await request(app).post(`/api/events/${event.eventId}/reviews`).send({ rating: 5 }).expect(401);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM event_reviews');
    expect(rows[0]!.n).toBe('0');
  });
});

describe('what a review may contain', () => {
  it('requires a star value — text alone is not a review (FR-006)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    await post(token, event.eventId, { body: 'Hay lắm' }).expect(400);
    await post(token, event.eventId, { rating: 0 }).expect(400);
    await post(token, event.eventId, { rating: 6 }).expect(400);
    await post(token, event.eventId, { rating: 3.5 }).expect(400);
  });

  it('refuses a body over the limit before storing anything (FR-007)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    await post(token, event.eventId, { rating: 4, body: 'x'.repeat(2001) }).expect(400);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM event_reviews');
    expect(rows[0]!.n).toBe('0');
  });

  it('stores a whitespace-only body as nothing at all', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const res = await post(token, event.eventId, { rating: 4, body: '   \n  ' }).expect(200);
    expect(res.body.body).toBeNull();
  });

  it('returns the author\'s characters untouched (FR-008)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    // Escaping on the way in is the classic mistake: it double-escapes anything rendered twice and
    // corrupts text that legitimately contains `<` or `&`. The API must hand back exactly what was
    // typed; encoding belongs at the render boundary, where React does it.
    const body = '<script>alert(1)</script> & <b>đậm</b>';
    const res = await post(token, event.eventId, { rating: 3, body }).expect(200);
    expect(res.body.body).toBe(body);
  });
});

describe('one review per person per event (FR-004)', () => {
  it('edits rather than duplicating on a second submission', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    await post(token, event.eventId, { rating: 2, body: 'Tạm được.' }).expect(200);
    const second = await post(token, event.eventId, { rating: 5, body: 'Nghĩ lại thấy hay.' }).expect(200);

    expect(second.body.rating).toBe(5);
    expect(second.body.edited).toBe(true);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM event_reviews WHERE event_id = $1',
      [event.eventId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('leaves exactly one row when two first submissions arrive together (SC-003)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    // A read-then-insert would let both find nothing and both insert. The unique index is what
    // makes this deterministic, and only a concurrent case can tell the two designs apart.
    await Promise.all([
      post(token, event.eventId, { rating: 4 }),
      post(token, event.eventId, { rating: 5 }),
    ]);

    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM event_reviews WHERE event_id = $1',
      [event.eventId],
    );
    expect(rows[0]!.n).toBe('1');
  });
});

describe('editing and withdrawing your own review (FR-005)', () => {
  it('updates rating and body, and marks the review edited', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);
    const created = await post(token, event.eventId, { rating: 2 }).expect(200);

    const edited = await request(app)
      .patch(`/api/reviews/${created.body.id}`)
      .set(bearer(token))
      .send({ rating: 5, body: 'Đổi ý.' })
      .expect(200);

    expect(edited.body.rating).toBe(5);
    expect(edited.body.edited).toBe(true);
  });

  it('answers 404 — not 403 — on somebody else\'s review', async () => {
    const event = await seedPastEvent();
    const author = await registerUser();
    await giveTicket(author.userId, event);
    const created = await post(author.token, event.eventId, { rating: 4 }).expect(200);

    const stranger = await registerUser();
    // Not found rather than forbidden, so walking ids discloses nothing about which reviews exist.
    await request(app)
      .patch(`/api/reviews/${created.body.id}`)
      .set(bearer(stranger.token))
      .send({ rating: 1 })
      .expect(404);
    await request(app).delete(`/api/reviews/${created.body.id}`).set(bearer(stranger.token)).expect(404);

    const { rows } = await pool.query<{ rating: number }>('SELECT rating FROM event_reviews');
    expect(rows[0]!.rating).toBe(4);
  });

  it('removes the row on the author\'s own withdrawal, and the aggregate with it', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);
    const created = await post(token, event.eventId, { rating: 5 }).expect(200);

    await request(app).delete(`/api/reviews/${created.body.id}`).set(bearer(token)).expect(204);

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.reviews).toHaveLength(0);
    // Unrated again, not zero-star.
    expect(page.body.summary.rating).toBeNull();
  });
});
