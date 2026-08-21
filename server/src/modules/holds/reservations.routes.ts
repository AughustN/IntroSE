import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { holdRateLimit } from './holds.throttle.js';
import {
  addToReservation,
  cancel,
  getActiveForShowtime,
  getReservation,
  hold,
  removeQuantity,
  removeSeats,
} from './holds.service.js';
import { verifyTimingTicket } from '../../services/timingTicket.js';
import { verifyQueueToken } from '../../services/waitingRoom.service.js';
import { verifyTurnstile } from '../../services/turnstile.js';
import { pool } from '../../db/pool.js';

/**
 * Reservations = seat holds (feature 003). Every route is behind `requireAuth`: a hold must have an
 * owner and there are no anonymous holds (FR-001), and the owner is always the session's user — the
 * client can never assert it (FR-024). Mounted at /api.
 */
export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const id = z.number().int().positive();

// Seated (`seatIds`) or general admission (`ticketTierId` + `quantity`), never both — the service
// rejects the ambiguous and empty cases with `invalid_selection`.
const holdBody = z.object({
  showtimeId: id,
  seatIds: z.array(id).max(50).optional(),
  ticketTierId: id.optional(),
  quantity: z.number().int().positive().max(50).optional(),
  timingTicket: z.string().optional(),
  queueToken: z.string().optional(),
  turnstileToken: z.string().optional(),
});

const patchBody = z.object({
  add: holdBody.partial({ showtimeId: true }).optional(),
  removeSeatIds: z.array(id).max(50).optional(),
  // General admission has no seat to name, so a decrease says which tier and how many.
  removeQuantity: z.object({ ticketTierId: id, quantity: z.number().int().positive().max(50) }).optional(),
});

const numericParam = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw err.notFound('not_found');
  return n;
};

/**
 * Whether this showtime is one the organiser flagged as a drop.
 *
 * Read per request rather than cached: an organiser can flip the flag while a sale is live, and a
 * cache would leave the gate open on the instance that missed the change.
 */
async function isHighDemandShowtime(showtimeId: number): Promise<boolean> {
  const res = await pool.query<{ is_high_demand: boolean }>(
    `SELECT COALESCE(e.is_high_demand, false) AS is_high_demand
       FROM showtimes s
       JOIN events e ON e.id = s.event_id
      WHERE s.id = $1`,
    [showtimeId],
  );
  return Boolean(res.rows[0]?.is_high_demand);
}

/**
 * Which showtime a reservation belongs to, for the PATCH gate.
 *
 * The client sends `add.showtimeId` when it has it, but the field is optional on this route — the
 * reservation already knows, and a gate that trusted a caller-supplied showtime would let a bot
 * name a quiet one to dodge the drop. Reading it from the row is the only version that cannot be
 * lied to. Ownership is enforced in the same statement; a reservation that is not the caller's
 * simply does not resolve, and the later service call is what reports that.
 */
async function showtimeOfReservation(userId: number, reservationId: number): Promise<number | null> {
  const res = await pool.query<{ showtime_id: number }>(
    `SELECT showtime_id FROM reservations WHERE id = $1 AND user_id = $2`,
    [reservationId, userId],
  );
  return res.rows[0]?.showtime_id ?? null;
}

/**
 * The queue half of the drop gate: a pass, minted for this buyer and this showtime, still inside
 * its TTL.
 *
 * Separate from the CAPTCHA half because the two have different lifetimes. A Turnstile token is
 * redeemable once and dies at Cloudflare on first use, so it can only be asked for at the entrance;
 * the queue pass is good for its whole three minutes and is what every later request carries.
 */
function requireQueuePass(showtimeId: number, userId: number, queueToken?: string): void {
  if (!queueToken) {
    throw err.forbidden('queue_token_required', 'Sự kiện mở bán vé hot yêu cầu lượt phòng chờ hợp lệ.');
  }
  const result = verifyQueueToken(showtimeId, userId, queueToken);
  if (result.valid) return;
  if (result.error === 'queue_token_expired') {
    throw err.forbidden('queue_token_expired', 'Lượt phòng chờ đã hết hạn. Vui lòng xếp hàng lại.');
  }
  throw err.forbidden('queue_token_invalid', 'Lượt phòng chờ không hợp lệ. Vui lòng xếp hàng lại.');
}

