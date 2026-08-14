import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAdmin } from '../../middleware/authz.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { listAuditLogs } from './audit.js';
import { removeAsAdmin as removeReviewAsAdmin } from '../reviews/reviews.service.js';
import { approveOrganizer, categories, createCategory, dismissReport, featured, moderateEvent, queue, removeCategory, rejectOrganizer, replaceFeaturedEvents, renameCategory, resolveReportedEvent, suspendOrganizer } from './admin.service.js';
import { analytics, orders, overview, reviewReports, walletTransactions } from './analytics.repo.js';
import { eventReports, reportDetail } from './reports.repo.js';
import { attendees, checkIn, toCsv } from '../checkin/checkin.service.js';
import { getSettings, updateSettings } from './settings.service.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
const asyncH = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const id = (req: Request) => { const value = Number(req.params.id); if (!Number.isInteger(value) || value < 1) throw err.badRequest('validation_failed'); return value; };
const reason = z.object({ reason: z.string().trim().min(1).max(2000) });
const optionalReason = z.object({ reason: z.string().trim().min(1).max(2000).optional() });
const reportDecision = z.object({ decision: z.enum(['flag', 'remove']), reason: z.string().trim().min(1).max(2000) });
const categoryBody = z.object({ labelVi: z.string().trim().min(1).max(120), labelEn: z.string().trim().max(120).nullable().optional() }).strict();
const featuredBody = z.object({ events: z.array(z.object({ eventId: z.number().int().positive(), displayOrder: z.number().int().nonnegative() }).strict()).max(50) }).strict();
const settingsBody = z.object({
  seat_hold_ttl_minutes: z.number().int().min(1).max(30), topup_grace_minutes: z.number().int().min(1).max(15), absolute_ceiling_minutes: z.number().int().min(2).max(30), max_tickets_per_buyer: z.number().int().min(1).max(50),
  wallet_topup_min: z.number().int().nonnegative(), wallet_topup_max: z.number().int().nonnegative(), wallet_balance_ceiling: z.number().int().nonnegative(), ai_features_enabled: z.boolean(),
  ai_platform_request_ceiling: z.number().int().nonnegative(), ai_platform_window_hours: z.number().int().min(1).max(720),
}).strict();

adminRouter.get('/moderation', asyncH(async (_req, res) => { res.json((await queue()).events); }));
adminRouter.get('/moderation/queue', asyncH(async (_req, res) => { res.json(await queue()); }));
adminRouter.get('/organizers', asyncH(async (_req, res) => { res.json((await queue()).organizers); }));
adminRouter.post('/organizers/:id/approve', asyncH(async (req, res) => { res.json(await approveOrganizer(req.auth!.userId, id(req))); }));
adminRouter.post('/organizers/:id/reject', validate(reason), asyncH(async (req, res) => { res.json(await rejectOrganizer(req.auth!.userId, id(req), req.body.reason)); }));
adminRouter.post('/organizers/:id/suspend', validate(reason), asyncH(async (req, res) => { res.json(await suspendOrganizer(req.auth!.userId, id(req), req.body.reason)); }));
adminRouter.post('/events/:id/approve', asyncH(async (req, res) => { res.json(await moderateEvent(req.auth!.userId, id(req), 'approved', null)); }));
adminRouter.post('/events/:id/reject', validate(reason), asyncH(async (req, res) => { res.json(await moderateEvent(req.auth!.userId, id(req), 'removed', req.body.reason)); }));
adminRouter.post('/events/:id/flag', validate(optionalReason), asyncH(async (req, res) => { res.json(await moderateEvent(req.auth!.userId, id(req), 'flagged', req.body.reason ?? null)); }));
adminRouter.post('/events/:id/remove', validate(optionalReason), asyncH(async (req, res) => { res.json(await moderateEvent(req.auth!.userId, id(req), 'removed', req.body.reason ?? null)); }));
adminRouter.post('/reports/:id/dismiss', validate(optionalReason), asyncH(async (req, res) => { res.json(await dismissReport(req.auth!.userId, id(req), req.body.reason ?? null)); }));
adminRouter.post('/reports/:id/resolve', validate(reportDecision), asyncH(async (req, res) => { res.json(await resolveReportedEvent(req.auth!.userId, id(req), req.body.decision, req.body.reason)); }));
adminRouter.get('/audit-logs', asyncH(async (_req, res) => { res.json(await listAuditLogs()); }));
/*
 * Moderation removal for a review (009, UC-39 → UC-34).
 *
 * Hides rather than erases: the report that prompted it and the audit row it writes both need a
 * subject an admin can still read. The status change and the audit entry share one transaction, so
 * a removal without its record is not a state the database can be left in.
 */
adminRouter.delete('/reviews/:id', asyncH(async (req, res) => { await removeReviewAsAdmin(req.auth!.userId, id(req)); res.status(204).end(); }));

adminRouter.get('/categories', asyncH(async (_req, res) => { res.json(await categories()); }));
adminRouter.post('/categories', validate(categoryBody), asyncH(async (req, res) => { res.status(201).json(await createCategory(req.auth!.userId, req.body.labelVi, req.body.labelEn ?? null)); }));
adminRouter.put('/categories/:id', validate(categoryBody), asyncH(async (req, res) => { res.json(await renameCategory(req.auth!.userId, id(req), req.body.labelVi, req.body.labelEn ?? null)); }));
adminRouter.delete('/categories/:id', asyncH(async (req, res) => { await removeCategory(req.auth!.userId, id(req)); res.status(204).end(); }));
adminRouter.get('/homepage/featured', asyncH(async (_req, res) => { res.json(await featured()); }));
adminRouter.put('/homepage/featured', validate(featuredBody), asyncH(async (req, res) => { res.json(await replaceFeaturedEvents(req.auth!.userId, req.body.events)); }));
adminRouter.get('/settings', asyncH(async (_req, res) => { res.json(await getSettings()); }));
adminRouter.put('/settings', validate(settingsBody), asyncH(async (req, res) => { res.json(await updateSettings(req.auth!.userId, req.body)); }));

