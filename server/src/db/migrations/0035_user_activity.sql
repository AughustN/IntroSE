-- Migration 0035 — Daily active users.
--
-- Depends on 0001_auth.sql (users, auth_events), 0003_holds.sql (reservations),
-- 0004_wallet_checkout.sql (orders), 0020_event_reviews.sql and 0033_ads.sql.
--
-- The console had no way to answer "how many people used the site today". Every existing table
-- records a TRANSACTION — an order, a hold, a review — so the only users it could count were the
-- ones who spent money, which is a conversion figure wearing a traffic figure's name.
--
-- One row per user per calendar day, and nothing else: no timestamp, no counter, no session. DAU is
-- then a COUNT over one day and MAU a COUNT over a 30-day window, both from the same row, and the
-- table cannot grow faster than (users × days) however chatty the client gets.
--
-- The day is LOCAL (Asia/Ho_Chi_Minh), like every other date the console reports. Storing UTC days
-- would put a 7am Hanoi visit on the previous day and make the chart disagree with the revenue one
-- beside it.
BEGIN;

CREATE TABLE IF NOT EXISTS user_activity_days (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE   NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- The read is always "who was active in this window", never "when was this user active", so the
-- index the primary key does NOT provide is the one on day alone.
CREATE INDEX IF NOT EXISTS idx_user_activity_day ON user_activity_days(day);

-- ---------- BACKFILL ----------
-- Everything already on record that proves a specific user was present on a specific day. This is a
-- floor, not a reconstruction: a day somebody browsed without acting leaves no trace anywhere, so
-- history reads lower than the live figures the middleware will record from now on.
INSERT INTO user_activity_days (user_id, day)
SELECT user_id, day FROM (
  SELECT user_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day
    FROM auth_events WHERE user_id IS NOT NULL
  UNION
  SELECT user_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    FROM reservations WHERE user_id IS NOT NULL
  UNION
  SELECT user_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    FROM orders WHERE user_id IS NOT NULL
  UNION
  SELECT user_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    FROM event_reviews WHERE user_id IS NOT NULL
  UNION
  SELECT purchased_by, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    FROM ad_purchases
  UNION
  -- Registration day: an account that signed up and never came back was still there once.
  SELECT id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FROM users
) AS seen
ON CONFLICT DO NOTHING;

COMMIT;
