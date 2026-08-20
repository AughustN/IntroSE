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
