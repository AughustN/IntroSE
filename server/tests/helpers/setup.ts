import { afterAll, beforeEach } from "vitest";
import { pool } from "../../src/db/pool.js";
import { assertNotDemoBranch } from "../../src/db/guards.js";
import { activityTest } from "../../src/modules/admin/activity.js";
import { settingServiceTest } from "../../src/modules/admin/settings.service.js";
import { resetAuthThrottle } from "../../src/modules/auth/throttle.js";
import { resetHoldRateLimit } from "../../src/modules/holds/holds.throttle.js";
import { resetRateLimitStore } from "../../src/middleware/rateLimit.js";
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
  // `ai_usage_windows` is listed explicitly: every other AI table carries a foreign key to users and
  // is therefore swept by CASCADE, but that one is keyed by window and references nothing. Left out,
  // the ceiling test would leave the counter at its limit and every later case would silently take
  // the AI fallback path instead of calling its provider double.
  // audit_logs has an append-only trigger (0004) — TRUNCATE is DDL-level, not row-level, so it is
  // not blocked by the BEFORE UPDATE OR DELETE trigger and stays valid for test isolation.
  await pool.query(
    `TRUNCATE users, wallets, refresh_tokens, password_resets, auth_events, organizers, organizer_appeals,
             venues, venue_layouts, layout_elements, layout_tables, sections, seats,
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
  // And the anti-bot sliding windows, which are the SECOND per-IP register window in the process
  // and reintroduce exactly the problem the line above solves. `register:ip` admits six sign-ups
  // per hour from one address (auth.routes), and the whole suite registers from loopback: without
  // this, the seventh case in a file — whatever it asserts — gets 403 `captcha_required` from
  // `/auth/register`, and every case after it fails for its POSITION rather than its subject.
  // Reset without a namespace, so `login:ip`, `login:failed:*` and the rest go with it.
  resetRateLimitStore();
  // And the DAU dedupe (0035): it is a per-process set of who has already been written today, so a
  // TRUNCATE without this leaves the middleware believing rows exist that the suite just deleted.
  activityTest.reset();
  // Same for the settings cache: tests that update system settings or truncate the table must not
  // see stale cached values in the next case.
  settingServiceTest.resetCache();
  // And the listing assistant's three process-local bounds (006 SEC-08/SCAL-02/SCAL-03). Its reset
  // seam shipped with the feature but was never wired in here, so `exhaustQuotaForTest()` in the
  // quota case leaked into every later test in the process: the two price cases that follow it read
  // `{ available: false, reason: 'quota_exhausted' }`, which carries no `suggestion`, and died on
  // `res.body.suggestion.price`. They failed for their POSITION in the file, not for what they
  // assert — moving them above the quota case would have "fixed" them. The per-user buckets and the
  // suggestion cache leaked the same way and were passing only by luck of ordering.
  resetAiThrottle();
  // The injected model is the SECOND process-global the listing tests leave behind, and clearing the
  // throttle alone did not fix them: the degradation cases swap in a `FakeListingModel("throw" |
  // "hang" | "malformed")` and none of them puts it back, so every later request in the process kept
  // throwing and kept answering `{ available: false, reason: 'error' }` — the same shape, missing
  // `suggestion`, as the exhausted-quota branch. Null restores the default fake ("ok") under vitest.
  setListingModelForTest(null);
});

afterAll(async () => {
  await pool.end();
});
