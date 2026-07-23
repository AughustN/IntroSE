import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireOrganizer } from '../../middleware/authz.js';
import { validate } from '../../middleware/validate.js';
import {
  addShowtimeWithTiers,
  categoryExists,
  createEvent,
  createVenue,
  eventOwnerUserId,
  getApprovedOrganizerId,
  listMyEvents,
  listMyVenues,
  publishEvent,
  unpublishEvent,
  updateEvent,
  venueOwnerUserId,
} from './catalog.write.js';

// Organizer catalog management — approved organizer + ownership (D-D). Mounted at /api.
export const organizerRouter = Router();
organizerRouter.use(requireAuth, requireOrganizer);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

async function assertEventOwner(req: Request, eventId: number): Promise<void> {
  const owner = await eventOwnerUserId(eventId);
  if (owner === null) throw err.notFound('not_found', 'Không tìm thấy sự kiện.');
  if (owner !== req.auth!.userId && !req.auth!.user.isAdmin) throw err.forbidden('not_owner', 'Bạn không sở hữu sự kiện này.');
}

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  categoryCode: z.string().trim().min(1),
  description: z.string().trim().min(1),
  eventType: z.enum(['general_admission', 'seated']),
  ageRestriction: z.enum(['all', '13+', '16+', '18+']).optional(),
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
  tiers: z.array(z.object({ label: z.string().trim().min(1), price: z.number().int().nonnegative(), totalQuantity: z.number().int().positive().optional().nullable() })).min(1),
});

// ---- events ----

organizerRouter.get('/events', asyncH(async (req, res) => {
  res.json(await listMyEvents(req.auth!.userId));
}));

organizerRouter.post(
  '/events',
  validate(createEventSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof createEventSchema>;
    const orgId = await getApprovedOrganizerId(req.auth!.userId);
    if (!orgId) throw err.forbidden('forbidden', 'Chỉ nhà tổ chức đã duyệt mới tạo được sự kiện.');
    if (!(await categoryExists(body.categoryCode))) throw err.badRequest('validation_failed', 'Danh mục không hợp lệ.');
    res.status(201).json(await createEvent(orgId, body));
  }),
);

organizerRouter.patch(
  '/events/:id',
  validate(updateEventSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    res.json(await updateEvent(id, req.body as z.infer<typeof updateEventSchema>));
  }),
);

organizerRouter.post(
  '/events/:id/publish',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    if (!(await publishEvent(id))) throw err.unprocessable('needs_showtime_and_tier', 'Cần ít nhất 1 suất chiếu sắp tới có hạng vé.');
    res.json({ ok: true, message: 'Đã gửi duyệt. Sự kiện sẽ hiển thị sau khi admin duyệt.' });
  }),
);

organizerRouter.post(
  '/events/:id/unpublish',
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    await unpublishEvent(id);
    res.json({ ok: true });
  }),
);

organizerRouter.post(
  '/events/:id/showtimes',
  validate(showtimeSchema),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await assertEventOwner(req, id);
    const body = req.body as z.infer<typeof showtimeSchema>;
    const venueOwner = await venueOwnerUserId(body.venueId);
    if (venueOwner === null) throw err.badRequest('validation_failed', 'Địa điểm không tồn tại.');
    if (venueOwner !== req.auth!.userId && !req.auth!.user.isAdmin) throw err.forbidden('not_owner', 'Bạn không sở hữu địa điểm này.');
    const showtimeId = await addShowtimeWithTiers(id, body);
    res.status(201).json({ id: showtimeId });
  }),
);

// ---- venues ----

organizerRouter.get('/venues', asyncH(async (req, res) => {
  res.json(await listMyVenues(req.auth!.userId));
}));

organizerRouter.post(
  '/venues',
  validate(venueSchema),
  asyncH(async (req, res) => {
    const id = await createVenue(req.auth!.userId, req.body as z.infer<typeof venueSchema>);
    res.status(201).json({ id });
  }),
);