// POST /api/reservations — hold-on-select: create or join the caller's one active reservation.
reservationsRouter.post(
  '/reservations',
  holdRateLimit,
  validate(holdBody),
  asyncH(async (req, res) => {
    const { showtimeId, timingTicket, queueToken, turnstileToken } = req.body;
    const userId = req.auth!.userId;

    // 1. Behavioral Timing Verification (if timingTicket present)
    if (timingTicket) {
      const timingCheck = verifyTimingTicket(timingTicket, showtimeId);
      if (!timingCheck.valid) {
        if (timingCheck.error === 'inhuman_interaction_speed') {
          throw err.badRequest('inhuman_interaction_speed', 'Thao tác quá nhanh. Vui lòng tương tác bình thường để giữ vé.');
        }
      }
    }

    // 2-4. The drop gate: queue pass, then CAPTCHA. Entering the sale is the one place the
    // CAPTCHA is asked for — see `requireQueuePass` for why the later requests carry only the pass.
    if (await isHighDemandShowtime(showtimeId)) {
      requireQueuePass(showtimeId, userId, queueToken);

      const captchaResult = await verifyTurnstile(turnstileToken, req.ip);
      if (!captchaResult.success) {
        throw err.badRequest('captcha_failed', 'Xác thực CAPTCHA thất bại, vui lòng thử lại.');
      }
    }

    const result = await hold(userId, req.body);

    /*
     * The pass is NOT consumed here.
     *
     * It used to be, and that turned the waiting room into a one-shot: the first seat burned the
     * token, and the moment the buyer released everything — which deletes the reservation — the
     * next seat came back `queue_token_invalid` with no way to queue again. A buyer picking four
     * seats, changing their mind about one, and picking another is the ordinary case, not abuse.
     *
     * What bounds the pass is its three-minute TTL and the `userId` it is minted against, which is
     * what the feature always claimed. Consumption on top of that bought
     * nothing: the reservation itself is already one-per-user, and every later change goes through
     * PATCH, which the same pass gates.
     */
    res.status(result.created ? 201 : 200).json(result.reservation);
  }),
);

// GET /api/reservations/active?showtimeId= — the caller's live selection, for resync (FR-022).
reservationsRouter.get(
  '/reservations/active',
  asyncH(async (req, res) => {
    const showtimeId = numericParam(String(req.query.showtimeId ?? ''));
    res.json(await getActiveForShowtime(req.auth!.userId, showtimeId));
  }),
);

reservationsRouter.get(
  '/reservations/:id',
  asyncH(async (req, res) => {
    res.json(await getReservation(req.auth!.userId, numericParam(req.params.id)));
  }),
);

// PATCH /api/reservations/:id — add seats/quantity or remove seats while active (FR-013).
// Never extends the window (FR-006).
reservationsRouter.patch(
  '/reservations/:id',
  holdRateLimit,
  validate(patchBody),
  asyncH(async (req, res) => {
    const reservationId = numericParam(req.params.id);
    const userId = req.auth!.userId;
    const { add, removeSeatIds, removeQuantity: drop } = req.body as z.infer<typeof patchBody>;

    /*
     * Growing a reservation on a drop needs the same pass as opening one.
     *
     * This route carried no gate at all, which made the one on POST close to decorative: a bot paid
     * the queue-and-CAPTCHA toll once, and then took the rest of the block through PATCH, which is
     * where seats are actually added one at a time. Releasing seats stays ungated on purpose —
     * nothing is won by making it harder to give inventory back.
     */
    if (add) {
      const showtimeId = add.showtimeId ?? (await showtimeOfReservation(userId, reservationId));
      if (showtimeId && (await isHighDemandShowtime(showtimeId))) {
        requireQueuePass(showtimeId, userId, add.queueToken);
      }
    }

    let result = null;
    if (drop) {
      result = await removeQuantity(userId, reservationId, drop.ticketTierId, drop.quantity);
    } else if (removeSeatIds && removeSeatIds.length > 0) {
      result = await removeSeats(userId, reservationId, removeSeatIds);
    }
    if (add) {
      result = await addToReservation(userId, reservationId, { ...add, showtimeId: add.showtimeId ?? 0 });
    }
    if (!result) result = await getReservation(userId, reservationId);
    res.json(result);
  }),
);

// DELETE /api/reservations/:id — release everything it holds at once (FR-014).
reservationsRouter.delete(
  '/reservations/:id',
  holdRateLimit,
  asyncH(async (req, res) => {
    await cancel(req.auth!.userId, numericParam(req.params.id));
    res.status(204).end();
  }),
);
