import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { AI_REQUEST_LIMIT } from '../../src/config.js';
import { platformWindowStart } from '../../src/modules/ai/ai.repo.js';
import { getSettings } from '../../src/modules/admin/settings.service.js';
import { app } from '../helpers/app.js';
import { bearer, makeApprovedOrganizer, registerUser } from '../helpers/authFixture.js';
import { seedVisibleGaEvent } from '../helpers/catalogSeed.js';
import { FakeAIProvider, neverCalled, useFakeProvider } from '../helpers/fakeAiProvider.js';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

const install = (fake: FakeAIProvider) => {
  restore = useFakeProvider(fake);
  return fake;
};

const answering = () =>
  new FakeAIProvider({
    chat: (context) => ({
      reply: 'Gợi ý đây.',
      declined: false,
      recommendations: [{ eventId: context.candidates[0]!.id, reason: 'ok' }],
    }),
    listing: () => ({
      title: 'Đêm EDM',
      description: 'Mô tả.',
      tags: ['edm'],
      ticketPriceSuggestions: [{ name: 'Sớm', price: 200000 }],
    }),
  });

const ask = (token: string, message: string) =>
  request(app).post('/api/ai/chat').set(bearer(token)).send({ message });

const usedBy = async (userId: number): Promise<number> => {
  const { rows } = await pool.query<{ request_count: number }>(
    'SELECT request_count FROM ai_request_limits WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.request_count ?? 0;
};

describe('AI allowance and platform ceiling', () => {
  it('serves a repeated question from cache without spending the allowance (FR-007, SC-006)', async () => {
    await seedVisibleGaEvent();
    const { token, userId } = await registerUser();
    const fake = install(answering());

    const first = await ask(token, 'cuối tuần có gì').expect(200);
    expect(first.body.source).toBe('ai');
    expect(await usedBy(userId)).toBe(1);

    const second = await ask(token, 'cuối tuần có gì').expect(200);
    expect(second.body.source).toBe('cache');

    // The point of the whole reordering: a cache hit costs no model call, so it costs no allowance.
    expect(fake.chatCalls).toHaveLength(1);
    expect(await usedBy(userId)).toBe(1);
  });

  it('allows AI_REQUEST_LIMIT model-backed requests an hour and refuses the next (FR-008, SC-007)', async () => {
    await seedVisibleGaEvent();
    const { token, userId } = await registerUser();
    install(answering());

    /*
     * The hour is spent up to its last unit in one statement rather than by asking fifty times.
     *
     * The allowance used to be ten and the loop was affordable; at fifty it is fifty HTTP requests,
     * each several round trips to a hosted database, and the test simply ran out of time — a
     * failure that said nothing about the limit it was meant to check. What matters is the
     * boundary: the last unit is served, the one after it is refused, and that is what is exercised
     * here. `window_started_at` is written as the current hour so the row counts as this window's.
     */
    await pool.query(
      `INSERT INTO ai_request_limits (user_id, window_started_at, request_count)
       VALUES ($1, date_trunc('hour', now()), $2)
       ON CONFLICT (user_id) DO UPDATE
         SET window_started_at = EXCLUDED.window_started_at, request_count = EXCLUDED.request_count`,
      [userId, AI_REQUEST_LIMIT - 1],
    );

    const last = await ask(token, 'câu hỏi cuối cùng trong giờ').expect(200);
    expect(last.body.source).toBe('ai');
    expect(await usedBy(userId)).toBe(AI_REQUEST_LIMIT);

    const refused = await ask(token, 'một câu nữa').expect(429);
    expect(refused.body.error ?? refused.body.code).toBe('ai_rate_limited');
    // A refusal spends nothing: the count is still exactly the allowance, not one past it.
    expect(await usedBy(userId)).toBe(AI_REQUEST_LIMIT);
  });

  it('resets at the hour boundary', async () => {
    await seedVisibleGaEvent();
    const { token, userId } = await registerUser();
    install(answering());

    await ask(token, 'câu đầu').expect(200);
    // Age the window by an hour, exactly as the clock would.
    await pool.query(
      `UPDATE ai_request_limits SET window_started_at = date_trunc('hour', now()) - interval '1 hour',
              request_count = $2 WHERE user_id = $1`,
      [userId, AI_REQUEST_LIMIT],
    );

    await ask(token, 'câu sau giờ mới').expect(200);
    expect(await usedBy(userId)).toBe(1);
  });

  it('counts each of two concurrent requests exactly once', async () => {
    await seedVisibleGaEvent();
    const { token, userId } = await registerUser();
    install(answering());

    // Distinct messages so neither can be served from the other's cache entry.
    await Promise.all([ask(token, 'song song A').expect(200), ask(token, 'song song B').expect(200)]);
    expect(await usedBy(userId)).toBe(2);
  });

  it('serves a fallback and makes no call once the platform ceiling is reached (FR-009, SC-008)', async () => {
    await seedVisibleGaEvent();
    const { token, userId } = await registerUser();

    const settings = await getSettings();
    await pool.query(
      `INSERT INTO ai_usage_windows (window_started_at, request_count) VALUES ($1, $2)
       ON CONFLICT (window_started_at) DO UPDATE SET request_count = EXCLUDED.request_count`,
      [platformWindowStart(settings.ai_platform_window_hours), settings.ai_platform_request_ceiling],
    );

    install(neverCalled());
    const res = await ask(token, 'còn gì không').expect(200);

    // A platform ceiling is an operational limit, not the attendee's fault: 200 with suggestions.
    expect(res.body.source).toBe('fallback');
    expect(res.body.message).toContain('giới hạn');
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    // And it costs the attendee nothing, because no call was made on their behalf.
    expect(await usedBy(userId)).toBe(0);
  });

  it('lets the organizer listing assistant share the same allowance and cache (FR-007)', async () => {
    const { token, userId } = await registerUser();
    await makeApprovedOrganizer(userId);
    const fake = install(answering());

    const body = { brief: 'đêm EDM ngoài trời cho sinh viên' };
    const first = await request(app).post('/api/ai/event-assistant').set(bearer(token)).send(body).expect(200);
    expect(first.body.source).toBe('ai');
    expect(await usedBy(userId)).toBe(1);

    const second = await request(app).post('/api/ai/event-assistant').set(bearer(token)).send(body).expect(200);
    expect(second.body.source).toBe('cache');
    expect(fake.listingCalls).toHaveLength(1);
    expect(await usedBy(userId)).toBe(1);
  });
});
