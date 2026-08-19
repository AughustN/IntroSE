import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { err } from "../../http.js";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { getEventDetail } from "./catalog.repo.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { validate } from "../../middleware/validate.js";
import {
  addSeats,
  addShowtimeWithTiers,
  categoryExists,
  createEvent,
  createSection,
  createVenue,
  deleteSeat,
  eventOwnerUserId,
  eventShowtimesManage,
  finishEvent,
  listSections,
  categoriesWithInventory,
  defaultLayoutId,
  generateSeatMap,
  layoutBinding,
  pricedCategories,
  getApprovedOrganizerId,
  listMyEvents,
  listMyVenues,
  publishEvent,
  seatInLiveMap,
  seatVenueOwnerUserId,
  showtimeHasSeatMap,
  showtimeInfo,
  unpublishEvent,
  updateEvent,
  venueOwnerUserId,
} from "./catalog.write.js";
import {
  kickNotificationWorker,
  queueAnnouncement,
} from "../notifications/notifications.service.js";
import { cancelEvent, checkInTicket, lookupTicket } from "../payments/tickets.service.js";
import { attendees, checkIn, toCsv } from "../checkin/checkin.service.js";
import { getOrganizerAnalyticsController } from "../organizer/analyticsController.js";

// Organizer catalog management — approved organizer + ownership (D-D). Mounted at /api.
export const organizerRouter = Router();
organizerRouter.use(requireAuth, requireOrganizer);

organizerRouter.get("/analytics/dashboard", getOrganizerAnalyticsController);
organizerRouter.get("/analytics", getOrganizerAnalyticsController);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function assertOwn(req: Request, ownerUserId: number | null): void {
  if (ownerUserId === null) throw err.notFound("not_found");
  if (ownerUserId !== req.auth!.userId && !req.auth!.user.isAdmin)
    throw err.forbidden("not_owner", "Bạn không sở hữu tài nguyên này.");
}
async function assertEventOwner(req: Request, eventId: number): Promise<void> {
  const owner = await eventOwnerUserId(eventId);
  if (owner === null) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
  assertOwn(req, owner);
}
async function assertVenueOwner(req: Request, venueId: number): Promise<void> {
  assertOwn(req, await venueOwnerUserId(venueId));
}

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  categoryCode: z.string().trim().min(1),
  description: z.string().trim().min(1),
  eventType: z.enum(["general_admission", "seated"]),
  ageRestriction: z.enum(["all", "13+", "16+", "18+"]).optional(),
  imageUrl: z.string().url().optional().nullable(),
  refundPolicy: z.string().optional().nullable(),
});
const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).optional(),
  imageUrl: z.string().url().optional().nullable(),
  refundPolicy: z.string().optional().nullable(),
});
const venueSchema = z.object({
  name: z.string().trim().min(1),
  city: z.string().trim().min(1),
  rawAddress: z.string().trim().min(1),
  guide: z.string().optional().nullable(),
});
const showtimeSchema = z.object({
  venueId: z.number().int(),
  startsAt: z.string().datetime(),
  // A showtime carries at most 4 ticket tiers — the catalog UI lays them out in an even 1–4 column
  // row, and more than four stops being scannable for a buyer.
  tiers: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        price: z.number().int().nonnegative(),
        totalQuantity: z.number().int().positive().optional().nullable(),
        /** Seated only: the chart class this price applies to (feature 005 categories). */
        categoryId: z.number().int().optional().nullable(),
      }),
    )
    .min(1)
    .max(4, "Mỗi suất chỉ có tối đa 4 hạng vé."),
});
const announcementSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});
const checkInSchema = z.union([
  z.object({ code: z.string().trim().min(1).max(200) }).strict(),
  z.object({ barcode: z.string().trim().min(4).max(120) }).strict(),
]);

// ---- events ----

organizerRouter.get(
  "/events",
  asyncH(async (req, res) => {
    res.json(await listMyEvents(req.auth!.userId));
  }),
);

organizerRouter.post(
  "/events",
  validate(createEventSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof createEventSchema>;
    const orgId = await getApprovedOrganizerId(req.auth!.userId);
    if (!orgId) throw err.forbidden("forbidden", "Chỉ nhà tổ chức đã duyệt mới tạo được sự kiện.");
    if (!(await categoryExists(body.categoryCode)))
      throw err.badRequest("validation_failed", "Danh mục không hợp lệ.");
    res.status(201).json(await createEvent(orgId, body));
  }),
);

// PATCH /events/:id now lives in modules/studio (feature 006). It was widened beyond the four text
// fields and had to become transactional with the UC-24 A6 re-moderation, so keeping a second handler
// for the same resource would be exactly the contract drift Principle VI forbids. `studioRouter` is
// mounted ahead of this router in app.ts.

organizerRouter.post(
  "/events/:id/publish",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    if (!(await publishEvent(id)))
      throw err.unprocessable(
        "needs_showtime_and_tier",
        "Cần ít nhất 1 suất chiếu sắp tới có hạng vé.",
      );
    res.json({ ok: true, message: "Đã gửi duyệt. Sự kiện sẽ hiển thị sau khi admin duyệt." });
  }),
);

