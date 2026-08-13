import { type NextFunction, type Request, type Response, Router } from "express";
import type { NotificationItem } from "@shared/notifications/types.js";
import type { WaitlistEntry } from "@shared/waitlist/types.js";
import { z } from "zod";
import { pool, withTransaction, type Db } from "../../db/pool.js";
import { err } from "../../http.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { availableForWaitlist } from "./notifications.service.js";

export const notificationRouter = Router();

/** Ten open places per queue, and no more (UC-17 A2, FR-003). */
const WAITLIST_CAP = 10;

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const waitlistSchema = z.object({
  showtimeId: z.number().int().positive(),
  ticketTierId: z.number().int().positive().nullable().optional(),
});

const idParam = z.coerce.number().int().positive();

interface WaitlistRow {
  id: number;
  showtime_id: number;
  ticket_tier_id: number | null;
  status: WaitlistEntry["status"];
  joined_at: Date;
  notified_at: Date | null;
}

/**
 * Where this place stands in its queue.
 *
 * Counted rather than stored (research.md §2). `status IN ('waiting','notified')` is what "open"
 * means everywhere in this feature — being told does not take a waiter out of the queue, so it must
 * not take them out of the count either, or the people behind them would appear to overtake.
 *
 * `IS NOT DISTINCT FROM` because the any-tier queue is keyed by a NULL tier, and `= NULL` is never
 * true: written the ordinary way, every any-tier waiter would read position 1.
 */
async function positionOf(db: Db, row: WaitlistRow): Promise<number> {
  const { rows } = await db.query<{ ahead: string }>(
    `SELECT count(*)::text AS ahead
       FROM waitlists
      WHERE showtime_id = $1
        AND ticket_tier_id IS NOT DISTINCT FROM $2
        AND status IN ('waiting', 'notified')
        AND joined_at < $3`,
    [row.showtime_id, row.ticket_tier_id, row.joined_at],
  );
  return Number(rows[0]?.ahead ?? 0) + 1;
}

async function toEntry(db: Db, row: WaitlistRow): Promise<WaitlistEntry> {
  return {
    id: row.id,
    showtimeId: row.showtime_id,
    ticketTierId: row.ticket_tier_id,
    status: row.status,
    position: await positionOf(db, row),
    joinedAt: row.joined_at.toISOString(),
    notifiedAt: row.notified_at?.toISOString() ?? null,
  };
}

notificationRouter.use(requireAuth);

notificationRouter.get(
  "/notifications",
  asyncH(async (req, res) => {
    const { rows } = await pool.query<{
      id: number;
      type: NotificationItem["type"];
      title: string;
      body: string;
      payload: Record<string, unknown>;
      eventSlug: string | null;
      readAt: Date | null;
      createdAt: Date;
    }>(
      // The slug is joined here rather than read out of `payload`: where a message leads is not
      // something to take from a free-form blob, and an event since deleted must degrade to a row
      // with no link rather than a link to nothing.
      `SELECT n.id, n.type, n.title, n.body, n.payload,
              e.slug AS "eventSlug", n.read_at AS "readAt", n.created_at AS "createdAt"
         FROM notifications n
         LEFT JOIN events e ON e.id = n.event_id
        WHERE n.user_id = $1 AND n.channel = 'in_app'
        ORDER BY n.id DESC LIMIT 50`,
      [req.auth!.userId],
    );
    const items: NotificationItem[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      payload: row.payload ?? {},
      eventSlug: row.eventSlug,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
    res.json(items);
  }),
);

notificationRouter.post(
  "/notifications/read-all",
  asyncH(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
      [req.auth!.userId],
    );
    res.json({ updated: rowCount ?? 0 });
  }),
);

notificationRouter.post(
  "/notifications/:id/read",
  asyncH(async (req, res) => {
    const parsed = idParam.safeParse(req.params.id);
    if (!parsed.success) throw err.badRequest("validation_failed", "Mã thông báo không hợp lệ.");
    // Ownership is a condition of the statement, not a check performed on a row we read first:
    // a forged id must touch nothing and be indistinguishable from one that does not exist.
    const { rowCount } = await pool.query(
      `UPDATE notifications SET read_at = coalesce(read_at, now())
        WHERE id = $1 AND user_id = $2`,
      [parsed.data, req.auth!.userId],
    );
    if (!rowCount) throw err.notFound("notification_not_found", "Không tìm thấy thông báo này.");
    res.status(204).end();
  }),
);

