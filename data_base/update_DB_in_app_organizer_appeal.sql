-- ============================================================================
-- Migration: Add organizer_appeals table for In-App Organizer Appeal Form
-- Lý do: Cho phép Ban tổ chức bị đình chỉ gửi đơn giải trình/khiếu nại trực
-- tiếp trên hệ thống Web và Admin có thể xem xét, xử lý trực tiếp trên Console.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."organizer_appeals" (
  "id" BIGSERIAL PRIMARY KEY,
  "organizer_id" BIGINT NOT NULL REFERENCES "public"."organizers"("id") ON DELETE CASCADE,
  "user_id" BIGINT NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  "review_note" TEXT,
  "reviewed_by" BIGINT REFERENCES "public"."users"("id"),
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_organizer_appeals_org" ON "public"."organizer_appeals"("organizer_id");
CREATE INDEX IF NOT EXISTS "idx_organizer_appeals_user" ON "public"."organizer_appeals"("user_id");
CREATE INDEX IF NOT EXISTS "idx_organizer_appeals_status" ON "public"."organizer_appeals"("status");
