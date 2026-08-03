import { afterAll, beforeEach } from "vitest";
import { pool } from "../../src/db/pool.js";
import { assertNotDemoBranch } from "../../src/db/guards.js";
import { resetHoldRateLimit } from "../../src/modules/holds/holds.throttle.js";

// Which database this suite truncates is decided in config.ts: under vitest, `config.databaseUrl`
// resolves from TEST_DATABASE_URL and never falls back to DATABASE_URL. The guard below is the
// second line of defence, for the case where TEST_DATABASE_URL is itself set to the demo branch.
assertNotDemoBranch("The test suite");

// Integration tests share one Postgres database (the Neon TEST branch). Truncate the
// auth tables before every test so cases don't leak into each other. Runs serially
// (vitest.config: fileParallelism false).
beforeEach(async () => {
  // Auth + catalog tables. event_categories is NOT truncated — it is seed data (0002_catalog.sql).
  await pool.query(
    `TRUNCATE users, wallets, refresh_tokens, password_resets, auth_events, organizers,
             venues, sections, seats, events, showtimes, ticket_tiers, showtime_seats, audit_logs,
             reservations, reservation_items, orders, payment_transactions, tickets, wallet_transactions
     RESTART IDENTITY CASCADE`,
  );
  // The hold throttle is process-wide in-memory state (FR-017) — clear it so a spam test cannot
  // poison the next case.
  resetHoldRateLimit();
});

afterAll(async () => {
  await pool.end();
});