/*
 * ── Read models (UC-31, UC-32) ─────────────────────────────────────────────────────────────────
 *
 * Aggregated in SQL, never in the browser. The console's revenue figure used to be summed from the
 * *viewer's own* booking history, so it changed with whoever was signed in.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo dạng YYYY-MM-DD');
/** A day count, not a date, so the caller cannot ask for a range with no end. */
const positiveInt = (max: number) => z.coerce.number().int().min(1).max(max);
const analyticsQuery = z.object({ from: day.optional(), to: day.optional(), organizerId: z.coerce.number().int().positive().optional(), category: z.string().trim().min(1).max(40).optional() });
const ordersQuery = z.object({ q: z.string().trim().min(1).max(200).optional(), status: z.enum(['pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled']).optional(), limit: positiveInt(200).optional(), offset: z.coerce.number().int().nonnegative().optional() });
const walletQuery = z.object({ kind: z.enum(['topup', 'purchase', 'refund']).optional(), limit: positiveInt(500).optional() });
const barcodeBody = z.object({ barcode: z.string().trim().min(4).max(120) }).strict();
const attendeeQuery = z.object({ showtimeId: z.coerce.number().int().positive().optional(), format: z.enum(['json', 'csv']).optional() });

const parseQuery = <T>(schema: z.ZodType<T>, req: Request): T => {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) throw err.badRequest('validation_failed', parsed.error.issues[0]?.message ?? 'Tham số không hợp lệ.');
  return parsed.data;
};
/** `YYYY-MM-DD`, `days` ago — the default range both analytics screens open on. */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

adminRouter.get('/overview', asyncH(async (_req, res) => { res.json(await overview()); }));
adminRouter.get('/analytics', asyncH(async (req, res) => {
  const q = parseQuery(analyticsQuery, req);
  res.json(await analytics({ from: q.from ?? daysAgo(30), to: q.to ?? daysAgo(0), organizerId: q.organizerId, category: q.category }));
}));
adminRouter.get('/orders', asyncH(async (req, res) => {
  const q = parseQuery(ordersQuery, req);
  res.json(await orders({ query: q.q, status: q.status, limit: q.limit ?? 50, offset: q.offset ?? 0 }));
}));
/*
 * Reported comments, decided ones included — the queue endpoint above only lists what is open, and
 * a moderator checking "did we already handle this?" had nowhere to look.
 */
const reviewReportQuery = z.object({ q: z.string().trim().min(1).max(200).optional(), status: z.enum(['open', 'done']).optional(), limit: positiveInt(100).optional(), offset: z.coerce.number().int().nonnegative().optional() });
adminRouter.get('/review-reports', asyncH(async (req, res) => {
  const q = parseQuery(reviewReportQuery, req);
  res.json(await reviewReports({ query: q.q, status: q.status, limit: q.limit ?? 25, offset: q.offset ?? 0 }));
}));
/*
 * Reported events, and one report in full.
 *
 * The queue endpoint lists only what is open and carries just the target's id; deciding whether an
 * event should come down needs the event — its description, its organizer, how many tickets it has
 * already sold — which is what the detail route serves.
 */
const contentReportQuery = z.object({ q: z.string().trim().min(1).max(200).optional(), status: z.enum(['open', 'flagged', 'resolved', 'dismissed']).optional(), limit: positiveInt(100).optional(), offset: z.coerce.number().int().nonnegative().optional() });
adminRouter.get('/content-reports', asyncH(async (req, res) => {
  const q = parseQuery(contentReportQuery, req);
  res.json(await eventReports({ query: q.q, status: q.status, limit: q.limit ?? 25, offset: q.offset ?? 0 }));
}));
adminRouter.get('/content-reports/:id', asyncH(async (req, res) => { res.json(await reportDetail(id(req))); }));

adminRouter.get('/wallet-transactions', asyncH(async (req, res) => {
  const q = parseQuery(walletQuery, req);
  res.json(await walletTransactions(q.limit ?? 100, q.kind));
}));

/*
 * The door, from the console (UC-27, UC-28, UC-29).
 *
 * The same two operations are mounted on the organizer router as well. An admin is not necessarily
 * an approved organizer — `requireOrganizer` derives that from the organizers table — so an admin
 * reaching for the organizer route would be refused by a rule meant for somebody else. One service,
 * two doors, ownership decided inside.
 */
const actor = (req: Request) => ({ userId: req.auth!.userId, isAdmin: true });
adminRouter.post('/tickets/check-in', validate(barcodeBody), asyncH(async (req, res) => { res.json(await checkIn(actor(req), req.body.barcode)); }));
adminRouter.get('/events/:id/attendees', asyncH(async (req, res) => {
  const q = parseQuery(attendeeQuery, req);
  const list = await attendees(actor(req), id(req), q.showtimeId);
  if (q.format !== 'csv') { res.json(list); return; }
  res.type('text/csv; charset=utf-8').attachment(`khach-tham-du-${list.eventId}.csv`).send(toCsv(list));
}));
