import { afterAll, beforeEach } from "vitest";
import { pool } from "../../src/db/pool.js";
import { assertNotDemoBranch } from "../../src/db/guards.js";
import { settingServiceTest } from "../../src/modules/admin/settings.service.js";
import { resetAuthThrottle } from "../../src/modules/auth/throttle.js";
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
  // `ai_usage_windows` is listed explicitly: every other AI table carries a foreign key to users and
  // is therefore swept by CASCADE, but that one is keyed by window and references nothing. Left out,
  // the ceiling test would leave the counter at its limit and every later case would silently take
  // the AI fallback path instead of calling its provider double.
  // audit_logs has an append-only trigger (0004) — TRUNCATE is DDL-level, not row-level, so it is
  // not blocked by the BEFORE UPDATE OR DELETE trigger and stays valid for test isolation.
  await pool.query(
    `TRUNCATE users, wallets, refresh_tokens, password_resets, auth_events, organizers,
             venues, venue_layouts, layout_elements, sections, seats,
             events, showtimes, ticket_tiers, showtime_seats, audit_logs,
             reservations, reservation_items, orders, payment_transactions, tickets, wallet_transactions,
             content_reports, moderation_actions, moderation_notifications,
             system_settings, featured_events,
             ai_usage_windows, event_reviews,
             waitlists, notifications, notification_logs
     RESTART IDENTITY CASCADE`,
  );
  // The hold throttle is process-wide in-memory state (FR-017) — clear it so a spam test cannot
  // poison the next case.
  resetHoldRateLimit();
  // Same for the auth throttle: every case registers users from the same loopback IP, so the
  // per-IP register window would otherwise be shared across a whole file (→ spurious 429s).
  resetAuthThrottle();
  // Same for the settings cache: tests that update system settings or truncate the table must not
  // see stale cached values in the next case.
  settingServiceTest.resetCache();
});

afterAll(async () => {
  await pool.end();
});
