import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";

export const notificationRouter = Router();

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const waitlistSchema = z.object({
  showtimeId: z.number().int().positive(),
  ticketTierId: z.number().int().positive().nullable().optional(),
});

notificationRouter.use(requireAuth);

notificationRouter.get(
  "/notifications",
  asyncH(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, type, title, body, payload, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
      WHERE user_id = $1 AND channel = 'in_app'
      ORDER BY id DESC LIMIT 50`,
      [req.auth!.userId],
    );
    res.json(rows);
  }),
);

notificationRouter.post(
  "/waitlists",
  validate(waitlistSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof waitlistSchema>;
    const tierId = body.ticketTierId ?? null;
    const result = await withTransaction(async (db) => {
      const showtime = await db.query<{ event_id: number }>(
        `SELECT s.event_id FROM showtimes s JOIN events e ON e.id = s.event_id
        WHERE s.id = $1 AND s.starts_at > now() AND s.status <> 'cancelled' FOR UPDATE`,
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
      const availability = await db.query<{ available: boolean }>(
        `SELECT EXISTS (
         SELECT 1 FROM ticket_tiers
          WHERE showtime_id = $1
            AND (total_quantity IS NULL OR sold_quantity + reserved_quantity < total_quantity)
       ) OR EXISTS (
         SELECT 1 FROM showtime_seats WHERE showtime_id = $1 AND status = 'available'
       ) AS available`,
        [body.showtimeId],
      );
      if (availability.rows[0]?.available) {
        throw err.conflict(
          "tickets_available",
          "Vé vẫn còn, bạn có thể mua ngay thay vì vào danh sách chờ.",
        );
      }
      const existing = await db.query(
        `SELECT id FROM waitlists WHERE user_id = $1 AND showtime_id = $2 AND ticket_tier_id IS NOT DISTINCT FROM $3`,
        [req.auth!.userId, body.showtimeId, tierId],
      );
      if (existing.rowCount) return { id: existing.rows[0].id, existing: true };
      const count = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM waitlists
        WHERE showtime_id = $1 AND ticket_tier_id IS NOT DISTINCT FROM $2 AND status IN ('waiting', 'notified')`,
        [body.showtimeId, tierId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= 10)
        throw err.conflict("waitlist_full", "Danh sách chờ đã đủ 10 người.");
      const inserted = await db.query<{ id: number }>(
        `INSERT INTO waitlists (user_id, showtime_id, ticket_tier_id) VALUES ($1, $2, $3) RETURNING id`,
        [req.auth!.userId, body.showtimeId, tierId],
      );
      return { id: inserted.rows[0].id, existing: false };
    });
    res.status(result.existing ? 200 : 201).json(result);
  }),
);
