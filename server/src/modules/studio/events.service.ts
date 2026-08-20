import type { EventMutationResult, ModerationStatus } from "@shared/catalog/types.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err, HttpError } from "../../http.js";
import { applyOrganizerEdit, wasEverApproved } from "./moderation-guard.js";
import { clearLapsedReservationItems } from "./reservations.cleanup.js";

/**
 * Event-level editing and deletion (feature 006, UC-23 + FR-020).
 *
 * The edit surface is wider than the four text fields feature 002 allowed. Every field accepted here
 * is buyer-visible content, so on an approved event every one of them returns it for review — the
 * slug is deliberately NOT editable, because it is the stable public identity of the listing (002).
 */

export interface UpdateEventInput {
  title?: string;
  description?: string;
  imageUrl?: string | null;
  refundPolicy?: string | null;
  ageRestriction?: string;
  categoryCode?: string;
  isHighDemand?: boolean;
  is_high_demand?: boolean;
}

export async function updateEvent(
  actorUserId: number,
  eventId: number,
  input: UpdateEventInput,
): Promise<EventMutationResult> {
  if (input.categoryCode !== undefined) {
    const { rows } = await pool.query(`SELECT 1 FROM event_categories WHERE code = $1`, [
      input.categoryCode,
    ]);
    if (rows.length === 0) throw err.badRequest("validation_failed", "Danh mục không hợp lệ.");
  }

  const isHighDemandProvided = input.isHighDemand !== undefined || input.is_high_demand !== undefined;
  const isHighDemandValue = input.isHighDemand ?? input.is_high_demand ?? false;

  return withTransaction(async (client) => {
    const { rows: current } = await client.query<{
      title: string;
      description: string;
      image_url: string | null;
      refund_policy: string | null;
      age_restriction: string;
      category_code: string;
      is_high_demand: boolean;
    }>(
      `SELECT e.title, e.description, e.image_url, e.refund_policy, e.age_restriction, ec.code AS category_code, COALESCE(e.is_high_demand, false) AS is_high_demand
         FROM events e
         JOIN event_categories ec ON ec.id = e.category_id
        WHERE e.id = $1`,
      [eventId],
    );
    if (!current[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
    const cur = current[0];

    const changed: string[] = [];
    if (input.title !== undefined && input.title !== cur.title) changed.push("event.title");
    if (input.description !== undefined && input.description !== cur.description) changed.push("event.description");
    if (input.imageUrl !== undefined && input.imageUrl !== cur.image_url) changed.push("event.image");
    if (input.refundPolicy !== undefined && input.refundPolicy !== cur.refund_policy) changed.push("event.refundPolicy");
    if (input.ageRestriction !== undefined && input.ageRestriction !== cur.age_restriction) changed.push("event.ageRestriction");
    if (input.categoryCode !== undefined && input.categoryCode !== cur.category_code) changed.push("event.category");
    if (isHighDemandProvided && isHighDemandValue !== cur.is_high_demand) changed.push("event.isHighDemand");

    const { rows } = await client.query<{
      id: number;
      slug: string;
      title: string;
      status: string;
    }>(
      `UPDATE events SET
          title = COALESCE($2, title),
          description = COALESCE($3, description),
          image_url = CASE WHEN $4::boolean THEN $5 ELSE image_url END,
          refund_policy = CASE WHEN $6::boolean THEN $7 ELSE refund_policy END,
          age_restriction = COALESCE($8, age_restriction),
          category_id = COALESCE((SELECT id FROM event_categories WHERE code = $9), category_id),
          is_high_demand = CASE WHEN $10::boolean THEN $11::boolean ELSE is_high_demand END,
          updated_at = now()
        WHERE id = $1
        RETURNING id, slug, title, status`,
      [
        eventId,
        input.title ?? null,
        input.description ?? null,
        input.imageUrl !== undefined,
        input.imageUrl ?? null,
        input.refundPolicy !== undefined,
        input.refundPolicy ?? null,
        input.ageRestriction ?? null,
        input.categoryCode ?? null,
        isHighDemandProvided,
        isHighDemandValue,
      ],
    );
    if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");

    // The moderation consequence commits in the SAME transaction as the content change, so there is
    // no observable moment in which the edited content is public under the old approval (FR-023).
    const { returnedToReview } = await applyOrganizerEdit(client, eventId, actorUserId, changed);

    const { rows: after } = await client.query<{ moderation_status: ModerationStatus }>(
      `SELECT moderation_status FROM events WHERE id = $1`,
      [eventId],
    );

    return {
      id: rows[0].id,
      slug: rows[0].slug,
      title: rows[0].title,
      status: rows[0].status,
      moderation: after[0].moderation_status,
      returnedToReview,
    };
  });
}

/**
 * Delete an event (FR-020).
 *
 * Permitted only for one that was never approved, carries no inventory, and is not under an admin's
 * hand. The moderation-history condition is the important half: without it, deletion becomes a way to
 * launder a rejection — erase the removed event, re-submit a clean copy, and the takedown feature 002
 * deliberately preserves is gone. "Never approved" comes from the audit trail, because
 * `moderation_status` cannot distinguish "approved then edited" from "never reviewed" (R-1).
 *
 * Taking a live event down remains unpublish (002) or cancellation with refunds (UC-25).
 */
export async function deleteEvent(eventId: number): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ moderation_status: ModerationStatus }>(
      `SELECT moderation_status FROM events WHERE id = $1 FOR UPDATE`,
      [eventId],
    );
    if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");

    if (rows[0].moderation_status === "flagged" || rows[0].moderation_status === "removed") {
      throw err.conflict(
        "event_under_moderation",
        "Sự kiện đang bị quản trị viên xử lý, không thể xoá. Bạn vẫn xem được lý do trong danh sách sự kiện.",
      );
    }

    if (await wasEverApproved(client, eventId)) {
      throw err.conflict(
        "event_was_approved",
        "Sự kiện này từng được duyệt nên không thể xoá. Hãy gỡ đăng bán hoặc huỷ sự kiện.",
      );
    }

    const { rows: inv } = await client.query<{ sold: number; held: number }>(
      `SELECT
         COALESCE((SELECT sum(tt.sold_quantity) FROM ticket_tiers tt
                     JOIN showtimes s ON s.id = tt.showtime_id WHERE s.event_id = $1), 0)::int
           + COALESCE((SELECT count(*) FROM showtime_seats ss
                     JOIN showtimes s ON s.id = ss.showtime_id
                    WHERE s.event_id = $1 AND ss.status = 'sold'), 0)::int AS sold,
         COALESCE((SELECT sum(tt.reserved_quantity) FROM ticket_tiers tt
                     JOIN showtimes s ON s.id = tt.showtime_id WHERE s.event_id = $1), 0)::int
           + COALESCE((SELECT count(*) FROM showtime_seats ss
                     JOIN showtimes s ON s.id = ss.showtime_id
                    WHERE s.event_id = $1 AND ss.status = 'held'), 0)::int AS held`,
      [eventId],
    );
    if (inv[0].sold > 0 || inv[0].held > 0) {
      throw new HttpError(
        409,
        "event_has_inventory",
        `Sự kiện đang có ${inv[0].sold} vé đã bán và ${inv[0].held} vé đang giữ, không thể xoá.`,
        { sold: inv[0].sold, held: inv[0].held },
      );
    }

    // Lapsed reservations still reference this event's tiers and seats (see reservations.cleanup).
    await clearLapsedReservationItems(client, "event", eventId);

    await client.query(
      `DELETE FROM showtime_seats WHERE showtime_id IN (SELECT id FROM showtimes WHERE event_id = $1)`,
      [eventId],
    );
    await client.query(
      `DELETE FROM ticket_tiers WHERE showtime_id IN (SELECT id FROM showtimes WHERE event_id = $1)`,
      [eventId],
    );
    await client.query(`DELETE FROM showtimes WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM events WHERE id = $1`, [eventId]);
  });
}
