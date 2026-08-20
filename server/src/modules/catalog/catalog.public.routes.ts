import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { listCategories } from '../admin/admin.repo.js';
import { getEventDetail, getSeatMap, getShowtimes, listEvents, listFeaturedEvents } from './catalog.repo.js';
import { reportEvent } from './report.service.js';
import { generateTimingTicket } from '../../services/timingTicket.js';
import { createSlidingRateLimiter } from '../../middleware/rateLimit.js';

// Public catalog reads — no auth. Every query composes the live visibility predicate (R-1).
export const catalogPublicRouter = Router();

const catalogRateLimit = createSlidingRateLimiter('catalog:ip', {
  windowMs: 60 * 1000,
  max: 60,
  errorMessage: 'Quá nhiều yêu cầu tải danh mục. Vui lòng thử lại sau giây lát.',
  headers: true,
});

catalogPublicRouter.use(catalogRateLimit);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const num = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/*
 * GET /api/categories
 *
 * Public because a category list is a description of the catalogue, not a privileged fact — the
 * codes are already on every event card. It exists so the organizer's "Danh mục" dropdown can be
 * built from the categories that exist rather than from a constant compiled into the bundle: that
 * constant had drifted to six entries while the database held thirteen, so seven categories —
 * 287 events' worth — were unreachable to anyone creating an event, and a category an Admin added
 * through the console appeared to save and was then invisible everywhere.
 */
catalogPublicRouter.get('/categories', asyncH(async (_req, res) => { res.json(await listCategories()); }));

// GET /api/events/featured
catalogPublicRouter.get('/events/featured', asyncH(async (_req, res) => { res.json(await listFeaturedEvents()); }));

// GET /api/events (US1)
catalogPublicRouter.get(
  '/events',
  asyncH(async (req, res) => {
    const q = req.query;
    const result = await listEvents({
      q: str(q.q),
      category: str(q.category),
      city: str(q.city),
      date: str(q.date),
      minPrice: num(q.minPrice),
      maxPrice: num(q.maxPrice),
      availability: q.availability === 'available' ? 'available' : 'all',
      page: num(q.page),
      pageSize: num(q.pageSize),
    });
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    res.json(result);
  }),
);

// GET /api/events/:slug (US2) — 404 also for drafts/pending/removed (never leaked, FR-009/SC-004)
catalogPublicRouter.get(
  '/events/:slug',
  asyncH(async (req, res) => {
    const detail = await getEventDetail(req.params.slug);
    if (!detail) throw err.notFound('not_found', 'Không tìm thấy sự kiện.');
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    res.json(detail);
  }),
);

// GET /api/events/:id/showtimes (US2/US3)
catalogPublicRouter.get(
  '/events/:id/showtimes',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw err.notFound('not_found');
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    res.json(await getShowtimes(id));
  }),
);

// GET /api/showtimes/:id/seat-map (US3) — read-only; selecting requires login (later feature)
catalogPublicRouter.get(
  '/showtimes/:id/seat-map',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw err.notFound('not_found');
    const map = await getSeatMap(id);
    if (!map) throw err.notFound('not_found', 'Không tìm thấy suất chiếu.');
    const timing = generateTimingTicket(id);
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    res.json({
      ...map,
      timingTicket: timing.ticket,
      viewTimestamp: timing.viewTimestamp,
    });
  }),
);

/*
 * POST /api/events/:id/report (UC-39)
 *
 * The one route on this router that needs a session: a report is attributed, both so the same
 * reader cannot file the same complaint twice and so an admin can see who raised it. Reading the
 * catalogue stays anonymous.
 */
const reportBody = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
catalogPublicRouter.post(
  '/events/:id/report',
  requireAuth,
  validate(reportBody),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw err.notFound('not_found');
    const result = await reportEvent(req.auth!.userId, id, req.body.reason);
    // A repeat answers 200 with the fact; only a first report is a 201, the same contract the
    // review report already uses.
    if (result.alreadyReported) res.json({ alreadyReported: true });
    else res.status(201).json({ alreadyReported: false });
  }),
);
