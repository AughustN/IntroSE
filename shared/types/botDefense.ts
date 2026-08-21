/**
 * Shared Anti-Bot & Threat Defense Contracts
 */

export interface InteractionTimingPayload {
  showtimeId: number;
  viewTimestamp: number;
}

export interface InteractionTimingTicket {
  ticket: string; // Base64url encoded JSON payload + '.' + HMAC-SHA256 signature
  viewTimestamp: number;
}

export type WaitingRoomStatus = 'waiting' | 'admitted' | 'expired' | 'disabled';

export interface WaitingRoomJoinResponse {
  status: WaitingRoomStatus;
  queuePosition?: number;
  estimatedWaitSeconds?: number;
  queueToken?: string;
  expiresAt?: number;
  showtimeId: number;
}

export interface WaitingRoomStatusResponse {
  status: WaitingRoomStatus;
  queuePosition?: number;
  estimatedWaitSeconds?: number;
  queueToken?: string;
  expiresAt?: number;
  validitySecondsRemaining?: number;
}

/*
 * The live waiting-room channel, mirroring `shared/holds/types.ts`'s seat channel.
 *
 * Polling every two seconds is what the room used to run on, and the interval was larger than the
 * thing it was measuring: a batch of twenty is admitted in one instant, and each client then
 * *discovered* that at a random point inside its own two-second window. The spread was wider than
 * any difference the queue positions described, so the order people were let in bore no relation to
 * the order they were shown. Pushing the admission removes that scrambler.
 *
 * One room PER USER, not per showtime: the payload carries a queue pass minted for one buyer, and a
 * showtime-wide room would hand every waiting stranger a working pass.
 */
export const WAITING_ROOM_JOIN_EVENT = 'waitingroom:join';
export const WAITING_ROOM_LEAVE_EVENT = 'waitingroom:leave';
/** Your turn: carries the pass, so the client never has to go back and ask for it. */
export const WAITING_ROOM_ADMIT_EVENT = 'waitingroom:admit';
/** Someone ahead was admitted and the line moved up. */
export const WAITING_ROOM_POSITION_EVENT = 'waitingroom:position';

export const waitingRoomUserRoom = (showtimeId: number, userId: number): string =>
  `waitingroom:${showtimeId}:${userId}`;

export interface WaitingRoomRoomJoin {
  showtimeId: number;
}

export interface WaitingRoomAdmitPush {
  showtimeId: number;
  queueToken: string;
  expiresAt: number;
}

export interface WaitingRoomPositionPush {
  showtimeId: number;
  queuePosition: number;
  estimatedWaitSeconds: number;
}

export interface TurnstileVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  action?: string;
  cdata?: string;
}

export interface LoginAttemptStatus {
  failedAttempts: number;
  requireCaptcha: boolean;
  lockedUntil?: number;
}
