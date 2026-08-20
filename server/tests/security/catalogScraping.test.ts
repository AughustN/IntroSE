import { describe, it, expect, beforeEach } from 'vitest';
import { checkSlidingLimit, resetRateLimitStore, normalizeIpKey } from '../../src/middleware/rateLimit.js';

describe('Public Inventory & Catalog Scraping Defense', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('enforces 60 requests per minute sliding limit for public catalog endpoints', () => {
    const ip = '203.0.113.195';
    const key = normalizeIpKey(ip);

    // Make 60 requests
    for (let i = 1; i <= 60; i++) {
      const check = checkSlidingLimit('catalog:ip', key, 60, 60 * 1000);
      expect(check.allowed).toBe(true);
      expect(check.count).toBe(i);
    }

    // 61st request must be rate limited
    const blocked = checkSlidingLimit('catalog:ip', key, 60, 60 * 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
