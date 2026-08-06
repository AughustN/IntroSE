import { afterAll, beforeEach } from "vitest";
import { pool } from "../../src/db/pool.js";
import { assertNotDemoBranch } from "../../src/db/guards.js";
import { resetHoldRateLimit } from "../../src/modules/holds/holds.throttle.js";
import { resetAuthThrottle } from "../../src/modules/auth/throttle.js";
import { resetAiThrottle } from "../../src/modules/studio/ai/ai.throttle.js";
import { setListingModelForTest } from "../../src/modules/studio/ai/listing.model.js";

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
             venues, venue_layouts, layout_elements, sections, seats,
             events, showtimes, ticket_tiers, showtime_seats, audit_logs,
             reservations, reservation_items, orders, payment_transactions, tickets, wallet_transactions
     RESTART IDENTITY CASCADE`,
  );
  // The hold throttle is process-wide in-memory state (FR-017) — clear it so a spam test cannot
  // poison the next case.
  resetHoldRateLimit();
  // Same for the auth throttle: a suite that registers many users (an RBAC matrix over every
  // endpoint) would otherwise hit the per-IP register limit and fail for the wrong reason. The
  // throttle's own behaviour is still covered — auth/throttle.test.ts bursts within a single case.
  resetAuthThrottle();
  // The AI assistant's rate limit, suggestion cache and daily quota are process-wide too, and the
  // model seam must not stay swapped to a failing fake for the next case.
  resetAiThrottle();
  setListingModelForTest(null);
});

afterAll(async () => {
  await pool.end();
});