organizerRouter.post(
  "/events/:id/unpublish",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    await unpublishEvent(id);
    res.json({ ok: true });
  }),
);

organizerRouter.post(
  "/events/:id/announcements",
  validate(announcementSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    const body = req.body as z.infer<typeof announcementSchema>;
    const recipients = await queueAnnouncement(pool, id, req.auth!.userId, body.title, body.body);
    kickNotificationWorker();
    res.status(202).json({ ok: true, recipients });
  }),
);

/** Mandatory and length-checked HERE as well as in the dialog: the audit row is only worth keeping
 *  if the reason in it is one somebody actually wrote. */
const cancelEventSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/**
 * The organizer's own event, as a buyer would see it — before it is submitted for review.
 *
 * Keyed by event ID rather than slug so `assertEventOwner` guards it exactly like every other write
 * here. That guard is what makes the `asOwner` read safe: the public `/events/:slug` route is
 * untouched and still 404s on anything not on sale and approved.
 */
organizerRouter.get(
  "/events/:id/preview",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    const { rows } = await pool.query<{ slug: string }>(
      `SELECT slug FROM events WHERE id = $1`,
      [id],
    );
    const slug = rows[0]?.slug;
    if (!slug) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
    const detail = await getEventDetail(slug, pool, { asOwner: true });
    if (!detail) throw err.notFound("not_found", "Không tìm thấy sự kiện.");
    res.json(detail);
  }),
);

organizerRouter.post(
  "/events/:id/cancel",
  validate(cancelEventSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    const { reason } = req.body as z.infer<typeof cancelEventSchema>;
    res.json(await cancelEvent(id, reason, req.auth!.userId));
  }),
);

organizerRouter.post(
  '/events/:id/complete',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    await finishEvent(id);
    res.json({ ok: true, message: 'Sự kiện đã được đánh dấu hoàn tất.' });
  }),
);

// ---- check-in (US6) ----

organizerRouter.get(
  "/tickets/lookup",
  asyncH(async (req, res) => {
    const code = String(req.query.code ?? "").trim();
    if (!code) throw err.badRequest("validation_failed", "Thiếu mã vé.");
    res.json(await lookupTicket(code, req.auth!.userId));
  }),
);

organizerRouter.post(
  "/events/:id/showtimes",
  validate(showtimeSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    const body = req.body as z.infer<typeof showtimeSchema>;
    const venueOwner = await venueOwnerUserId(body.venueId);
    if (venueOwner === null) throw err.badRequest("validation_failed", "Địa điểm không tồn tại.");
    if (venueOwner !== req.auth!.userId && !req.auth!.user.isAdmin)
      throw err.forbidden("not_owner", "Bạn không sở hữu địa điểm này.");
    const showtimeId = await addShowtimeWithTiers(id, body);
    res.status(201).json({ id: showtimeId });
  }),
);

// ---- the door (UC-27, UC-28, UC-29) ----

/*
 * Scanning and the attendee list belong to whoever runs the event, which is why they are here and
 * not only in the admin console. The service decides ownership from the ticket's own organizer, so
 * an organizer scanning another organizer's code is answered "not found" — the same answer an
 * invented code gets, because a scanner at a public door must not confirm which codes exist.
 */
organizerRouter.post(
  "/tickets/check-in",
  validate(checkInSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof checkInSchema>;
    if ("code" in body) {
      res.json(await checkInTicket(body.code, req.auth!.userId));
      return;
    }
    res.json(
      await checkIn({ userId: req.auth!.userId, isAdmin: req.auth!.user.isAdmin }, body.barcode),
    );
  }),
);

organizerRouter.get(
  "/events/:id/attendees",
  asyncH(async (req, res) => {
    const eventId = Number(req.params.id);
    await assertEventOwner(req, eventId);
    const showtimeId = req.query.showtimeId === undefined ? undefined : Number(req.query.showtimeId);
    if (showtimeId !== undefined && !Number.isInteger(showtimeId))
      throw err.badRequest("validation_failed", "Mã suất diễn không hợp lệ.");
    // Unpaged here: this route has always answered with the whole list and its only consumer is the
    // organizer's own door screen. Widening it to pages is a change to that screen, not to this one.
    const list = await attendees(
      { userId: req.auth!.userId, isAdmin: req.auth!.user.isAdmin },
      eventId,
      { showtimeId, limit: null, offset: 0 },
    );
    if (req.query.format !== "csv") {
      res.json(list);
      return;
    }
    res
      .type("text/csv; charset=utf-8")
      .attachment(`khach-tham-du-${list.eventId}.csv`)
      .send(toCsv(list));
  }),
);

// ---- venues ----

organizerRouter.get(
  "/venues",
  asyncH(async (req, res) => {
    res.json(await listMyVenues(req.auth!.userId));
  }),
);

