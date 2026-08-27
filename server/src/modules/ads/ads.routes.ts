import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { AD_POLICY } from "@shared/ads/types.js";
import { config } from "../../config.js";
import {
  createSlidingRateLimiter,
  getClientIp,
  normalizeIpKey,
} from "../../middleware/rateLimit.js";
import { deliver, recordMetric } from "./ads.delivery.js";
import { err } from "../../http.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { validate } from "../../middleware/validate.js";
import { getApprovedOrganizerId } from "../catalog/catalog.write.js";
import { activePlacements, listPackages, listPurchases, purchase } from "./ads.repo.js";

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/*
 * Advertising packages, in two routers because they have two different audiences.
 *
 * The placement feed is PUBLIC — the landing page reads it before anybody signs in, and it says
 * only which event holds which slot. Everything else is an approved organizer acting on their own
 * events, so it sits behind the same guard the rest of the organizer console uses.
 */

// ── Public ─────────────────────────────────────────────────────────────────────────────────────
export const adsPublicRouter = Router();

// No raw network identifiers are persisted; shared networks can be undercounted. This is
// best-effort abuse reduction, not a claim of certified unique visitors or bot-free analytics.
function visitorHash(req: Request): string {
  return createHmac("sha256", config.authEventHashKey)
    .update(
      [
        "ads-v1",
        new Date().toISOString().slice(0, 10),
        normalizeIpKey(getClientIp(req)),
        (req.get("user-agent") ?? "").slice(0, 512),
      ].join("|"),
    )
    .digest("hex");
}
function bot(req: Request): boolean {
  return (
    !req.get("user-agent") ||
    /bot|crawler|spider|headless|curl|wget/i.test(req.get("user-agent") ?? "")
  );
}
adsPublicRouter.post(
  "/ads/delivery",
  createSlidingRateLimiter("ads:delivery", { windowMs: 60_000, max: 60 }),
  asyncH(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(bot(req) ? { legacy: [], deliveries: [] } : await deliver(visitorHash(req)));
  }),
);
const metricBody = z
  .object({ token: z.string().uuid(), kind: z.enum(["impression", "click", "play"]) })
  .strict();
adsPublicRouter.post(
  "/ads/metrics",
  createSlidingRateLimiter("ads:metrics", { windowMs: 60_000, max: 240 }),
  validate(metricBody),
  asyncH(async (req, res) => {
    if (!bot(req)) await recordMetric(visitorHash(req), req.body.token, req.body.kind);
    res.status(204).end();
  }),
);

/** GET /api/ads/placements — what the landing page may render right now. */
adsPublicRouter.get(
  "/ads/placements",
  asyncH(async (_req, res) => {
    res.json(await activePlacements());
  }),
);

/**
 * GET /api/ads/packages — the price list.
 *
 * Public on purpose: an organizer deciding whether to apply wants to see what promotion costs, and
 * a price list is marketing, not a privileged fact.
 */
adsPublicRouter.get(
  "/ads/packages",
  asyncH(async (_req, res) => {
    res.json(await listPackages());
  }),
);

// ── Organizer ──────────────────────────────────────────────────────────────────────────────────
export const adsOrganizerRouter = Router();
adsOrganizerRouter.use(requireAuth, requireOrganizer);

/**
 * The caller's approved organizer, or 403.
 *
 * `requireOrganizer` has already established that they have one; this resolves WHICH, because every
 * write below is scoped to it and a purchase must never be able to name someone else's organizer.
 */
async function organizerOf(req: Request): Promise<number> {
  const id = await getApprovedOrganizerId(req.auth!.userId);
  if (id === null) throw err.forbidden("forbidden");
  return id;
}

/** GET /api/organizer/ads/purchases — campaigns this organizer has bought. */
adsOrganizerRouter.get(
  "/ads/purchases",
  asyncH(async (req, res) => {
    res.json(await listPurchases(await organizerOf(req)));
  }),
);

const purchaseBody = z
  .object({
    eventId: z.number().int().positive(),
    packageId: z.number().int().positive(),
    acceptedPolicy: z.literal(AD_POLICY),
  })
  .strict();

/** POST /api/organizer/ads/purchases — buy a package for one event, paid from the wallet. */
adsOrganizerRouter.post(
  "/ads/purchases",
  validate(purchaseBody),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof purchaseBody>;
    const created = await purchase({
      userId: req.auth!.userId,
      organizerId: await organizerOf(req),
      eventId: body.eventId,
      packageId: body.packageId,
      acceptedPolicy: body.acceptedPolicy,
    });
    res.status(201).json(created);
  }),
);
