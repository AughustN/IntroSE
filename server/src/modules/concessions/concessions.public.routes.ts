import { type NextFunction, type Request, type Response, Router } from "express";
import { pool } from "../../db/pool.js";
import { createSlidingRateLimiter } from "../../middleware/rateLimit.js";
import { listPublicByEvent } from "./concessions.repo.js";

/**
 * The public concession menu read (014 FR-003) — no auth, same IP rate-limit bucket as the
 * catalogue it is served beside (same bucket name `catalog:ip` shares its accounting). The
 * visibility predicate lives in the query itself (`listPublicByEvent`), so a draft,
 * pending-review or pulled event returns an EMPTY list rather than an error or — far worse — a
 * menu: an empty menu leaks nothing, and a checkout with nothing to show simply renders without
 * the snacks section.
 */
export const concessionsPublicRouter = Router();

const concessionsRateLimit = createSlidingRateLimiter("catalog:ip", {
  windowMs: 60 * 1000,
  max: 60,
  errorMessage: "Quá nhiều yêu cầu tải danh mục. Vui lòng thử lại sau giây lát.",
  headers: true,
});

concessionsPublicRouter.use(concessionsRateLimit);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// GET /api/catalog/events/:eventId/concessions
concessionsPublicRouter.get(
  "/catalog/events/:eventId/concessions",
  asyncH(async (req, res) => {
    const eventId = Number(req.params.eventId);
    // A malformed id is not a refusal worth remembering: an event id that is not a number can
    // never have a menu, and "empty" is the honest answer to "what snacks does this have?".
    if (!Number.isInteger(eventId) || eventId <= 0) {
      res.json({ items: [] });
      return;
    }
    res.json({ items: await listPublicByEvent(pool, eventId) });
  }),
);
