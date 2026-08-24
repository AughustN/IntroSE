import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { listCategories } from '../admin/admin.repo.js';
import { getEventDetail, getSeatMap, getShowtimes, listEvents, listFeaturedEvents } from './catalog.repo.js';
import { reportEvent } from './report.service.js';

// Public catalog reads — no auth. Every query composes the live visibility predicate (R-1).
export const catalogPublicRouter = Router();

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
    res.json(result);
  }),
);

// GET /api/events/:slug (US2) — 404 also for drafts/pending/removed (never leaked, FR-009/SC-004)
catalogPublicRouter.get(
  '/events/:slug',
  asyncH(async (req, res) => {
    const detail = await getEventDetail(req.params.slug);
    if (!detail) throw err.notFound('not_found', 'Không tìm thấy sự kiện.');
    res.json(detail);
  }),
);

// GET /api/events/:id/showtimes (US2/US3)
catalogPublicRouter.get(
  '/events/:id/showtimes',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw err.notFound('not_found');
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
    /*
     * `no-cache` is "revalidate before every use", NOT "do not store" — that is `no-store`.
     *
     * Express already answers this route with a weak ETag, so a conditional GET costs a 304 with no
     * body. What was missing is the half that makes the browser ASK: with no `Cache-Control` at all
     * a `fetch()` response is not kept, so `If-None-Match` never goes out and the whole map is
     * downloaded again on every reload and every back-navigation. On a large chart that is close to
     * two megabytes of seat JSON, which is a real cost on the phone most buyers use.
     *
     * Deliberately NOT a max-age. This payload still carries seat STATUS, and a buyer served a stale
     * copy would be looking at seats that are already gone with nothing to correct them: the live
     * socket only reports changes that happen while it is connected, so it cannot repair a map that
     * arrived stale. Revalidation keeps the saving without ever showing yesterday's availability —
     * and it is what makes this step safe to ship before geometry and status are split apart.
     */
    res.set('Cache-Control', 'no-cache');
    res.json(map);
  }),
);

/*
 * GET /api/showtimes/:id/seat-map/geometry — the half of the map that does not move.
 *
 * Additive: the route above is untouched and still answers with everything, so no client changes and
 * nothing existing behaves differently. This exists so a reader can fetch the expensive, rarely
 * changing half on its own and revalidate it cheaply, instead of pulling the whole map — most of
 * which is seat coordinates — every time availability moves.
 *
 * Derived from `getSeatMap` rather than from a second query ON PURPOSE. Two queries over the same
 * rows are two things to keep in step, and the failure would be silent: a geometry endpoint that
 * drifted from the map endpoint would draw seats in places the buyer cannot click. Sharing the read
 * costs a little work here and makes divergence impossible.
 *
 * `no-cache`, NOT `max-age`/`immutable`, and that is a deliberate refusal. Serving this from a
 * long-lived cache needs a version that changes whenever geometry does, and this schema has none:
 * `showtimes.updated_at` is not bumped by `refreshSnapshot` (it writes only `layout_snapshot` and
 * `layout_id`), `apply()` rewrites seat coordinates in `showtime_seats` without touching `showtimes`
 * at all, and there is no trigger. Pinning a long TTL to that column would cache a chart the
 * organizer has already moved, with nothing to correct it — the live socket carries status, never
 * geometry. Revalidation gives the saving that is actually available today without inventing a
 * freshness guarantee the data cannot keep.
 */
catalogPublicRouter.get(
  '/showtimes/:id/seat-map/geometry',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw err.notFound('not_found');
    const map = await getSeatMap(id);
    if (!map) throw err.notFound('not_found', 'Không tìm thấy suất chiếu.');

    // Everything that moves is dropped: `status` is what the socket already reports per seat, and
    // price/tier follow the tier table rather than the chart. What is left is what a renderer needs
    // to draw the room — and the ETag over it stays stable while seats are being sold.
    const { seats, tiers: _tiers, tierLegend: _tierLegend, ...rest } = map;
    res.set('Cache-Control', 'no-cache');
    res.json({
      ...rest,
      seats: seats?.map(
        ({ status: _s, price: _p, tier: _t, tierId: _ti, ...geometry }) => geometry,
      ),
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
