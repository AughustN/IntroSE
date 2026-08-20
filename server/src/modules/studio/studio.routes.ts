import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { err } from "../../http.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { validate } from "../../middleware/validate.js";
import { draftListing } from "./ai/listing.service.js";
import multer from 'multer';
import { uploadEventBanner, uploadEventTrailer, deleteEventTrailer } from '../media/eventMedia.js';
import { deleteEvent, updateEvent } from "./events.service.js";
import {
  deleteShowtime,
  showtimeContext,
  updateShowtime,
  type ShowtimeContext,
} from "./showtimes.service.js";
import { showtimeEventType, tierContext, type TierContext } from "./tiers.repo.js";
import { addTier, listManagedTiers, removeTier, restoreTier, updateTier } from "./tiers.service.js";

/**
 * Organizer event studio (feature 006). Mounted at /api/organizer behind requireAuth +
 * requireOrganizer.
 *
 * Every handler resolves ownership on the SERVER through tier → showtime → event → organizer → user,
 * and another organizer's resource is a refusal, never a row the client could unfilter (SEC-04,
 * FR-035, FR-036). The client never supplies an organizer id; the session identity is authoritative.
 */
export const studioRouter = Router();
studioRouter.use(requireAuth, requireOrganizer);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---- ownership ------------------------------------------------------------

function assertOwn(req: Request, ownerUserId: number | null | undefined): void {
  if (ownerUserId === null || ownerUserId === undefined) throw err.notFound("not_found");
  if (ownerUserId !== req.auth!.userId && !req.auth!.user.isAdmin) {
    throw err.forbidden("not_owner", "Bạn không sở hữu tài nguyên này.");
  }
}

function idParam(req: Request, name = "id"): number {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw err.notFound("not_found");
  return id;
}

async function ownedTier(req: Request): Promise<TierContext> {
  const ctx = await tierContext(idParam(req));
  if (!ctx) throw err.notFound("not_found", "Không tìm thấy hạng vé.");
  assertOwn(req, ctx.owner_user_id);
  return ctx;
}

async function ownedShowtime(req: Request): Promise<ShowtimeContext> {
  const ctx = await showtimeContext(idParam(req));
  if (!ctx) throw err.notFound("not_found", "Không tìm thấy suất chiếu.");
  assertOwn(req, ctx.owner_user_id);
  return ctx;
}

