import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import { giveTicket, seedPastEvent, type SeededEvent } from '../helpers/reviewSeed.js';

/** One reviewer with a ticket, ready to rate. */
async function reviewer(event: SeededEvent) {
  const account = await registerUser();
  await giveTicket(account.userId, event);
  return account;
}

const write = (token: string, eventId: number, rating: number, body?: string) =>
  request(app).post(`/api/events/${eventId}/reviews`).set(bearer(token)).send({ rating, body });

describe('reading reviews', () => {
  it('is open to visitors with no account (FR-011)', async () => {
    const event = await seedPastEvent();
    const author = await reviewer(event);
    await write(author.token, event.eventId, 5, 'Tuyệt vời.').expect(200);

    // No Authorization header at all: a rating exists to inform the next buyer, so requiring an
    // account to read one would defeat the point of collecting it.
    const res = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.summary.rating).toBe(5);
    expect(res.body.viewer).toBeUndefined();
  });

  it('reports an unrated event as unrated, never as zero stars (FR-010)', async () => {
    const event = await seedPastEvent();
    const res = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(res.body.summary.rating).toBeNull();
    expect(res.body.summary.reviewCount).toBe(0);
  });

  it('keeps the average equal to the mean of live reviews throughout (SC-005)', async () => {
    const event = await seedPastEvent();
    const a = await reviewer(event);
    const b = await reviewer(event);
    const c = await reviewer(event);

    const first = await write(a.token, event.eventId, 5).expect(200);
    await write(b.token, event.eventId, 3).expect(200);
    await write(c.token, event.eventId, 1).expect(200);

    const mean = async () =>
      (await request(app).get(`/api/events/${event.eventId}/reviews`)).body.summary;

    expect((await mean()).rating).toBe(3); // (5+3+1)/3
    expect((await mean()).reviewCount).toBe(3);

    // After an edit.
    await request(app).patch(`/api/reviews/${first.body.id}`).set(bearer(a.token)).send({ rating: 1 }).expect(200);
    expect((await mean()).rating).toBeCloseTo(1.7, 1); // (1+3+1)/3

    // After the author withdraws.
    await request(app).delete(`/api/reviews/${first.body.id}`).set(bearer(a.token)).expect(204);
    expect((await mean()).rating).toBe(2); // (3+1)/2
    expect((await mean()).reviewCount).toBe(2);

    // After moderation hides one — a hidden review must stop counting, not merely stop showing.
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM event_reviews WHERE event_id = $1 ORDER BY id LIMIT 1',
      [event.eventId],
    );
    await pool.query(`UPDATE event_reviews SET status = 'removed' WHERE id = $1`, [rows[0]!.id]);
    expect((await mean()).reviewCount).toBe(1);
  });

  it('lists newest first and pages without repeating or losing one (FR-012)', async () => {
    const event = await seedPastEvent();
    for (let i = 0; i < 12; i += 1) {
      const account = await reviewer(event);
      await write(account.token, event.eventId, ((i % 5) + 1), `Nhận xét ${i}`).expect(200);
    }

    const first = await request(app).get(`/api/events/${event.eventId}/reviews?limit=10`).expect(200);
    expect(first.body.reviews).toHaveLength(10);
    expect(first.body.hasMore).toBe(true);

    const oldest = first.body.reviews[9].createdAt;
    const second = await request(app)
      .get(`/api/events/${event.eventId}/reviews?limit=10&before=${encodeURIComponent(oldest)}`)
      .expect(200);
    expect(second.body.reviews).toHaveLength(2);
    expect(second.body.hasMore).toBe(false);

    // Every review exactly once across the two pages — the property an offset would break the
    // moment a thirteenth review arrived between the requests.
    const ids = [...first.body.reviews, ...second.body.reviews].map((r: { id: number }) => r.id);
    expect(new Set(ids).size).toBe(12);

    const dates = first.body.reviews.map((r: { createdAt: string }) => r.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('keeps a review readable once its author is gone (FR-016)', async () => {
    const event = await seedPastEvent();
    const author = await reviewer(event);
    await write(author.token, event.eventId, 4, 'Vẫn còn đây.').expect(200);

    /*
     * The author is detached directly rather than by deleting the account.
     *
     * A real deletion is blocked here by `reservations_user_id_fkey`, which belongs to the checkout
     * schema and is not this feature's to satisfy — writing the test around it would be testing
     * account deletion, which does not exist yet. What this feature owns is the two halves below:
     * the foreign key is declared to detach rather than cascade, and a detached review still reads.
     */
    const fk = await pool.query<{ rule: string }>(
      `SELECT rc.delete_rule AS rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'event_reviews' AND rc.constraint_name LIKE '%user_id%'`,
    );
    // CASCADE here would let an organizer lift a poor rating by persuading one reviewer to close
    // their account, and would make an event's score a function of unrelated account churn.
    expect(fk.rows[0]!.rule).toBe('SET NULL');

    await pool.query('UPDATE event_reviews SET user_id = NULL WHERE event_id = $1', [event.eventId]);

    const res = await request(app).get(`/api/events/${event.eventId}/reviews`).expect(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].author).toBeNull();
    expect(res.body.reviews[0].body).toBe('Vẫn còn đây.');
    expect(res.body.summary.rating).toBe(4);
  });

  it('tells a signed-in reader what they may do, and why not (US4)', async () => {
    const event = await seedPastEvent();
    const eligible = await reviewer(event);
    const stranger = await registerUser();

    const asStranger = await request(app)
      .get(`/api/events/${event.eventId}/reviews`)
      .set(bearer(stranger.token))
      .expect(200);
    expect(asStranger.body.viewer).toEqual({ canReview: false, reason: 'no_ticket', myReview: null });

    const created = await write(eligible.token, event.eventId, 4).expect(200);
    const asAuthor = await request(app)
      .get(`/api/events/${event.eventId}/reviews`)
      .set(bearer(eligible.token))
      .expect(200);
    expect(asAuthor.body.viewer.canReview).toBe(true);
    expect(asAuthor.body.viewer.myReview.id).toBe(created.body.id);
    expect(asAuthor.body.reviews[0].mine).toBe(true);
  });

  it('carries the aggregate on the event detail so the page needs no second call (FR-017)', async () => {
    const event = await seedPastEvent();
    const author = await reviewer(event);
    await write(author.token, event.eventId, 5).expect(200);

    const { rows } = await pool.query<{ slug: string }>('SELECT slug FROM events WHERE id = $1', [
      event.eventId,
    ]);
    const detail = await request(app).get(`/api/events/${rows[0]!.slug}`).expect(200);
    expect(detail.body.rating).toBe(5);
    expect(detail.body.reviewCount).toBe(1);
  });
});
