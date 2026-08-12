-- 0017_ai_chat.sql -- The attendee chatbot (008).
--
-- Two changes. A platform-wide usage counter, so the automatic quota guard UC-10 A3 and UC-22 A3
-- describe stops being a manual Admin switch. And a cache kind rename: `recommendation` belonged to
-- the single-shot endpoint this feature removes, so its rows are deleted rather than left behind as
-- answers no code can serve.
--
-- Conversation content is deliberately absent: it is client-held and never persisted (research.md).

BEGIN;

-- One row per threshold window. Keyed by the window itself and referencing nothing, so a single
-- primary-key lookup answers "may we call out?" — and, note for the test suite, `TRUNCATE users
-- CASCADE` does NOT sweep it the way it sweeps every other AI table.
CREATE TABLE IF NOT EXISTS ai_usage_windows (
  window_started_at TIMESTAMPTZ PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The endpoint these rows answered for no longer exists.
DELETE FROM ai_response_cache WHERE kind = 'recommendation';

ALTER TABLE ai_response_cache DROP CONSTRAINT IF EXISTS ai_response_cache_kind_check;
ALTER TABLE ai_response_cache
  ADD CONSTRAINT ai_response_cache_kind_check CHECK (kind IN ('chat', 'listing'));

COMMIT;
