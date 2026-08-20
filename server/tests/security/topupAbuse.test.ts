import { describe, it, expect, beforeEach } from 'vitest';
import { checkSlidingLimit, resetRateLimitStore } from '../../src/middleware/rateLimit.js';

describe('Payment Top-Up Abuse & Hold Extension Defense', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('enforces maximum 5 top-up requests per 10 minutes per user', () => {
    const userId = 402;
    const key = `user:${userId}`;

    // 5 attempts allowed
    for (let i = 1; i <= 5; i++) {
      const check = checkSlidingLimit('wallet:topup', key, 5, 10 * 60 * 1000);
      expect(check.allowed).toBe(true);
      expect(check.count).toBe(i);
    }

    // 6th attempt blocked
    const blocked = checkSlidingLimit('wallet:topup', key, 5, 10 * 60 * 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
