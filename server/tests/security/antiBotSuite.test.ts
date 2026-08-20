import { describe, it, expect, beforeEach } from 'vitest';
import { generateTimingTicket, verifyTimingTicket } from '../../src/services/timingTicket.js';
import {
  joinWaitingRoom,
  getWaitingRoomStatus,
  verifyQueueToken,
  resetWaitingRooms,
  setWaitingRoomConfig,
} from '../../src/services/waitingRoom.service.js';
import { normalizeEmail } from '../../src/modules/auth/identifier.js';
import { isDisposableEmail } from '../../src/middleware/emailFilter.js';
import { checkSlidingLimit, resetRateLimitStore, normalizeIpKey } from '../../src/middleware/rateLimit.js';

describe('Anti-Bot Security Suite - End-to-End Validation Scenarios', () => {
  beforeEach(() => {
    resetWaitingRooms();
    resetRateLimitStore();
  });

  describe('Scenario 1: Hot Drop Anti-Scalping & Behavioral Timing', () => {
    const showtimeId = 555;
    const userId = 777;

    it('rejects sub-second automated seat holds (< 1.5s)', () => {
      const { ticket } = generateTimingTicket(showtimeId);
      const verifyResult = verifyTimingTicket(ticket, showtimeId);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toBe('inhuman_interaction_speed');
    });

    it('admits attendees through the Virtual Waiting Room with 3-minute tokens', async () => {
      setWaitingRoomConfig(showtimeId, {
        enabled: true,
        batchSize: 5,
        admissionIntervalMs: 20,
        tokenTtlMs: 3 * 60 * 1000,
      });

      const joinRes = joinWaitingRoom(showtimeId, userId);
      expect(joinRes.status).toBe('waiting');

      await new Promise((r) => setTimeout(r, 40));

      const status = getWaitingRoomStatus(showtimeId, userId);
      expect(status.status).toBe('admitted');
      expect(status.queueToken).toBeDefined();

      const tokenCheck = verifyQueueToken(showtimeId, userId, status.queueToken!);
      expect(tokenCheck.valid).toBe(true);
    });
  });

  describe('Scenario 2: Mass Account Registration & Email Sanitization', () => {
    it('rejects temporary / burner email addresses', () => {
      const disposableEmails = [
        'bot1@tempmail.com',
        'bot2@10minutemail.com',
        'bot3@mailinator.com',
        'bot4@sharklasers.com',
        'bot5@yopmail.com',
      ];
      for (const email of disposableEmails) {
        expect(isDisposableEmail(email)).toBe(true);
      }
    });

    it('canonicalizes alias variations (+tag) to prevent duplicate accounts', () => {
      const base = 'fanclub@gmail.com';
      const alias1 = 'fanclub+1@gmail.com';
      const alias2 = 'fan.club+vip@gmail.com';
      const alias3 = 'fanclub+drop2026@googlemail.com';

      expect(normalizeEmail(alias1)).toBe(base);
      expect(normalizeEmail(alias2)).toBe(base);
      expect(normalizeEmail(alias3)).toBe(base);
    });

    it('enforces IP soft challenge limit after 6 accounts per hour', () => {
      const ip = '198.51.100.42';
      const key = normalizeIpKey(ip);

      for (let i = 1; i <= 6; i++) {
        const check = checkSlidingLimit('register:ip', key, 6, 60 * 60 * 1000);
        expect(check.allowed).toBe(true);
      }

      const blocked = checkSlidingLimit('register:ip', key, 6, 60 * 60 * 1000);
      expect(blocked.allowed).toBe(false);
    });
  });

  describe('Scenario 3: Credential Stuffing & Adaptive Login Defense', () => {
    it('triggers adaptive CAPTCHA requirement on 3rd failed password attempt', () => {
      const accountId = 'user-login-attempt';

      for (let i = 0; i < 3; i++) {
        checkSlidingLimit('login:failed:' + accountId, 'fail', 3, 15 * 60 * 1000);
      }

      // 4th check fails
      const check = checkSlidingLimit('login:failed:' + accountId, 'fail', 3, 15 * 60 * 1000);
      expect(check.allowed).toBe(false);
    });

    it('tightens IP limit to 15 login requests per 15 minutes', () => {
      const ip = '198.51.100.99';
      const key = normalizeIpKey(ip);

      for (let i = 1; i <= 15; i++) {
        expect(checkSlidingLimit('login:ip', key, 15, 15 * 60 * 1000).allowed).toBe(true);
      }

      expect(checkSlidingLimit('login:ip', key, 15, 15 * 60 * 1000).allowed).toBe(false);
    });
  });

  describe('Scenario 4: Public Catalog Scraping & Rate Limits', () => {
    it('throttles rapid scraper bursts beyond 60 requests/min', () => {
      const ip = '203.0.113.88';
      const key = normalizeIpKey(ip);

      for (let i = 1; i <= 60; i++) {
        expect(checkSlidingLimit('catalog:ip', key, 60, 60 * 1000).allowed).toBe(true);
      }

      expect(checkSlidingLimit('catalog:ip', key, 60, 60 * 1000).allowed).toBe(false);
    });
  });

  describe('Scenario 5: Wallet Top-Up Abuse Prevention', () => {
    it('limits top-up creations to 5 requests per 10 minutes', () => {
      const userKey = 'user:9999';

      for (let i = 1; i <= 5; i++) {
        expect(checkSlidingLimit('wallet:topup', userKey, 5, 10 * 60 * 1000).allowed).toBe(true);
      }

      expect(checkSlidingLimit('wallet:topup', userKey, 5, 10 * 60 * 1000).allowed).toBe(false);
    });
  });
});
