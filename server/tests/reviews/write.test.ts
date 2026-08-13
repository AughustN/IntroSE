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

  it('accepts a ticket holder for an event that has not started yet (FR-003a)', async () => {
    const event = await seedFutureEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const res = await post(token, event.eventId, { rating: 5 }).expect(200);
    expect(res.body.rating).toBe(5);
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

/**
 * Many comments, one vote.
 *
 * 0020 allowed one review per person and upserted a second into the first, which silently
 * overwrote whatever they had said. Talking as often as you like is now the point of the section;
 * what stays scarce is the rating, so the average still counts people and not remarks.
 */
describe('many comments, one rating per person per event (FR-004)', () => {
  it('keeps a second comment as a comment, not as an edit of the first', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const first = await post(token, event.eventId, { rating: 2, body: 'Tạm được.' }).expect(200);
    const second = await post(token, event.eventId, { body: 'Nghĩ lại thấy hay.' }).expect(200);

    expect(second.body.id).not.toBe(first.body.id);
    expect(first.body.rating).toBe(2);
    // The stars are already cast, so the later comment carries none and the average cannot move.
    expect(second.body.rating).toBeNull();
    expect(second.body.edited).toBe(false);

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.reviews).toHaveLength(2);
    expect(page.body.summary.rating).toBe(2);
    expect(page.body.summary.reviewCount).toBe(1);
    expect(page.body.summary.commentCount).toBe(2);
  });

  it('drops stars sent with a later comment rather than counting them twice', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    await post(token, event.eventId, { rating: 1, body: 'Chán.' }).expect(200);
    const second = await post(token, event.eventId, { rating: 5, body: 'Đổi ý.' }).expect(200);

    expect(second.body.rating).toBeNull();
    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.summary.rating).toBe(1);
  });

  it('requires stars on the first comment and refuses an empty later one', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    await post(token, event.eventId, { body: 'Không sao nào.' }).expect(400);
    await post(token, event.eventId, { rating: 4 }).expect(200);
    // Rated already: a second comment with neither stars nor text would be an empty row.
    await post(token, event.eventId, {}).expect(400);
  });

  it('leaves exactly one rated row when two first submissions arrive together (SC-003)', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    // A read-then-insert would let both find nothing and both insert a rated row. The partial
    // unique index is what makes this deterministic, and only a concurrent case tells them apart.
    await Promise.all([
      post(token, event.eventId, { rating: 4, body: 'Một.' }),
      post(token, event.eventId, { rating: 5, body: 'Hai.' }),
    ]);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM event_reviews
        WHERE event_id = $1 AND rating IS NOT NULL`,
      [event.eventId],
    );
    expect(rows[0]!.n).toBe('1');
  });
});

/** Replies: the same wall, one level deep, behind the same ticket. */
describe('replying to a comment', () => {
  it('hangs a reply under its parent and leaves the score alone', async () => {
    const event = await seedPastEvent();
    const author = await registerUser();
    await giveTicket(author.userId, event);
    const answerer = await registerUser();
    await giveTicket(answerer.userId, event);

    const parent = await post(author.token, event.eventId, { rating: 5, body: 'Đáng đi.' }).expect(200);
    const reply = await post(answerer.token, event.eventId, {
      body: 'Đồng ý luôn.',
      parentId: parent.body.id,
    }).expect(200);

    expect(reply.body.parentId).toBe(parent.body.id);
    expect(reply.body.rating).toBeNull();

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    // One comment on the wall and a count beside it — a reply is not a second entry on the wall,
    // and it does not ride along with one either.
    expect(page.body.reviews).toHaveLength(1);
    expect(page.body.reviews[0].replies).toBeUndefined();
    expect(page.body.reviews[0].replyCount).toBe(1);

    const thread = await request(app).get(`/api/reviews/${parent.body.id}/replies`).expect(200);
    expect(thread.body.replies.map((r: { body: string }) => r.body)).toEqual(['Đồng ý luôn.']);
    expect(page.body.summary.rating).toBe(5);
    expect(page.body.summary.reviewCount).toBe(1);
    expect(page.body.summary.commentCount).toBe(2);
  });

  it('flattens a reply to a reply onto the comment they are both under', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const parent = await post(token, event.eventId, { rating: 4, body: 'Gốc.' }).expect(200);
    const first = await post(token, event.eventId, { body: 'Trả lời.', parentId: parent.body.id }).expect(200);
    const nested = await post(token, event.eventId, { body: 'Trả lời của trả lời.', parentId: first.body.id }).expect(200);

    expect(nested.body.parentId).toBe(parent.body.id);
    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(page.body.reviews[0].replyCount).toBe(2);
  });

  it('refuses an empty reply, a reply to nothing, and a reply from somebody with no ticket', async () => {
    const event = await seedPastEvent();
    const author = await registerUser();
    await giveTicket(author.userId, event);
    const parent = await post(author.token, event.eventId, { rating: 4, body: 'Gốc.' }).expect(200);

    await post(author.token, event.eventId, { parentId: parent.body.id }).expect(400);
    await post(author.token, event.eventId, { body: 'Ai đó?', parentId: 999_999 }).expect(404);

    const stranger = await registerUser();
    const refused = await post(stranger.token, event.eventId, {
      body: 'Cho tôi nói với.',
      parentId: parent.body.id,
    }).expect(403);
    expect(refused.body.error ?? refused.body.code).toBe('no_ticket');
  });

  it('keeps every reply off the listing and pages the thread on request', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const parent = await post(token, event.eventId, { rating: 4, body: 'Gốc.' }).expect(200);
    for (let i = 1; i <= 5; i += 1) {
      await post(token, event.eventId, { body: `Trả lời ${i}`, parentId: parent.body.id }).expect(200);
    }

    const page = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    const listed = page.body.reviews[0];
    // A count and nothing else: one argument cannot decide the size of everybody else's page.
    expect(listed.replies).toBeUndefined();
    expect(listed.replyCount).toBe(5);

    const first = await request(app)
      .get(`/api/reviews/${parent.body.id}/replies?limit=2`)
      .expect(200);
    expect(first.body.replies.map((r: { body: string }) => r.body)).toEqual(['Trả lời 1', 'Trả lời 2']);
    expect(first.body.hasMore).toBe(true);

    // The cursor is the last reply's id — a millisecond-truncated timestamp cannot address a
    // microsecond-precision column, and every batch used to repeat its first reply because of it.
    const next = await request(app)
      .get(`/api/reviews/${parent.body.id}/replies?limit=2&after=${first.body.replies[1].id}`)
      .expect(200);
    expect(next.body.replies.map((r: { body: string }) => r.body)).toEqual(['Trả lời 3', 'Trả lời 4']);
    expect(next.body.hasMore).toBe(true);

    const last = await request(app)
      .get(`/api/reviews/${parent.body.id}/replies?limit=2&after=${next.body.replies[1].id}`)
      .expect(200);
    expect(last.body.replies.map((r: { body: string }) => r.body)).toEqual(['Trả lời 5']);
    expect(last.body.hasMore).toBe(false);
  });

  it('refuses to hand out the thread of a comment that is not visible', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);
    const parent = await post(token, event.eventId, { rating: 4, body: 'Gốc.' }).expect(200);
    await post(token, event.eventId, { body: 'Dưới nó.', parentId: parent.body.id }).expect(200);

    await pool.query(`UPDATE event_reviews SET status = 'removed' WHERE id = $1`, [parent.body.id]);

    await request(app).get(`/api/reviews/${parent.body.id}/replies`).expect(404);
    await request(app).get(`/api/reviews/999999/replies`).expect(404);
  });

  it('takes the thread with the comment when its author deletes it', async () => {
    const event = await seedPastEvent();
    const { token, userId } = await registerUser();
    await giveTicket(userId, event);

    const parent = await post(token, event.eventId, { rating: 3, body: 'Gốc.' }).expect(200);
    await post(token, event.eventId, { body: 'Dưới nó.', parentId: parent.body.id }).expect(200);

    await request(app).delete(`/api/reviews/${parent.body.id}`).set(bearer(token)).expect(204);

    // A reply reads as nonsense without what it answers, so the parent key cascades.
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM event_reviews WHERE event_id = $1',
      [event.eventId],
    );
    expect(rows[0]!.n).toBe('0');
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
