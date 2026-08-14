import { pool } from "../../db/pool.js";
import { err } from "../../http.js";

/**
 * A reader reporting an event (UC-39).
 *
 * The queue this writes into has accepted `target_type = 'event'` since feature 004 built it, and
 * the admin side has always known how to resolve one — flag the event, or take it down. What was
 * missing was the door: nothing anywhere let a reader open an event report, so that half of the
 * moderation queue was permanently empty and the admin branch handling it was dead code.
 *
 * A repeat by the same reader is not an error — they did the right thing twice — so it answers with
 * the fact rather than a refusal, exactly as reporting a comment does.
 */
export async function reportEvent(
  userId: number,
  eventId: number,
  reason: string,
): Promise<{ alreadyReported: boolean }> {
  /*
   * An event already taken down cannot be reported again. It is not a privacy rule — the page is
   * gone, so nobody can be looking at it — it is that a queue of reports about content that is
   * already removed is a queue an admin has to read and dismiss for no outcome.
   */
  const target = await pool.query(
    `SELECT 1 FROM events WHERE id = $1 AND moderation_status <> 'removed'`,
    [eventId],
  );
  if (!target.rowCount) throw err.notFound("not_found", "Không tìm thấy sự kiện này.");

  const existing = await pool.query(
    `SELECT 1 FROM content_reports
      WHERE reporter_user_id = $1 AND target_type = 'event' AND target_id = $2`,
    [userId, eventId],
  );
  if (existing.rowCount) return { alreadyReported: true };

  await pool.query(
    `INSERT INTO content_reports (reporter_user_id, target_type, target_id, reason, status)
     VALUES ($1, 'event', $2, $3, 'open')`,
    [userId, eventId, reason.trim()],
  );
  return { alreadyReported: false };
}
