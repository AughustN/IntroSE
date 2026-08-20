import { describe, it, expect, beforeEach } from 'vitest';
import {
  joinWaitingRoom,
  getWaitingRoomStatus,
  verifyQueueToken,
  resetWaitingRooms,
  setWaitingRoomConfig,
} from '../../src/services/waitingRoom.service.js';

describe('Virtual Waiting Room Service', () => {
  const showtimeId = 205;
  const userId1 = 1001;
  const userId2 = 1002;

  beforeEach(() => {
    resetWaitingRooms();
    setWaitingRoomConfig(showtimeId, {
      enabled: true,
      batchSize: 1,
      admissionIntervalMs: 50,
      tokenTtlMs: 3 * 60 * 1000, // 3 minutes
    });
  });

  it('enqueues users and assigns queue positions', () => {
    const res1 = joinWaitingRoom(showtimeId, userId1);
    expect(res1.status).toBe('waiting');
    expect(res1.queuePosition).toBe(1);

    const res2 = joinWaitingRoom(showtimeId, userId2);
    expect(res2.status).toBe('waiting');
    expect(res2.queuePosition).toBe(2);
  });

  it('admits users in order and issues 3-minute queue tokens', async () => {
    joinWaitingRoom(showtimeId, userId1);
    joinWaitingRoom(showtimeId, userId2);

    // Wait for first admission interval
    await new Promise((r) => setTimeout(r, 60));

    const status1 = getWaitingRoomStatus(showtimeId, userId1);
    expect(status1.status).toBe('admitted');
    expect(status1.queueToken).toBeDefined();
    expect(status1.expiresAt).toBeGreaterThan(Date.now());

    // Verify token validity
    const tokenCheck = verifyQueueToken(showtimeId, userId1, status1.queueToken!);
    expect(tokenCheck.valid).toBe(true);
  });

  it('rejects queue token when user or showtime does not match', async () => {
    joinWaitingRoom(showtimeId, userId1);
    await new Promise((r) => setTimeout(r, 60));

    const status1 = getWaitingRoomStatus(showtimeId, userId1);
    expect(status1.queueToken).toBeDefined();

    // Mismatched user
    const userMismatch = verifyQueueToken(showtimeId, userId2, status1.queueToken!);
    expect(userMismatch.valid).toBe(false);
    expect(userMismatch.error).toBe('user_mismatch');

    // Mismatched showtime
    const showtimeMismatch = verifyQueueToken(999, userId1, status1.queueToken!);
    expect(showtimeMismatch.valid).toBe(false);
    expect(showtimeMismatch.error).toBe('showtime_mismatch');
  });

  it('rejects expired queue tokens after 3 minutes', async () => {
    setWaitingRoomConfig(showtimeId, {
      enabled: true,
      batchSize: 1,
      admissionIntervalMs: 10,
      tokenTtlMs: 20, // 20ms for test
    });

    joinWaitingRoom(showtimeId, userId1);
    await new Promise((r) => setTimeout(r, 20));

    const status = getWaitingRoomStatus(showtimeId, userId1);
    expect(status.status).toBe('admitted');

    // Wait for token expiry
    await new Promise((r) => setTimeout(r, 30));

    const expiredCheck = verifyQueueToken(showtimeId, userId1, status.queueToken!);
    expect(expiredCheck.valid).toBe(false);
    expect(expiredCheck.error).toBe('queue_token_expired');
  });
});
