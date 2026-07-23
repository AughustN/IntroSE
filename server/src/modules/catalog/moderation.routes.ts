import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireAdmin } from '../../middleware/authz.js';
import { validate } from '../../middleware/validate.js';
import { eventExists, pendingReviewQueue, setModeration, writeAudit } from './catalog.write.js';

// Admin moderation — the pre-publish approval gate + takedown (US6). Mounted at /api. Admin only.
export const moderationRouter = Router();
moderationRouter.use(requireAuth, requireAdmin);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const reasonSchema = z.object({ reason: z.string().trim().min(1) });
const optionalReasonSchema = z.object({ reason: z.string().trim().min(1).optional() });

async function target(req: Request): Promise<number> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await eventExists(id))) throw err.notFound('not_found', 'Không tìm thấy sự kiện.');
  return id;
}

// Review queue — events awaiting moderation.
moderationRouter.get('/moderation', asyncH(async (_req, res) => {
  res.json(await pendingReviewQueue());
}));

// Approve → makes it public (if on sale + organizer approved). FR-025/029.
moderationRouter.post(
  '/events/:id/approve',
  asyncH(async (req, res) => {
    const id = await target(req);
    await setModeration(id, 'approved', null);
    await writeAudit(req.auth!.userId, 'event_approved', id, {});
    res.json({ ok: true });
  }),
);

// Reject → removed with a reason; never public.
moderationRouter.post(
  '/events/:id/reject',
  validate(reasonSchema),
  asyncH(async (req, res) => {
    const id = await target(req);
    const { reason } = req.body as z.infer<typeof reasonSchema>;
    await setModeration(id, 'removed', reason);
    await writeAudit(req.auth!.userId, 'event_rejected', id, { reason });
    res.json({ ok: true });
  }),
);

// Flag an approved event → hidden, needs re-review.
moderationRouter.post(
  '/events/:id/flag',
  asyncH(async (req, res) => {
    const id = await target(req);
    await setModeration(id, 'flagged', null);
    await writeAudit(req.auth!.userId, 'event_flagged', id, {});
    res.json({ ok: true });
  }),
);

// Remove → taken down permanently, kept for the organizer.
moderationRouter.post(
  '/events/:id/remove',
  validate(optionalReasonSchema),
  asyncH(async (req, res) => {
    const id = await target(req);
    const { reason } = req.body as z.infer<typeof optionalReasonSchema>;
    await setModeration(id, 'removed', reason ?? null);
    await writeAudit(req.auth!.userId, 'event_removed', id, { reason: reason ?? null });
    res.json({ ok: true });
  }),
);
