import { afterAll, beforeEach } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { resetHoldRateLimit } from '../../src/modules/holds/holds.throttle.js';

// Integration tests share one Postgres database (the Neon TEST branch). Truncate the
// auth tables before every test so cases don't leak into each other. Runs serially
// (vitest.config: fileParallelism false).
beforeEach(async () => {
  // Auth + catalog tables. event_categories is NOT truncated — it is seed data (0002_catalog.sql).
  await pool.query(
    `TRUNCATE users, wallets, refresh_tokens, password_resets, auth_events, organizers,
             venues, sections, seats, events, showtimes, ticket_tiers, showtime_seats, audit_logs,
             reservations, reservation_items
     RESTART IDENTITY CASCADE`,
  );
  // The hold throttle is process-wide in-memory state (FR-017) — clear it so a spam test cannot
  // poison the next case.
  resetHoldRateLimit();
});

afterAll(async () => {
  await pool.end();
});
