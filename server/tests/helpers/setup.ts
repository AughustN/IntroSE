import { afterAll, beforeEach } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { resetAuthThrottle } from '../../src/modules/auth/throttle.js';
import { resetHoldRateLimit } from '../../src/modules/holds/holds.throttle.js';

// Integration tests share one Postgres database (the Neon TEST branch). Truncate the
// auth tables before every test so cases don't leak into each other. Runs serially
// (vitest.config: fileParallelism false).
beforeEach(async () => {
  // Auth + catalog tables. event_categories is NOT truncated — it is seed data (0002_catalog.sql).
  // audit_logs has an append-only trigger (0004) — TRUNCATE is DDL-level, not row-level, so it is
  // not blocked by the BEFORE UPDATE OR DELETE trigger and stays valid for test isolation.
  await pool.query(
    `TRUNCATE users, wallets, refresh_tokens, password_resets, auth_events, organizers,
             venues, sections, seats, events, showtimes, ticket_tiers, showtime_seats, audit_logs,
             reservations, reservation_items,
             content_reports, moderation_actions, moderation_notifications
     RESTART IDENTITY CASCADE`,
  );
  // The hold throttle is process-wide in-memory state (FR-017) — clear it so a spam test cannot
  // poison the next case.
  resetHoldRateLimit();
  // Same for the auth throttle: every case registers users from the same loopback IP, so the
  // per-IP register window would otherwise be shared across a whole file (→ spurious 429s).
  resetAuthThrottle();
});

afterAll(async () => {
  await pool.end();
});
