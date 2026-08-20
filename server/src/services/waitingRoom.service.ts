import crypto from 'node:crypto';
import { config } from '../config.js';
import type { WaitingRoomJoinResponse, WaitingRoomStatusResponse } from '../../../shared/types/botDefense.js';

export interface WaitingRoomSettings {
  enabled: boolean;
  batchSize: number;
  admissionIntervalMs: number;
  tokenTtlMs: number; // Default: 3 * 60 * 1000 (3 minutes)
}

interface QueuedUser {
  userId: number;
  enqueuedAt: number;
  priorityScore: number;
}

interface AdmittedToken {
  token: string;
  userId: number;
  showtimeId: number;
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
}

class WaitingRoomState {
  showtimeId: number;
  settings: WaitingRoomSettings;
  queue: QueuedUser[] = [];
  admittedTokens = new Map<string, AdmittedToken>(); // Key: token or userId
  userTokenLookup = new Map<number, string>(); // Key: userId -> token
  private timer: NodeJS.Timeout | null = null;
  /** Monotonic arrival counter — see `enqueue`. Never reset while the room lives. */
  private nextTicket = 1;

  constructor(showtimeId: number, settings?: Partial<WaitingRoomSettings>) {
    this.showtimeId = showtimeId;
    this.settings = {
      enabled: true,
      batchSize: 20,
      admissionIntervalMs: 3000,
      tokenTtlMs: 3 * 60 * 1000, // 3 minutes
      ...settings,
    };
    this.startAdmissionLoop();
  }

  startAdmissionLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.processAdmissions(), this.settings.admissionIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(userId: number): WaitingRoomJoinResponse {
    // If user already has a valid admitted token, return it
    const existingTokenStr = this.userTokenLookup.get(userId);
    if (existingTokenStr) {
      const token = this.admittedTokens.get(existingTokenStr);
      if (token && token.expiresAt > Date.now() && !token.consumed) {
        return {
          status: 'admitted',
          queueToken: token.token,
          expiresAt: token.expiresAt,
          showtimeId: this.showtimeId,
        };
      }
    }

    // Check if already in queue
    const existingIdx = this.queue.findIndex((q) => q.userId === userId);
    if (existingIdx !== -1) {
      return {
        status: 'waiting',
        queuePosition: existingIdx + 1,
        estimatedWaitSeconds: Math.ceil(((existingIdx + 1) / this.settings.batchSize) * (this.settings.admissionIntervalMs / 1000)),
        showtimeId: this.showtimeId,
      };
    }

    /*
     * Arrival order, decided by a counter rather than by the clock.
     *
     * This used to add `Math.random() * 500` to `Date.now()` and sort on the result, described as
     * "fair distribution at drop time". It is the opposite of fair: two people who arrive in the
     * same millisecond are ordered by a coin toss, and someone who arrives 400ms later can be
     * placed ahead of someone already waiting. A queue whose whole promise is "you are number N"
     * cannot hand out a number that a later arrival can take.
     *
     * `Date.now()` alone is not enough either — a drop puts dozens of joins inside one millisecond,
     * and ties would fall back to whatever order `sort` happens to produce. The counter is
     * monotonic, so arrival order survives the tie.
     */
    const item: QueuedUser = { userId, enqueuedAt: Date.now(), priorityScore: this.nextTicket++ };
    this.queue.push(item);

    const position = this.queue.length;
    return {
      status: 'waiting',
      queuePosition: position,
      estimatedWaitSeconds: Math.ceil((position / this.settings.batchSize) * (this.settings.admissionIntervalMs / 1000)),
      showtimeId: this.showtimeId,
    };
  }

  processAdmissions() {
    if (this.queue.length === 0) return;

    const toAdmit = this.queue.splice(0, this.settings.batchSize);
    const now = Date.now();
    const expiresAt = now + this.settings.tokenTtlMs;

    for (const user of toAdmit) {
      const tokenString = `qt_${crypto.randomUUID()}_${this.showtimeId}_${user.userId}`;
      const tokenObj: AdmittedToken = {
        token: tokenString,
        userId: user.userId,
        showtimeId: this.showtimeId,
        issuedAt: now,
        expiresAt,
        consumed: false,
      };
      this.admittedTokens.set(tokenString, tokenObj);
      this.userTokenLookup.set(user.userId, tokenString);
      indexQueueToken(tokenString, this.showtimeId);
    }
  }

  getStatus(userId: number): WaitingRoomStatusResponse {
    const existingTokenStr = this.userTokenLookup.get(userId);
    if (existingTokenStr) {
      const token = this.admittedTokens.get(existingTokenStr);
      if (token && token.expiresAt > Date.now() && !token.consumed) {
        return {
          status: 'admitted',
          queueToken: token.token,
          expiresAt: token.expiresAt,
          validitySecondsRemaining: Math.ceil((token.expiresAt - Date.now()) / 1000),
        };
      }
    }

    const pos = this.queue.findIndex((q) => q.userId === userId);
    if (pos !== -1) {
      const position = pos + 1;
      return {
        status: 'waiting',
        queuePosition: position,
        estimatedWaitSeconds: Math.ceil((position / this.settings.batchSize) * (this.settings.admissionIntervalMs / 1000)),
      };
    }

    return { status: 'expired' };
  }

