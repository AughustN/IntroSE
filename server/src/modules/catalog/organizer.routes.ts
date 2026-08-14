import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { err } from "../../http.js";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/requireAuth.js";
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
  listSections,
  generateSeatMap,
  getApprovedOrganizerId,
  listMyEvents,
  listMyVenues,
  publishEvent,
  sectionsWithSeats,
  seatInLiveMap,
  seatVenueOwnerUserId,
  showtimeHasSeatMap,
  showtimeInfo,
  tiersOfShowtime,
  unpublishEvent,
  updateEvent,
  venueOwnerUserId,
} from "./catalog.write.js";
import {
  kickNotificationWorker,
  queueAnnouncement,
} from "../notifications/notifications.service.js";
import { cancelEvent, checkInTicket, lookupTicket } from "../payments/tickets.service.js";

// Organizer catalog management — approved organizer + ownership (D-D). Mounted at /api.
export const organizerRouter = Router();
organizerRouter.use(requireAuth, requireOrganizer);

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
      }),
    )
    .min(1)
    .max(4, "Mỗi suất chỉ có tối đa 4 hạng vé."),
});
const announcementSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});

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

organizerRouter.patch(
  "/events/:id",
  validate(updateEventSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    const updated = await updateEvent(id, req.body as z.infer<typeof updateEventSchema>);
    kickNotificationWorker();
    res.json(updated);
  }),
);

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

organizerRouter.post(
  "/events/:id/cancel",
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    res.json(await cancelEvent(id));
  }),
);

// ---- check-in (US6) ----

const checkInSchema = z.object({ code: z.string().trim().min(1).max(200) });

organizerRouter.get(
  "/tickets/lookup",
  asyncH(async (req, res) => {
    const code = String(req.query.code ?? "").trim();
    if (!code) throw err.badRequest("validation_failed", "Thiếu mã vé.");
    res.json(await lookupTicket(code, req.auth!.userId));
  }),
);

organizerRouter.post(
  "/tickets/check-in",
  validate(checkInSchema),
  asyncH(async (req, res) => {
    const { code } = req.body as z.infer<typeof checkInSchema>;
    const { ticket, already } = await checkInTicket(code, req.auth!.userId);
    res.json({ ticket, already });
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
const seatMapSchema = z.object({
  sectionTiers: z
    .array(z.object({ sectionId: z.number().int(), ticketTierId: z.number().int() }))
    .min(1),
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

    const { sectionTiers } = req.body as z.infer<typeof seatMapSchema>;
    const mappedSections = new Set(sectionTiers.map((m) => m.sectionId));
    const withSeats = await sectionsWithSeats(info.venueId);
    if (withSeats.some((s) => !mappedSections.has(s)))
      throw err.badRequest("section_without_tier", "Mỗi khu vực có ghế phải được gán một hạng vé.");
    const validTiers = new Set(await tiersOfShowtime(showtimeId));
    if (sectionTiers.some((m) => !validTiers.has(m.ticketTierId)))
      throw err.badRequest("validation_failed", "Hạng vé không thuộc suất chiếu này.");

    res.status(201).json({ seats: await generateSeatMap(showtimeId, sectionTiers) });
  }),
);
