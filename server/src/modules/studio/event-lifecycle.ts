import type { Db } from "../../db/pool.js";
import { err } from "../../http.js";

/** Called inside the mutation transaction; terminal events cannot be reopened by an edit. */
export async function lockEditableEvent(db: Db, eventId: number) {
  const { rows } = await db.query<{ status: string; moderation_status: string }>(
    `SELECT status, moderation_status FROM events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const event = rows[0];
  if (!event) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  if (event.status === "finished" || event.status === "cancelled") {
    throw err.conflict(
      "event_closed",
      "Sự kiện đã kết thúc hoặc đã hủy, không thể chỉnh sửa hay đăng bán lại.",
    );
  }
  return event;
}

/** Tier mutations must obey the same time window as editing their showtime. */
export async function assertEditableShowtime(db: Db, showtimeId: number) {
  const { rows } = await db.query<{ editable: boolean }>(
    `SELECT s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')
       AND e.status NOT IN ('cancelled', 'finished') AS editable
       FROM showtimes s JOIN events e ON e.id = s.event_id WHERE s.id = $1`,
    [showtimeId],
  );
  if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy suất chiếu.");
  if (!rows[0].editable)
    throw err.conflict(
      "showtime_started",
      "Suất chiếu đã bắt đầu, kết thúc hoặc bị hủy; không thể sửa hạng vé.",
    );
}
