-- Migration 0004 — Admin organizer and event moderation (UC-33/UC-34)
BEGIN;

CREATE TABLE IF NOT EXISTS content_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_user_id BIGINT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('event', 'review')),
  target_id BIGINT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'flagged', 'resolved')),
  resolution_note TEXT,
  resolved_by BIGINT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_reports_queue ON content_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id BIGSERIAL PRIMARY KEY,
  action_key UUID NOT NULL UNIQUE,
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'conflict', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'applied';
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id, created_at);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TABLE IF NOT EXISTS moderation_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_user_id BIGINT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  moderation_action_id BIGINT REFERENCES moderation_actions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id, kind, target_type, target_id, moderation_action_id)
);

COMMIT;
