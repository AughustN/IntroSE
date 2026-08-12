-- 0015_notifications.sql — durable in-app/email notification outbox.
-- A notification is committed with the business change; delivery happens later and can be retried.

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id),
  order_id        BIGINT REFERENCES orders(id),
  event_id        BIGINT REFERENCES events(id),
  type            TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  dedupe_key      TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at         TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  attempts        INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_due
  ON notifications(next_attempt_at, id)
  WHERE channel = 'email' AND sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_logs (
  id              BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempt_no      INT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error           TEXT,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notification_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS waitlists (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id),
  showtime_id    BIGINT NOT NULL REFERENCES showtimes(id),
  ticket_tier_id BIGINT REFERENCES ticket_tiers(id),
  status         TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'notified', 'expired', 'converted')),
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at    TIMESTAMPTZ,
  UNIQUE (user_id, showtime_id, ticket_tier_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlists_open
  ON waitlists(showtime_id, ticket_tier_id, joined_at)
  WHERE status IN ('waiting', 'notified');
CREATE UNIQUE INDEX IF NOT EXISTS waitlists_user_any_tier_once
  ON waitlists(user_id, showtime_id)
  WHERE ticket_tier_id IS NULL;

COMMIT;
