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

export const DEFAULT_SYSTEM_SETTINGS = {
  seat_hold_ttl_minutes: 7,
  topup_grace_minutes: 7,
  absolute_ceiling_minutes: 14,
  max_tickets_per_buyer: 8,
  wallet_topup_min: 5_000,
  wallet_topup_max: 10_000_000,
  wallet_balance_ceiling: 20_000_000,
  ai_features_enabled: true,
} as const;

/** Legacy environment fallbacks remain for process-only consumers. Hold requests use SettingService. */
export const HOLD_TTL_MS = ms('HOLD_TTL_MS', DEFAULT_SYSTEM_SETTINGS.seat_hold_ttl_minutes * 60 * 1000);
export const HOLD_GRACE_MS = ms('HOLD_GRACE_MS', DEFAULT_SYSTEM_SETTINGS.topup_grace_minutes * 60 * 1000);
export const HOLD_ABSOLUTE_MS = ms('HOLD_ABSOLUTE_MS', DEFAULT_SYSTEM_SETTINGS.absolute_ceiling_minutes * 60 * 1000);
export const SEAT_CAP = ms('SEAT_CAP', DEFAULT_SYSTEM_SETTINGS.max_tickets_per_buyer);
/** How often the release sweep runs. Expiry is exact; the sweep is what acts on it (REL-02). */
export const HOLD_SWEEP_INTERVAL_MS = ms('HOLD_SWEEP_INTERVAL_MS', 60 * 1000);
/** Hold/release requests allowed per user per window — anti hold-spam (FR-017). */
export const HOLD_RATE_LIMIT = ms('HOLD_RATE_LIMIT', 30);
export const HOLD_RATE_WINDOW_MS = ms('HOLD_RATE_WINDOW_MS', 10 * 1000);
