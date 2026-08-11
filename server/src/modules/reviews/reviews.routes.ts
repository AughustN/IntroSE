import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { optionalAuth, requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { MAX_BODY } from './reviews.repo.js';
import { edit, forEvent, report, submit, withdraw } from './reviews.service.js';

export const reviewsRouter = Router();

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idOf = (raw: string, what: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw err.badRequest('validation_failed', `${what} không hợp lệ.`);
  return value;
};

/**
 * A star is required; text is not.
 *
 * UC-18 A3: text alone is not a review, because the aggregate is the point and prose cannot be
 * averaged. `.strict()` so an unknown field is a 400 rather than something quietly ignored.
 */
const reviewBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    body: z.string().max(MAX_BODY).nullable().optional(),
  })
  .strict();

const reportBody = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict();

/*
 * Reading is open. A rating exists to inform the next buyer, so requiring an account to read one
 * would defeat it — `optionalAuth` fills in the viewer when there is a session and leaves the route
 * public when there is not.
 */
reviewsRouter.get(
  '/events/:eventId/reviews',
  optionalAuth,
  asyncH(async (req, res) => {
    const limit = Number(req.query.limit);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    res.json(
      await forEvent(idOf(req.params.eventId, 'Sự kiện'), req.auth?.userId, {
        limit: Number.isFinite(limit) ? limit : undefined,
        before,
      }),
    );
  }),
);

reviewsRouter.post(
  '/events/:eventId/reviews',
  requireAuth,
  validate(reviewBody),
  asyncH(async (req, res) => {
    res.json(await submit(req.auth!.userId, idOf(req.params.eventId, 'Sự kiện'), req.body));
  }),
);

reviewsRouter.patch(
  '/reviews/:id',
  requireAuth,
  validate(reviewBody),
  asyncH(async (req, res) => {
    res.json(await edit(req.auth!.userId, idOf(req.params.id, 'Đánh giá'), req.body));
  }),
);

reviewsRouter.delete(
  '/reviews/:id',
  requireAuth,
  asyncH(async (req, res) => {
    await withdraw(req.auth!.userId, idOf(req.params.id, 'Đánh giá'));
    res.status(204).end();
  }),
);

reviewsRouter.post(
  '/reviews/:id/report',
  requireAuth,
  validate(reportBody),
  asyncH(async (req, res) => {
    const result = await report(req.auth!.userId, idOf(req.params.id, 'Đánh giá'), req.body.reason);
    // A repeat is not an error — the reader did the right thing twice — so it answers 200 with the
    // fact, and only a first report is a 201.
    if (result.alreadyReported) res.json({ alreadyReported: true });
    else res.status(201).end();
  }),
);
