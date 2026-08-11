import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { AI_REQUEST_TIMEOUT_MS } from '../../src/config.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
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

const ask = (token: string) =>
  request(app).post('/api/ai/chat').set(bearer(token)).send({ message: 'gợi ý cho tôi' });

/**
 * Every case here asserts the same contract: HTTP 200, a fallback, a notice, and live events.
 *
 * That is Principle III in one sentence — AI degrades, it never blocks — and it is the reason each
 * failure mode gets its own case rather than one representative test. A path that throws instead of
 * falling back is a path that puts an error page in front of someone browsing a catalog.
 */
describe('AI degradation', () => {
  it('falls back when the provider throws (FR-011, SC-004)', async () => {
    await seedVisibleGaEvent();
    const { token } = await registerUser();
    install(
      new FakeAIProvider({
        chat: () => {
          throw new Error('AI provider request failed (500) at https://example.invalid/v1/chat/completions.');
        },
      }),
    );

    const res = await ask(token).expect(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(res.body.message).toContain('Không thể kết nối AI');
    // The operator's reason never reaches the reader.
    expect(JSON.stringify(res.body)).not.toContain('example.invalid');
  });

  it('falls back when the provider returns unparseable output', async () => {
    await seedVisibleGaEvent();
    const { token } = await registerUser();
    install(
      new FakeAIProvider({
        chat: () => {
          throw new Error('AI provider returned invalid JSON.');
        },
      }),
    );

    const res = await ask(token).expect(200);
    expect(res.body.source).toBe('fallback');
  });

  it('falls back when the model answers with nothing usable at all', async () => {
    await seedVisibleGaEvent();
    const { token } = await registerUser();
    install(
      // No events and no prose. The real provider's schema rejects an empty reply, but the service
      // must not depend on that: any implementation of the interface can hand it this.
      new FakeAIProvider({ chat: () => ({ reply: '   ', declined: false, recommendations: [] }) }),
    );

    const res = await ask(token).expect(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.reply.trim()).not.toBe('');
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });

  it('turns an abandoned call into a fallback, and says so honestly (FR-010, FR-011)', async () => {
    await seedVisibleGaEvent();
    const { token } = await registerUser();
    install(
      new FakeAIProvider({
        // Exactly how an aborted fetch rejects. Raised immediately rather than after the real
        // budget: waiting out the clock would add the whole budget to every suite run and would
        // only be testing that `AbortSignal.timeout` works, which is the platform's job. What is
        // ours is that a timeout becomes a fallback and is described as one.
        chat: () => {
          const error = new Error('The operation was aborted due to timeout');
          error.name = 'TimeoutError';
          throw error;
        },
      }),
    );

    const res = await ask(token).expect(200);

    expect(res.body.source).toBe('fallback');
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    // A slow answer is not an unreachable one, and telling a reader "không thể kết nối" when the
    // provider answered perfectly well sends whoever reads it hunting a network fault that is not
    // there.
    expect(res.body.message).toContain('chậm');
    expect(res.body.message).not.toContain('Không thể kết nối');
  });

  it('keeps the configured budget inside a defensible range (PERF-05)', () => {
    // A regression guard, not a spec quote. The specification says roughly eight seconds; the
    // configured gateway serves reasoning models that measured 14–23 s, so the deviation up to 25 s
    // is recorded in specs/008-ai-chatbot/plan.md. What must never come back is the original
    // 60_000 — a full minute of an attendee watching a spinner for a fallback available far sooner.
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('makes no call at all when an admin has switched AI off (FR-011)', async () => {
    await seedVisibleGaEvent();
    const { token, userId } = await registerUser();
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('ai_features_enabled', 'false'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    install(neverCalled());
    const res = await ask(token).expect(200);

    expect(res.body.source).toBe('fallback');
    expect(res.body.message).toContain('AI hiện đang tắt');
    expect(res.body.recommendations.length).toBeGreaterThan(0);

    // Switched off costs the attendee nothing.
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM ai_request_limits WHERE user_id = $1 AND request_count > 0',
      [userId],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('never offers an unavailable event in a fallback (FR-012)', async () => {
    const open = await seedVisibleGaEvent({ title: 'Còn vé' });
    const { token } = await registerUser();
    install(
      new FakeAIProvider({
        chat: () => {
          throw new Error('down');
        },
      }),
    );

    const res = await ask(token).expect(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.recommendations.map((r: { event: { id: number } }) => r.event.id)).toEqual([open.eventId]);
  });
});
