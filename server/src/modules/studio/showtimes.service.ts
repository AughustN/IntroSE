import type { ShowtimeMutationResult } from "@shared/catalog/types.js";
import type pg from "pg";
import { pool, withTransaction } from "../../db/pool.js";
import { err, HttpError } from "../../http.js";
import { applyOrganizerEdit } from "./moderation-guard.js";
import { clearLapsedReservationItems } from "./reservations.cleanup.js";

/**
 * Showtime editing (feature 006, UC-23).
 *
 * Feature 002 let an organizer add showtimes and never touch them again. This makes start time,
 * venue, and existence editable — and every widening is paired with a guard, because opening the
 * edit surface without them would be worse than leaving it closed: an organizer could move a showtime
 * into the past, relocate an event a hundred people bought tickets to, or delete a showtime out from
 * under live reservations.
 *
 * Sold and held are read, never written. A refusal here is a refusal to touch feature 003's and
 * feature 004's state, not an attempt to reconcile it.
 */

export interface ShowtimeContext {
  id: number;
  event_id: number;
  venue_id: number;
  starts_at: Date;
  status: string;
  event_type: "general_admission" | "seated";
  owner_user_id: number;
  started: boolean;
}

export async function showtimeContext(
  showtimeId: number,
  db: pg.PoolClient | typeof pool = pool,
): Promise<ShowtimeContext | null> {
  const { rows } = await db.query<ShowtimeContext>(
    `SELECT s.id, s.event_id, s.venue_id, s.starts_at, s.status,
            e.event_type, o.user_id AS owner_user_id,
            (s.starts_at <= now()) AS started
       FROM showtimes s
       JOIN events e ON e.id = s.event_id
       JOIN organizers o ON o.id = e.organizer_id
      WHERE s.id = $1`,
    [showtimeId],
  );
  return rows[0] ?? null;
}

/** Sold and held across BOTH inventory models, since a showtime may be either. */
async function showtimeInventory(
  showtimeId: number,
  db: pg.PoolClient | typeof pool = pool,
): Promise<{ sold: number; held: number; hasSeatMap: boolean }> {
  const { rows } = await db.query<{ sold: number; held: number; seats: number }>(
    `SELECT
        COALESCE((SELECT sum(sold_quantity) FROM ticket_tiers WHERE showtime_id = $1), 0)::int
          + COALESCE((SELECT count(*) FROM showtime_seats WHERE showtime_id = $1 AND status = 'sold'), 0)::int AS sold,
        COALESCE((SELECT sum(reserved_quantity) FROM ticket_tiers WHERE showtime_id = $1), 0)::int
          + COALESCE((SELECT count(*) FROM showtime_seats WHERE showtime_id = $1 AND status = 'held'), 0)::int AS held,
        COALESCE((SELECT count(*) FROM showtime_seats WHERE showtime_id = $1), 0)::int AS seats`,
    [showtimeId],
  );
  const r = rows[0];
  return { sold: r.sold, held: r.held, hasSeatMap: r.seats > 0 };
}

/** A showtime that has run, finished, or been cancelled is history — nothing here may rewrite it. */
function assertEditableWindow(ctx: ShowtimeContext): void {
  if (ctx.status === "cancelled" || ctx.status === "finished") {
    throw err.conflict(
      "showtime_started",
      "Suất chiếu đã kết thúc hoặc đã huỷ, không thể chỉnh sửa.",
    );
  }
  if (ctx.started) {
    throw err.conflict("showtime_started", "Suất chiếu đã bắt đầu, không thể chỉnh sửa.");
  }
}

export interface UpdateShowtimeInput {
  startsAt?: string;
  venueId?: number;
}

