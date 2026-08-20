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

    // Assign randomized priority score for fair distribution at drop time
    const priorityScore = Date.now() + Math.floor(Math.random() * 500);
    const item: QueuedUser = { userId, enqueuedAt: Date.now(), priorityScore };
    this.queue.push(item);

    // Sort queue by priority score
    this.queue.sort((a, b) => a.priorityScore - b.priorityScore);

    const position = this.queue.findIndex((q) => q.userId === userId) + 1;
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

const waitingRooms = new Map<number, WaitingRoomState>();

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
}
