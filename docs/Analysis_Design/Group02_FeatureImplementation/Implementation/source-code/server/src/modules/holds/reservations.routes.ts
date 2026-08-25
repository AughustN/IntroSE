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
  removeSeats,
} from './holds.service.js';

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
});

const patchBody = z.object({
  add: holdBody.partial({ showtimeId: true }).optional(),
  removeSeatIds: z.array(id).max(50).optional(),
});

const numericParam = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw err.notFound('not_found');
  return n;
};

// POST /api/reservations — hold-on-select: create or join the caller's one active reservation.
reservationsRouter.post(
  '/reservations',
  holdRateLimit,
  validate(holdBody),
  asyncH(async (req, res) => {
    const result = await hold(req.auth!.userId, req.body);
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
    const { add, removeSeatIds } = req.body as z.infer<typeof patchBody>;

    let result = null;
    if (removeSeatIds && removeSeatIds.length > 0) {
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