  verifyToken(userId: number, tokenStr: string): { valid: boolean; error?: string } {
    const token = this.admittedTokens.get(tokenStr);
    if (!token) {
      return { valid: false, error: 'invalid_queue_token' };
    }
    if (token.userId !== userId) {
      return { valid: false, error: 'user_mismatch' };
    }
    if (token.showtimeId !== this.showtimeId) {
      return { valid: false, error: 'showtime_mismatch' };
    }
    if (token.expiresAt <= Date.now()) {
      return { valid: false, error: 'queue_token_expired' };
    }
    if (token.consumed) {
      return { valid: false, error: 'token_already_consumed' };
    }
    return { valid: true };
  }

  consumeToken(tokenStr: string): void {
    const token = this.admittedTokens.get(tokenStr);
    if (token) {
      token.consumed = true;
    }
  }
}

/*
 * Every live queue, in this process's memory and nowhere else.
 *
 * That is a real bound on the feature, not an oversight to read past: a restart drops every queue
 * and invalidates every pass in flight, and a second instance behind the same origin would run its
 * own independent queue with its own positions. Neither is fixed here — a shared store means a
 * fifth external integration, which the constitution caps at four (v2.1.0), and the deployment is
 * a single VPS process today, so the second case cannot arise yet.
 *
 * What IS handled is the restart: an orphaned pass no longer resolves in `tokenIndex`, comes back
 * `invalid_queue_token`, and the client treats that like any other gate rejection — it clears the
 * pass and queues again. The buyer loses their place, which is honest, rather than being left
 * pressing a seat that will never hold.
 */
const waitingRooms = new Map<number, WaitingRoomState>();

/*
 * Every live queue token, mapped to the showtime that issued it.
 *
 * `verifyQueueToken` used to answer from `waitingRooms.get(showtimeId)` alone, which made two very
 * different situations indistinguishable and one of them unreachable: a token minted for ANOTHER
 * showtime and a token that never existed both came back as `waiting_room_not_found`, and
 * `verifyToken`'s `showtime_mismatch` branch could never run — it compares the token's showtime
 * against the room it was just looked up in, which is the same number by construction.
 *
 * The index is what tells the two apart, and it is also the seam that keeps `stop()`/`reset` from
 * leaking: a room that goes away takes its tokens out with it.
 */
const tokenIndex = new Map<string, number>();

/** Records a freshly admitted token so `verifyQueueToken` can place it. Called by the room. */
export function indexQueueToken(token: string, showtimeId: number): void {
  tokenIndex.set(token, showtimeId);
}

export function getOrCreateWaitingRoom(
  showtimeId: number,
  settings?: Partial<WaitingRoomSettings>,
): WaitingRoomState {
  let room = waitingRooms.get(showtimeId);
  if (!room) {
    room = new WaitingRoomState(showtimeId, settings);
    waitingRooms.set(showtimeId, room);
  }
  return room;
}

export function setWaitingRoomConfig(
  showtimeId: number,
  settings: Partial<WaitingRoomSettings>,
): void {
  const room = getOrCreateWaitingRoom(showtimeId, settings);
  room.settings = { ...room.settings, ...settings };
  room.startAdmissionLoop();
}

export function joinWaitingRoom(showtimeId: number, userId: number): WaitingRoomJoinResponse {
  const room = getOrCreateWaitingRoom(showtimeId);
  return room.enqueue(userId);
}

export function getWaitingRoomStatus(showtimeId: number, userId: number): WaitingRoomStatusResponse {
  const room = getOrCreateWaitingRoom(showtimeId);
  return room.getStatus(userId);
}

export function verifyQueueToken(
  showtimeId: number,
  userId: number,
  tokenStr: string,
): { valid: boolean; error?: string } {
  const issuedFor = tokenIndex.get(tokenStr);
  if (issuedFor === undefined) {
    // No room holds this string. It was never issued, or the process that issued it has restarted
    // and taken its in-memory queue with it (see the note on `waitingRooms`).
    return { valid: false, error: 'invalid_queue_token' };
  }
  if (issuedFor !== showtimeId) {
    return { valid: false, error: 'showtime_mismatch' };
  }
  const room = waitingRooms.get(showtimeId);
  if (!room) {
    return { valid: false, error: 'waiting_room_not_found' };
  }
  return room.verifyToken(userId, tokenStr);
}

export function consumeQueueToken(showtimeId: number, tokenStr: string): void {
  const room = waitingRooms.get(showtimeId);
  if (room) {
    room.consumeToken(tokenStr);
  }
}

export function resetWaitingRooms(): void {
  waitingRooms.forEach((room) => room.stop());
  waitingRooms.clear();
  tokenIndex.clear();
}