async function ownedEvent(req: Request): Promise<number> {
  const eventId = idParam(req);
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT o.user_id FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $1`,
    [eventId],
  );
  if (!rows[0]) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  assertOwn(req, rows[0].user_id);
  return eventId;
}

/** Resolve a showtime the caller owns, returning its event type — the tier routes' entry point. */
async function ownedShowtimeForTiers(
  req: Request,
): Promise<{ showtimeId: number; eventType: "general_admission" | "seated" }> {
  const showtimeId = idParam(req);
  const ctx = await showtimeEventType(showtimeId);
  if (!ctx) throw err.notFound("not_found", "Không tìm thấy suất chiếu.");
  assertOwn(req, ctx.ownerUserId);
  return { showtimeId, eventType: ctx.eventType };
}

// ---- schemas (SEC-07: every input validated before use) --------------------

const dong = z.number().int().nonnegative();

const addTierSchema = z.object({
  label: z.string().trim().min(1).max(80),
  price: dong,
  capacity: z.number().int().nonnegative().nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
});

const updateTierSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    price: dong.optional(),
    capacity: z.number().int().nonnegative().optional(),
    categoryId: z.number().int().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty" });

const updateShowtimeSchema = z
  .object({
    startsAt: z.string().datetime().optional(),
    venueId: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty" });

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).optional(),
    imageUrl: z.string().url().nullable().optional(),
    refundPolicy: z.string().nullable().optional(),
    ageRestriction: z.enum(["all", "13+", "16+", "18+"]).optional(),
    categoryCode: z.string().trim().min(1).optional(),
    isHighDemand: z.boolean().optional(),
    is_high_demand: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty" });

// ---- tiers (UC-26) --------------------------------------------------------

studioRouter.get(
  "/showtimes/:id/tiers",
  asyncH(async (req, res) => {
    const { showtimeId, eventType } = await ownedShowtimeForTiers(req);
    res.json(await listManagedTiers(showtimeId, eventType));
  }),
);

studioRouter.post(
  "/showtimes/:id/tiers",
  validate(addTierSchema),
  asyncH(async (req, res) => {
    const { showtimeId } = await ownedShowtimeForTiers(req);
    res
      .status(201)
      .json(await addTier(req.auth!.userId, showtimeId, req.body as z.infer<typeof addTierSchema>));
  }),
);

studioRouter.patch(
  "/tiers/:id",
  validate(updateTierSchema),
  asyncH(async (req, res) => {
    const ctx = await ownedTier(req);
    res.json(await updateTier(req.auth!.userId, ctx, req.body as z.infer<typeof updateTierSchema>));
  }),
);

studioRouter.delete(
  "/tiers/:id",
  asyncH(async (req, res) => {
    const ctx = await ownedTier(req);
    res.json(await removeTier(req.auth!.userId, ctx));
  }),
);

studioRouter.post(
  "/tiers/:id/restore",
  asyncH(async (req, res) => {
    const ctx = await ownedTier(req);
    res.json(await restoreTier(req.auth!.userId, ctx));
  }),
);

// ---- showtimes (UC-23) ----------------------------------------------------

studioRouter.patch(
  "/showtimes/:id",
  validate(updateShowtimeSchema),
  asyncH(async (req, res) => {
    const ctx = await ownedShowtime(req);
    const body = req.body as z.infer<typeof updateShowtimeSchema>;
    res.json(await updateShowtime(req.auth!.userId, ctx, body, Boolean(req.auth!.user.isAdmin)));
  }),
);

studioRouter.delete(
  "/showtimes/:id",
  asyncH(async (req, res) => {
    const ctx = await ownedShowtime(req);
    res.json(await deleteShowtime(req.auth!.userId, ctx));
  }),
);

// ---- events (UC-23, FR-020) ----------------------------------------------

studioRouter.patch(
  "/events/:id",
  validate(updateEventSchema),
  asyncH(async (req, res) => {
    const eventId = await ownedEvent(req);
    res.json(
      await updateEvent(req.auth!.userId, eventId, req.body as z.infer<typeof updateEventSchema>),
    );
  }),
);

studioRouter.delete(
  "/events/:id",
  asyncH(async (req, res) => {
    const eventId = await ownedEvent(req);
    await deleteEvent(eventId);
    res.status(204).end();
  }),
);

// ---- AI listing assistant (UC-22) ----------------------------------------

const listingSchema = z.object({
  eventId: z.number().int().positive().optional(),
  topic: z.string().trim().min(1).max(200),
  keywords: z.array(z.string().trim().max(40)).max(10).optional(),
  categoryCode: z.string().trim().min(1).optional(),
  city: z.string().trim().max(80).optional(),
});

studioRouter.post(
  "/ai/listing",
  validate(listingSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof listingSchema>;
    // Degradation returns 200 with `available: false` — never an error status, so the client's
    // fallback is the ordinary rendering path (Principle III, PERF-05, SCAL-03).
    res.json(await draftListing(req.auth!.userId, Boolean(req.auth!.user.isAdmin), body));
  }),
);

// ---- event media (012-cloudinary-media-upload) ----------------------------

const uploadBanner = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadTrailer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

studioRouter.post(
  "/events/:id/banner",
  uploadBanner.single("banner"),
  asyncH(async (req, res) => {
    const eventId = await ownedEvent(req);
    if (!req.file?.buffer) throw err.badRequest("validation_failed", "Thiếu tệp hình ảnh banner.");
    const bannerUrl = await uploadEventBanner(eventId, req.file.buffer);
    await pool.query(`UPDATE events SET image_url = $1, updated_at = now() WHERE id = $2`, [bannerUrl, eventId]);
    res.json({ bannerUrl, imageUrl: bannerUrl });
  }),
);

studioRouter.post(
  "/events/:id/trailer",
  uploadTrailer.single("trailer"),
  asyncH(async (req, res) => {
    const eventId = await ownedEvent(req);
    if (!req.file?.buffer) throw err.badRequest("validation_failed", "Thiếu tệp video trailer.");
    const trailerUrl = await uploadEventTrailer(eventId, req.file.buffer);
    await pool.query(`UPDATE events SET trailer_url = $1, updated_at = now() WHERE id = $2`, [trailerUrl, eventId]);
    res.json({ trailerUrl });
  }),
);

studioRouter.delete(
  "/events/:id/trailer",
  asyncH(async (req, res) => {
    const eventId = await ownedEvent(req);
    await deleteEventTrailer(eventId);
    await pool.query(`UPDATE events SET trailer_url = NULL, updated_at = now() WHERE id = $1`, [eventId]);
    res.json({ trailerUrl: null });
  }),
);

