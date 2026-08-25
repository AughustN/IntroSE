import { join } from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { config } from "./config.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { catalogPublicRouter } from "./modules/catalog/catalog.public.routes.js";
import { organizerRouter } from "./modules/catalog/organizer.routes.js";
import { studioRouter } from "./modules/studio/studio.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { recordActivity } from "./modules/admin/activity.js";
import { reservationsRouter } from "./modules/holds/reservations.routes.js";
import { seatmapRouter } from "./modules/seatmap/seatmap.routes.js";
import { walletRouter } from "./modules/payments/wallet.routes.js";
import { notificationRouter } from "./modules/notifications/notifications.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { reviewsRouter } from "./modules/reviews/reviews.routes.js";
import { adsOrganizerRouter, adsPublicRouter } from "./modules/ads/ads.routes.js";
import { waitingRoomRouter } from "./modules/waitingRoom/waitingRoom.routes.js";

/** Build the Express app (no listen) so tests can drive it with supertest. */
export function createApp(): Express {
  const app = express();
  app.set("trust proxy", 1); // one Nginx hop (ADR 0003) → req.ip is the real client
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      // PUT belongs here: five routes use it — the seat-map save
      // (`PUT /organizer/layouts/:id`) plus the admin category rename, featured events and settings.
      // Omitting it made the browser's preflight succeed and then refuse to send the request, which
      // surfaces as a bare network failure ("Load failed" / "Failed to fetch") with no server log and
      // no status code — indistinguishable from the API being down. GET needs no preflight, so reads
      // worked and only writes broke, which is what made it look like a save bug.
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Idempotency-Key");
      res.vary("Origin");
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    next();
  });
  /*
   * Seat-map writes parse a larger body, and this MUST come before the global parser below.
   *
   * `express.json` marks a request as parsed and every later instance skips it, so registering the
   * looser limit afterwards would do nothing at all — the 1 MB cap would already have run and
   * already have refused. Order is the whole mechanism here.
   *
   * A chart save carries the whole authoring document: about 0.78 MB for a 10,000-seat chart at the
   * raised ceiling, which fits inside 1 MB with no room for long row prefixes or a chart that grows.
   * Raising the GLOBAL cap to suit one route would widen what every unauthenticated endpoint
   * accepts, which is what that cap is for. Looser is safe here because `seatmapRouter` requires auth
   * and then organizer ownership on every route, so a body this size can only come from someone
   * already entitled to write the chart it describes.
   */
  app.use("/api/organizer/layouts", express.json({ limit: "4mb" }));
  app.use("/api/organizer/venues", express.json({ limit: "4mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Who is using the site, counted before any router can answer or refuse (0035). Signature-only
  // and fire-and-forget — see `activity.ts` for why it is not `optionalAuth`.
  app.use(recordActivity);

  // Media uploads are streamed directly to Cloudinary (012-cloudinary-media-upload). Local disk writes decommissioned.

  app.use("/api", authRouter);
  app.use("/api", catalogPublicRouter);
  // Public, and mounted up here for the same reason the review listing is: everything below with a
  // router-level `requireAuth` would answer 401 for these paths before their own handler ran, and
  // the landing page reads its ad placements before anybody signs in.
  app.use("/api", adsPublicRouter);
  /*
   * Reviews go here, immediately after the catalogue and before anything with a router-level guard.
   *
   * `notificationRouter` is mounted on `/api` and calls `router.use(requireAuth)`, which applies to
   * every request that reaches that router — not only to its own paths. Anything public mounted
   * after it therefore answers 401 before its own handler is consulted, which is exactly what the
   * public review listing did until it was moved above.
   */
  app.use("/api", reviewsRouter);
  app.use("/api", walletRouter);
  app.use("/api", notificationRouter);
  app.use("/api/waiting-room", waitingRoomRouter);
  app.use("/api/ai", aiRouter);
  // `reservationsRouter` has a router-wide auth guard. Mount wallet first so the
  // public, signature-verified VNPay IPN callback can reach its handler.
  app.use("/api", reservationsRouter);
  app.use("/api/organizer", seatmapRouter);
  // Studio owns PATCH /events/:id — it widened the handler beyond four text fields and made it
  // transactional with re-moderation, so it must be mounted AHEAD of the catalog organizer router
  // that used to serve that path (feature 006).
  app.use("/api/organizer", studioRouter);
  app.use("/api/organizer", adsOrganizerRouter);
  app.use("/api/organizer", organizerRouter);
  // One router owns /api/admin.  supersedes the old catalog moderation router: it
  // serves every route that one did and adds organizers, reports and audit logs. Mounting both
  // would leave five paths resolved by registration order, which is not a decision anyone made.
  app.use("/api/admin", adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
