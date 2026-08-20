-- Migration: 0036_anti_bot_high_demand.sql
-- Description: Add is_high_demand flag and index to events for Virtual Waiting Room & Anti-Bot challenge gating

ALTER TABLE "public"."events"
  ADD COLUMN IF NOT EXISTS "is_high_demand" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "idx_events_is_high_demand"
  ON "public"."events"("is_high_demand")
  WHERE "is_high_demand" = TRUE;
