import { describe, it, expect, beforeEach } from 'vitest';
import { generateTimingTicket, verifyTimingTicket } from '../../src/services/timingTicket.js';

describe('Stateless Behavioral Timing Verification', () => {
  const showtimeId = 101;

  it('generates a valid timing ticket for a showtime', () => {
    const { ticket, viewTimestamp } = generateTimingTicket(showtimeId);
    expect(ticket).toBeDefined();
    expect(typeof ticket).toBe('string');
    expect(typeof viewTimestamp).toBe('number');
    expect(viewTimestamp).toBeLessThanOrEqual(Date.now());
  });

  it('rejects an inhumanly fast interaction (< 1500ms)', () => {
    const { ticket } = generateTimingTicket(showtimeId);
    // Verified immediately with 0 elapsed time
    const result = verifyTimingTicket(ticket, showtimeId);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('inhuman_interaction_speed');
  });

  it('accepts a valid ticket after minimum 1500ms elapsed duration', () => {
    // Generate a ticket timestamped 2000ms in the past
    const pastTimestamp = Date.now() - 2000;
    const { ticket } = generateTimingTicket(showtimeId, pastTimestamp);

    const result = verifyTimingTicket(ticket, showtimeId);
    expect(result.valid).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(1500);
  });

  it('rejects a ticket with a forged / mismatched showtimeId', () => {
    const pastTimestamp = Date.now() - 2000;
    const { ticket } = generateTimingTicket(showtimeId, pastTimestamp);

    const result = verifyTimingTicket(ticket, 999); // Different showtime
    expect(result.valid).toBe(false);
    expect(result.error).toBe('showtime_mismatch');
  });

  it('rejects a forged or tampered signature', () => {
    const pastTimestamp = Date.now() - 2000;
    const { ticket } = generateTimingTicket(showtimeId, pastTimestamp);
    const tamperedTicket = ticket.slice(0, -4) + 'abcd';

    const result = verifyTimingTicket(tamperedTicket, showtimeId);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });

  it('rejects an expired timing ticket (> 30 minutes old)', () => {
    const expiredTimestamp = Date.now() - (31 * 60 * 1000);
    const { ticket } = generateTimingTicket(showtimeId, expiredTimestamp);

    const result = verifyTimingTicket(ticket, showtimeId);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('ticket_expired');
  });
});
