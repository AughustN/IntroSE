import crypto from 'node:crypto';
import { config } from '../config.js';
import type { InteractionTimingPayload, InteractionTimingTicket } from '../../../shared/types/botDefense.js';

const MINIMUM_HUMAN_INTERACTION_MS = 1500; // 1.5s
const MAXIMUM_TICKET_VALIDITY_MS = 30 * 60 * 1000; // 30 minutes

function getTimingSecret(): string {
  return config.serverTimingSecret || config.jwtSecret || 'dev-timing-secret-key-32-chars';
}

function base64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function computeHmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Generates an HMAC-signed timing ticket on seat map presentation.
 * Returns the encoded ticket string and the view timestamp in milliseconds.
 */
export function generateTimingTicket(
  showtimeId: number,
  customTimestamp?: number,
): InteractionTimingTicket {
  const viewTimestamp = customTimestamp ?? Date.now();
  const payload: InteractionTimingPayload = {
    showtimeId,
    viewTimestamp,
  };

  const serialized = JSON.stringify(payload);
  const encodedPayload = base64urlEncode(serialized);
  const signature = computeHmac(`${showtimeId}:${viewTimestamp}`, getTimingSecret());
  const ticket = `${encodedPayload}.${signature}`;

  return {
    ticket,
    viewTimestamp,
  };
}

export interface VerifyTimingResult {
  valid: boolean;
  elapsedMs?: number;
  error?: 'missing_ticket' | 'invalid_format' | 'invalid_signature' | 'showtime_mismatch' | 'ticket_expired' | 'inhuman_interaction_speed';
}

/**
 * Verifies a submitted timing ticket against the showtime and elapsed interaction duration.
 */
export function verifyTimingTicket(
  ticket: string | undefined | null,
  expectedShowtimeId: number,
  nowMs: number = Date.now(),
): VerifyTimingResult {
  if (!ticket || typeof ticket !== 'string') {
    return { valid: false, error: 'missing_ticket' };
  }

  const parts = ticket.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'invalid_format' };
  }

  const [encodedPayload, signature] = parts;

  let payload: InteractionTimingPayload;
  try {
    const decoded = base64urlDecode(encodedPayload);
    payload = JSON.parse(decoded);
  } catch {
    return { valid: false, error: 'invalid_format' };
  }

  const { showtimeId, viewTimestamp } = payload;

  if (typeof showtimeId !== 'number' || typeof viewTimestamp !== 'number') {
    return { valid: false, error: 'invalid_format' };
  }

  if (showtimeId !== expectedShowtimeId) {
    return { valid: false, error: 'showtime_mismatch' };
  }

  const expectedSignature = computeHmac(`${showtimeId}:${viewTimestamp}`, getTimingSecret());
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return { valid: false, error: 'invalid_signature' };
  }

  const elapsedMs = nowMs - viewTimestamp;

  if (elapsedMs < 0 || elapsedMs > MAXIMUM_TICKET_VALIDITY_MS) {
    return { valid: false, error: 'ticket_expired', elapsedMs };
  }

  if (elapsedMs < MINIMUM_HUMAN_INTERACTION_MS) {
    return { valid: false, error: 'inhuman_interaction_speed', elapsedMs };
  }

  return {
    valid: true,
    elapsedMs,
  };
}
