import { createHash, createHmac, randomBytes } from 'node:crypto';
import { config } from '../../config.js';

/** A high-entropy opaque token (refresh / reset). Base64url, 256-bit. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Stored form of a refresh / reset token — SHA-256 hex. The token itself is
 *  high-entropy, so a fast hash is sufficient and a leaked DB yields nothing usable. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Keyed hash of an attempted identifier for auth_events (FR-055): groupable,
 *  never reversible to the email/phone. */
export function hashIdentifier(identifier: string): string {
  return createHmac('sha256', config.authEventHashKey).update(identifier.toLowerCase()).digest('hex');
}
