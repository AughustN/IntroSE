import 'dotenv/config';

/** Fail-fast env loading + validation (task T004).
 *  REQUIRED: DATABASE_URL, JWT_SECRET, AUTH_EVENT_HASH_KEY.
 *  Optional / gated: GOOGLE_CLIENT_ID (US3), RESEND_API_KEY (empty → ConsoleMailer). */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '' || v.includes('REPLACE_WITH')) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

// node-pg does not understand libpq's channel_binding param in the URL — strip it.
function normalizeDbUrl(url: string): string {
  return url.replace(/([?&])channel_binding=[^&]*/i, '').replace(/[?&]$/, '');
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',

  databaseUrl: normalizeDbUrl(required('DATABASE_URL')),
  jwtSecret: required('JWT_SECRET'),
  authEventHashKey: required('AUTH_EVENT_HASH_KEY'),

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '', // gated (US3)
  resendApiKey: process.env.RESEND_API_KEY ?? '', // empty → ConsoleMailer
  mailFrom: process.env.MAIL_FROM ?? 'TixHub <no-reply@tixhub.fit>',
} as const;

// ---- Auth constants (decisions from research/ADRs) ----
export const BCRYPT_COST = 12; // SEC-02
export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 min (Q7)
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day sliding (R-3)
export const REFRESH_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day cap (R-12 #6)
export const RESET_TTL_MS = 30 * 60 * 1000; // 30 min (R-3)
export const REFRESH_GRACE_MS = 60 * 1000; // idempotency-keyed grace cap (R-12)
export const REFRESH_COOKIE = 'tix_refresh';
export const JWT_ISS = 'tixhub.fit';
export const JWT_AUD = 'tixhub.fit';

// ---- Seat holds (feature 003). Settings an admin can adjust (UC-36), never hard-coded. ----
const ms = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Hold window from the reservation's first hold (Vision REL-02, FR-006). */
export const HOLD_TTL_MS = ms('HOLD_TTL_MS', 7 * 60 * 1000);
/** One-time grace granted when a wallet top-up carries the reservation (FR-010, schema D2 amendment). */
export const HOLD_GRACE_MS = ms('HOLD_GRACE_MS', 7 * 60 * 1000);
/** Absolute ceiling measured from `reservations.created_at` — the window can never exceed it. */
export const HOLD_ABSOLUTE_MS = ms('HOLD_ABSOLUTE_MS', 14 * 60 * 1000);
/** Tickets one attendee may hold at once for one showtime: seats (seated) or quantity (GA) (FR-016). */
export const SEAT_CAP = ms('SEAT_CAP', 8);
/** How often the release sweep runs. Expiry is exact; the sweep is what acts on it (REL-02). */
export const HOLD_SWEEP_INTERVAL_MS = ms('HOLD_SWEEP_INTERVAL_MS', 60 * 1000);
/** Hold/release requests allowed per user per window — anti hold-spam (FR-017). */
export const HOLD_RATE_LIMIT = ms('HOLD_RATE_LIMIT', 30);
export const HOLD_RATE_WINDOW_MS = ms('HOLD_RATE_WINDOW_MS', 10 * 1000);