export async function updateShowtime(
  actorUserId: number,
  ctx: ShowtimeContext,
  input: UpdateShowtimeInput,
  isAdmin: boolean,
): Promise<ShowtimeMutationResult> {
  assertEditableWindow(ctx);

  if (input.startsAt !== undefined) {
    const when = new Date(input.startsAt);
    if (Number.isNaN(when.getTime()))
      throw err.badRequest("validation_failed", "Thời gian không hợp lệ.");
    if (when.getTime() <= Date.now()) {
      throw err.badRequest("starts_at_in_past", "Không thể dời suất chiếu về quá khứ.");
    }
  }

  if (input.venueId !== undefined && input.venueId !== ctx.venue_id) {
    const { rows } = await pool.query<{ created_by: number }>(
      `SELECT created_by FROM venues WHERE id = $1`,
      [input.venueId],
    );
    if (!rows[0]) throw err.badRequest("validation_failed", "Địa điểm không tồn tại.");
    if (rows[0].created_by !== actorUserId && !isAdmin) {
      throw err.forbidden("not_owner", "Bạn không sở hữu địa điểm này.");
    }
  }

  return withTransaction(async (client) => {
    const inv = await showtimeInventory(ctx.id, client);

    // Relocating is the strict one: a buyer bought a place as much as a date.
    if (input.venueId !== undefined && input.venueId !== ctx.venue_id) {
      if (inv.sold > 0) {
        throw new HttpError(
          409,
          "showtime_has_sales",
          `Suất này đã bán ${inv.sold} vé, không thể đổi địa điểm.`,
          {
            sold: inv.sold,
          },
        );
      }
      if (inv.held > 0) {
        throw new HttpError(
          409,
          "showtime_has_holds",
          `Đang có ${inv.held} vé được giữ ở suất này, không thể đổi địa điểm.`,
          {
            held: inv.held,
          },
        );
      }
      // A seated showtime's map is snapshotted from a layout belonging to the OLD venue. Re-pointing
      // it is a seat-map lifecycle operation owned by feature 005's re-apply, not an edit here.
      if (inv.hasSeatMap) {
        throw err.conflict(
          "seat_map_locks_venue",
          "Suất này đã có sơ đồ ghế lấy từ địa điểm cũ. Hãy dùng trình thiết kế sơ đồ để áp dụng lại bố cục cho địa điểm mới.",
        );
      }
    }

    const changed: string[] = [];
    if (input.startsAt !== undefined) changed.push("showtime.startsAt");
    if (input.venueId !== undefined && input.venueId !== ctx.venue_id)
      changed.push("showtime.venue");

    const { rows } = await client.query<{ starts_at: Date; venue_id: number }>(
      `UPDATE showtimes
          SET starts_at = COALESCE($2::timestamptz, starts_at),
              venue_id = COALESCE($3::bigint, venue_id)
        WHERE id = $1
        RETURNING starts_at, venue_id`,
      [ctx.id, input.startsAt ?? null, input.venueId ?? null],
    );

    const { returnedToReview } = await applyOrganizerEdit(
      client,
      ctx.event_id,
      actorUserId,
      changed,
    );
    return {
      showtimeId: ctx.id,
      startsAt: rows[0].starts_at.toISOString(),
      venueId: rows[0].venue_id,
      returnedToReview,
    };
  });
}

export async function deleteShowtime(
  actorUserId: number,
  ctx: ShowtimeContext,
): Promise<ShowtimeMutationResult> {
  assertEditableWindow(ctx);

  return withTransaction(async (client) => {
    const inv = await showtimeInventory(ctx.id, client);

    // Voiding tickets with refunds is UC-25 (cancel event), which is out of scope for this feature.
    // A showtime with sales is refused outright rather than half-cancelled here.
    if (inv.sold > 0) {
      throw new HttpError(
        409,
        "showtime_has_sales",
        `Suất này đã bán ${inv.sold} vé. Hãy dùng chức năng huỷ sự kiện để hoàn tiền.`,
        {
          sold: inv.sold,
        },
      );
    }
    if (inv.held > 0) {
      throw new HttpError(
        409,
        "showtime_has_holds",
        `Đang có ${inv.held} vé được giữ ở suất này, không thể xoá.`,
        {
          held: inv.held,
        },
      );
    }

    // Safe only because of the two checks above: nothing LIVE points at this showtime's inventory.
    // Lapsed reservations still do, though, and their foreign keys have no ON DELETE.
    await clearLapsedReservationItems(client, "showtime", ctx.id);

    await client.query(`DELETE FROM showtime_seats WHERE showtime_id = $1`, [ctx.id]);
    await client.query(`DELETE FROM ticket_tiers WHERE showtime_id = $1`, [ctx.id]);
    await client.query(`DELETE FROM showtimes WHERE id = $1`, [ctx.id]);

    const { returnedToReview } = await applyOrganizerEdit(client, ctx.event_id, actorUserId, [
      "showtime.remove",
    ]);
    return {
      showtimeId: ctx.id,
      startsAt: ctx.starts_at.toISOString(),
      venueId: ctx.venue_id,
      returnedToReview,
    };
  });
}
