import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import { seedEvent, seedOrganizer, seedUser, seedVisibleGaEvent } from '../helpers/catalogSeed.js';
import { FakeAIProvider, useFakeProvider } from '../helpers/fakeAiProvider.js';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/**
 * Saved events and view history.
 *
 * These three routes are the personalisation half of UC-10: they are the only writes the AI feature
 * makes, they hold per-user behavioural data, and they are what `categoryContext` reads back. Each
 * is scoped in SQL to the session identity, and that scoping is the property worth pinning — a leak
 * here would hand one attendee another's browsing history through the assistant.
 */
describe('AI personalisation context', () => {
  it('saves and unsaves an event, and lists only this attendee\'s saves (FR-003)', async () => {
    const first = await seedVisibleGaEvent({ title: 'Đêm nhạc A' });
    const second = await seedVisibleGaEvent({ title: 'Đêm nhạc B' });
    const mine = await registerUser();
    const theirs = await registerUser();

    const saved = await request(app).post(`/api/ai/events/${first.slug}/bookmark`).set(bearer(mine.token)).expect(200);
    expect(saved.body.saved).toBe(true);

    // Someone else saves a different event. It must not appear in my list.
    await request(app).post(`/api/ai/events/${second.slug}/bookmark`).set(bearer(theirs.token)).expect(200);

    const list = await request(app).get('/api/ai/bookmarks').set(bearer(mine.token)).expect(200);
    expect(list.body).toEqual([first.slug]);

    // The same call is a toggle, not an idempotent save.
    const unsaved = await request(app).post(`/api/ai/events/${first.slug}/bookmark`).set(bearer(mine.token)).expect(200);
    expect(unsaved.body.saved).toBe(false);
    await request(app).get('/api/ai/bookmarks').set(bearer(mine.token)).expect(200).expect((r) => {
      expect(r.body).toEqual([]);
    });
  });

  it('refuses to save or view an event the public catalog would not show', async () => {
    const org = await seedOrganizer(await seedUser());
    const draft = await seedEvent({ organizerId: org, status: 'draft' });
    const { token } = await registerUser();

    // A draft slug is not an event as far as any signed-in attendee is concerned (SC-004).
    await request(app).post(`/api/ai/events/${draft.slug}/bookmark`).set(bearer(token)).expect(404);
    await request(app).post(`/api/ai/events/${draft.slug}/view`).set(bearer(token)).expect(404);
    await request(app).post('/api/ai/events/khong-ton-tai/view').set(bearer(token)).expect(404);
  });

  it('records a view once per event and moves its timestamp on a revisit', async () => {
    const { slug, eventId } = await seedVisibleGaEvent();
    const { token, userId } = await registerUser();

    await request(app).post(`/api/ai/events/${slug}/view`).set(bearer(token)).expect(204);
    const firstSeen = await viewedAt(userId, eventId);

    await request(app).post(`/api/ai/events/${slug}/view`).set(bearer(token)).expect(204);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM user_event_views WHERE user_id = $1',
      [userId],
    );
    // One row, not two: the primary key is (user_id, event_id) and a revisit is an update.
    expect(rows[0]!.n).toBe('1');
    expect((await viewedAt(userId, eventId)).getTime()).toBeGreaterThanOrEqual(firstSeen.getTime());
  });

  it('feeds saves and views into the context the model is given (UC-10 basic flow)', async () => {
    const { slug } = await seedVisibleGaEvent({ category: 'theatre' });
    const { token } = await registerUser();

    await request(app).post(`/api/ai/events/${slug}/bookmark`).set(bearer(token)).expect(200);
    await request(app).post(`/api/ai/events/${slug}/view`).set(bearer(token)).expect(204);

    const fake = new FakeAIProvider({
      chat: (context) => ({
        reply: 'Có kịch cho bạn.',
        declined: false,
        recommendations: [{ eventId: context.candidates[0]!.id, reason: 'Bạn hay xem kịch.' }],
      }),
    });
    restore = useFakeProvider(fake);

    await request(app).post('/api/ai/chat').set(bearer(token)).send({ message: 'gợi ý đi' }).expect(200);

    // The write endpoints above are not decoration: what they store is what personalises the answer.
    expect(fake.chatCalls[0]!.savedCategories).toEqual(['theatre']);
    expect(fake.chatCalls[0]!.viewedCategories).toEqual(['theatre']);
    expect(fake.chatCalls[0]!.purchasedCategories).toEqual([]);
  });
});

async function viewedAt(userId: number, eventId: number): Promise<Date> {
  const { rows } = await pool.query<{ viewed_at: Date }>(
    'SELECT viewed_at FROM user_event_views WHERE user_id = $1 AND event_id = $2',
    [userId, eventId],
  );
  return rows[0]!.viewed_at;
}
