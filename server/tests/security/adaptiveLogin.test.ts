import { describe, it, expect, beforeEach } from 'vitest';
import { checkSlidingLimit, resetRateLimitStore, normalizeIpKey } from '../../src/middleware/rateLimit.js';

describe('Adaptive Login & Credential Stuffing Defense', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('enforces 15 login attempts per 15-minute sliding window per IP', () => {
    const ip = '192.168.1.50';
    const normalized = normalizeIpKey(ip);

    // Make 15 attempts
    for (let i = 1; i <= 15; i++) {
      const check = checkSlidingLimit('login:ip', normalized, 15, 15 * 60 * 1000);
      expect(check.allowed).toBe(true);
      expect(check.count).toBe(i);
    }

    // 16th attempt must be rejected
    const blocked = checkSlidingLimit('login:ip', normalized, 15, 15 * 60 * 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks consecutive failures and triggers captcha requirement after 3 failures', () => {
    const identifier = 'target.user@example.com';

    // 1st failure
    const f1 = checkSlidingLimit('login:failed:' + identifier, 'count', 3, 15 * 60 * 1000);
    expect(f1.allowed).toBe(true); // < 3

    // 2nd failure
    const f2 = checkSlidingLimit('login:failed:' + identifier, 'count', 3, 15 * 60 * 1000);
    expect(f2.allowed).toBe(true);

    // 3rd failure
    const f3 = checkSlidingLimit('login:failed:' + identifier, 'count', 3, 15 * 60 * 1000);
    expect(f3.allowed).toBe(true);

    // 4th attempt now requires captcha
    const f4 = checkSlidingLimit('login:failed:' + identifier, 'count', 3, 15 * 60 * 1000);
    expect(f4.allowed).toBe(false);
  });
});