organizerRouter.post(
  "/venues",
  validate(venueSchema),
  asyncH(async (req, res) => {
    const id = await createVenue(req.auth!.userId, req.body as z.infer<typeof venueSchema>);
    res.status(201).json({ id });
  }),
);

// ---- sections / seats / seat-map generation (US5, R-7) ----

const sectionSchema = z.object({ name: z.string().trim().min(1) });
const seatsSchema = z.object({
  sectionId: z.number().int(),
  rowLabel: z.string().trim().min(1),
  count: z.number().int().min(1).max(200),
});
// The category→tier mapping is no longer sent here: it lives on `ticket_tiers.category_id`. All this
// call still has to say is WHICH chart of the venue to bind; omit it and the venue's default is used,
// which is what the venue-level helper paths have always done.
const seatMapSchema = z.object({
  layoutId: z.number().int().optional(),
});

organizerRouter.get(
  "/venues/:id/sections",
  asyncH(async (req, res) => {
    const venueId = Number(req.params.id);
    await assertVenueOwner(req, venueId);
    res.json(await listSections(venueId));
  }),
);

organizerRouter.get(
  "/events/:id/showtimes-manage",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    res.json(await eventShowtimesManage(id));
  }),
);

organizerRouter.post(
  "/venues/:id/sections",
  validate(sectionSchema),
  asyncH(async (req, res) => {
    const venueId = Number(req.params.id);
    await assertVenueOwner(req, venueId);
    res
      .status(201)
      .json({ id: await createSection(venueId, (req.body as z.infer<typeof sectionSchema>).name) });
  }),
);

organizerRouter.post(
  "/venues/:id/seats",
  validate(seatsSchema),
  asyncH(async (req, res) => {
    const venueId = Number(req.params.id);
    await assertVenueOwner(req, venueId);
    const b = req.body as z.infer<typeof seatsSchema>;
    res.status(201).json({ count: await addSeats(venueId, b.sectionId, b.rowLabel, b.count) });
  }),
);

organizerRouter.delete(
  "/seats/:id",
  asyncH(async (req, res) => {
    const seatId = Number(req.params.id);
    assertOwn(req, await seatVenueOwnerUserId(seatId));
    if (await seatInLiveMap(seatId))
      throw err.conflict("venue_in_use", "Ghế đang thuộc một sơ đồ ghế, không thể xoá.");
    await deleteSeat(seatId);
    res.status(204).end();
  }),
);

// Generate a seated showtime's seat map — one seat per physical seat, tier assigned per section (R-7).
organizerRouter.post(
  "/showtimes/:id/seat-map",
  validate(seatMapSchema),
  asyncH(async (req, res) => {
    const showtimeId = Number(req.params.id);
    const info = await showtimeInfo(showtimeId);
    if (!info) throw err.notFound("not_found", "Không tìm thấy suất chiếu.");
    assertOwn(req, info.ownerUserId);
    if (info.eventType !== "seated")
      throw err.badRequest("validation_failed", "Chỉ sự kiện có ghế mới tạo được sơ đồ ghế.");
    // Feature 005 replaced the blanket `409 seat_map_exists` — a map that already exists is corrected
    // through PUT /organizer/showtimes/:id/seat-map or a re-apply, each evaluated PER SEAT against
    // live inventory (FR-027..FR-029). Generation itself still runs only once, because a second run
    // would duplicate every bookable seat.
    if (await showtimeHasSeatMap(showtimeId)) {
      throw err.conflict(
        "map_edit_refused",
        "Suất này đã có sơ đồ ghế. Hãy chỉnh sửa sơ đồ hiện có hoặc áp dụng lại bố cục nguồn.",
      );
    }

    const { layoutId } = req.body as z.infer<typeof seatMapSchema>;
    const chart = layoutId ?? (await defaultLayoutId(info.venueId));
    const binding = await layoutBinding(chart);
    if (!binding) throw err.notFound("not_found", "Không tìm thấy sơ đồ.");
    if (binding.venueId !== info.venueId)
      throw err.badRequest("validation_failed", "Sơ đồ không thuộc địa điểm của suất chiếu này.");
    // A draft is a work in progress: binding one would sell seats the organizer is still moving.
    // `layout_not_published` has been in the error contract since 005 shipped; this is its throw site.
    if (binding.status !== "ready")
      throw err.conflict(
        "layout_not_published",
        "Sơ đồ chưa được phát hành. Hãy phát hành sơ đồ trước khi tạo bản đồ ghế.",
      );

    // Every class that holds INVENTORY must have a price, or it would be unsellable. Seats and
    // capacity zones both count — a zone-only class used to slip through here and be dropped silently.
    const priced = new Set(await pricedCategories(showtimeId));
    const unpriced = (await categoriesWithInventory(chart)).filter((c) => !priced.has(c));
    if (unpriced.length > 0)
      throw err.badRequest("category_without_tier", "Mỗi hạng vé có ghế phải được gán một giá vé.");

    res.status(201).json({ seats: await generateSeatMap(showtimeId, chart) });
  }),
);
