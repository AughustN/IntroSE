-- Migration 0014 — Admin catalog curation and system settings (UC-35/UC-36)
-- Depends on 0001_auth.sql (users) and 0002_catalog.sql (events, event_categories).
BEGIN;

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_settings_updated_at ON system_settings(updated_at);

CREATE TABLE IF NOT EXISTS featured_events (
  event_id      BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  display_order INT NOT NULL CHECK (display_order >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_events_display_order
  ON featured_events(display_order);
CREATE INDEX IF NOT EXISTS idx_featured_events_order
  ON featured_events(display_order, event_id);

-- Stable public category codes remain unchanged. Display names are unique after trim/case folding.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_categories_label_vi_normalized
  ON event_categories (lower(regexp_replace(trim(label_vi), '\s+', ' ', 'g')));
CREATE INDEX IF NOT EXISTS idx_event_categories_label_vi ON event_categories(label_vi);

COMMIT;
