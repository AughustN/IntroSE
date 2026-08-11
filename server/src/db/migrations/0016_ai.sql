-- 0016_ai.sql -- Optional AI assistance. PostgreSQL is used for durable cache and rate limits so
-- production does not require a second cache service.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_request_limits (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE TABLE IF NOT EXISTS ai_response_cache (
  kind TEXT NOT NULL CHECK (kind IN ('recommendation', 'listing')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  response JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, user_id, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expiry ON ai_response_cache(expires_at);

-- These two sources are explicitly scoped to the signed-in attendee and feed UC-10 context.
CREATE TABLE IF NOT EXISTS user_event_bookmarks (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS user_event_views (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_user_event_views_user_recent ON user_event_views(user_id, viewed_at DESC);

COMMIT;
