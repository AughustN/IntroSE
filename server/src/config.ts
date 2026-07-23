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