notificationRouter.get(
  "/waitlists",
  asyncH(async (req, res) => {
    const showtimeId = req.query.showtimeId;
    let filter: number | null = null;
    if (showtimeId !== undefined) {
      const parsed = idParam.safeParse(showtimeId);
      if (!parsed.success) throw err.badRequest("validation_failed", "Mã suất diễn không hợp lệ.");
      filter = parsed.data;
    }
    const { rows } = await pool.query<WaitlistRow>(
      `SELECT id, showtime_id, ticket_tier_id, status, joined_at, notified_at
         FROM waitlists
        WHERE user_id = $1
          AND status IN ('waiting', 'notified')
          AND ($2::bigint IS NULL OR showtime_id = $2)
        ORDER BY joined_at DESC`,
      [req.auth!.userId, filter],
    );
    const entries: WaitlistEntry[] = [];
    for (const row of rows) entries.push(await toEntry(pool, row));
    res.json(entries);
  }),
);

notificationRouter.post(
  "/waitlists",
  validate(waitlistSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof waitlistSchema>;
    const tierId = body.ticketTierId ?? null;
    const result = await withTransaction(async (db) => {
      // The row lock is what serializes two people claiming the last place: both read the count
      // under it, so exactly one can be the tenth (FR-003, SC-003).
      const showtime = await db.query<{ event_id: number }>(
        `SELECT s.event_id FROM showtimes s JOIN events e ON e.id = s.event_id
        WHERE s.id = $1 AND s.starts_at > now() AND s.status <> 'cancelled' FOR UPDATE OF s`,
        [body.showtimeId],
      );
      if (!showtime.rowCount) throw err.notFound("showtime_not_found");
      if (tierId !== null) {
        const tier = await db.query(
          `SELECT 1 FROM ticket_tiers WHERE id = $1 AND showtime_id = $2`,
          [tierId, body.showtimeId],
        );
        if (!tier.rowCount)
          throw err.badRequest("validation_failed", "Hạng vé không thuộc suất diễn này.");
      }
      // Judged at the scope being joined, not across the showtime: a sold-out tier stays joinable
      // while its siblings still sell (FR-002, UC-09 A2). One function answers this for both the
      // gate here and the notifier that later reads the queue.
      if (await availableForWaitlist(db, body.showtimeId, tierId)) {
        throw err.conflict(
          "tickets_available",
          "Vé vẫn còn, bạn có thể mua ngay thay vì vào danh sách chờ.",
        );
      }
      const existing = await db.query<WaitlistRow>(
        `SELECT id, showtime_id, ticket_tier_id, status, joined_at, notified_at
           FROM waitlists
          WHERE user_id = $1 AND showtime_id = $2 AND ticket_tier_id IS NOT DISTINCT FROM $3
            AND status IN ('waiting', 'notified')`,
        [req.auth!.userId, body.showtimeId, tierId],
      );
      if (existing.rowCount) return { row: existing.rows[0], existing: true };
      // `waiting` and `notified` both count: a waiter who was told and did not buy still holds
      // their place, so they still hold one of the ten (UC-17 A5).
      const count = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM waitlists
        WHERE showtime_id = $1 AND ticket_tier_id IS NOT DISTINCT FROM $2 AND status IN ('waiting', 'notified')`,
        [body.showtimeId, tierId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= WAITLIST_CAP)
        throw err.conflict("waitlist_full", `Danh sách chờ đã đủ ${WAITLIST_CAP} người.`);
      const inserted = await db.query<WaitlistRow>(
        `INSERT INTO waitlists (user_id, showtime_id, ticket_tier_id) VALUES ($1, $2, $3)
         RETURNING id, showtime_id, ticket_tier_id, status, joined_at, notified_at`,
        [req.auth!.userId, body.showtimeId, tierId],
      );
      return { row: inserted.rows[0], existing: false };
    });
    res.status(result.existing ? 200 : 201).json({
      entry: await toEntry(pool, result.row),
      existing: result.existing,
    });
  }),
);

notificationRouter.delete(
  "/waitlists/:id",
  asyncH(async (req, res) => {
    const parsed = idParam.safeParse(req.params.id);
    if (!parsed.success)
      throw err.badRequest("validation_failed", "Mã danh sách chờ không hợp lệ.");
    // Same rule as marking a notification read: ownership lives in the WHERE clause, so somebody
    // else's place is refused exactly as an imaginary one is (FR-006, SEC-04).
    const { rowCount } = await pool.query(`DELETE FROM waitlists WHERE id = $1 AND user_id = $2`, [
      parsed.data,
      req.auth!.userId,
    ]);
    if (!rowCount)
      throw err.notFound("waitlist_entry_not_found", "Không tìm thấy lượt chờ này của bạn.");
    // Nothing else to do: the places behind this one move up on their own, because a position is
    // counted at read time and never written down.
    res.status(204).end();
  }),
);
