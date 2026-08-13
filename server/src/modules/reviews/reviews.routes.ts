import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { optionalAuth, requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { MAX_BODY } from './reviews.repo.js';
import { edit, forEvent, repliesFor, report, submit, withdraw } from './reviews.service.js';

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
 * What a comment may carry. Which of the fields are *required* is a question the service answers,
 * because it depends on rows: stars on a first comment, text on every later one and every reply.
 * The shape check here stays a shape check. `.strict()` so an unknown field is a 400 rather than
 * something quietly ignored.
 */
const reviewBody = z
  .object({
    rating: z.number().int().min(1).max(5).nullable().optional(),
    body: z.string().max(MAX_BODY).nullable().optional(),
    parentId: z.number().int().positive().nullable().optional(),
  })
  .strict();

/** Editing changes what a comment says, never what it is: `parentId` is not editable. */
const editBody = reviewBody.omit({ parentId: true });

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

/* The rest of one thread. Public for the same reason the wall is, and paged for the same reason. */
reviewsRouter.get(
  '/reviews/:id/replies',
  optionalAuth,
  asyncH(async (req, res) => {
    const limit = Number(req.query.limit);
    // The id of the last reply already on screen. Not a timestamp: see `listReplies`.
    const afterId = Number(req.query.after);
    res.json(
      await repliesFor(idOf(req.params.id, 'Bình luận'), req.auth?.userId, {
        limit: Number.isFinite(limit) ? limit : undefined,
        afterId: Number.isInteger(afterId) && afterId > 0 ? afterId : null,
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
  validate(editBody),
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
