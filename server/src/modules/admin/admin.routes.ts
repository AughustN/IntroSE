import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { err } from '../../http.js';
import { requireAdmin } from '../../middleware/authz.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import { listAuditLogs } from './audit.js';
import { approveOrganizer, categories, createCategory, dismissReport, featured, moderateEvent, queue, removeCategory, rejectOrganizer, replaceFeaturedEvents, renameCategory, resolveReportedEvent, suspendOrganizer } from './admin.service.js';
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
adminRouter.get('/categories', asyncH(async (_req, res) => { res.json(await categories()); }));
adminRouter.post('/categories', validate(categoryBody), asyncH(async (req, res) => { res.status(201).json(await createCategory(req.auth!.userId, req.body.labelVi, req.body.labelEn ?? null)); }));
adminRouter.put('/categories/:id', validate(categoryBody), asyncH(async (req, res) => { res.json(await renameCategory(req.auth!.userId, id(req), req.body.labelVi, req.body.labelEn ?? null)); }));
adminRouter.delete('/categories/:id', asyncH(async (req, res) => { await removeCategory(req.auth!.userId, id(req)); res.status(204).end(); }));
adminRouter.get('/homepage/featured', asyncH(async (_req, res) => { res.json(await featured()); }));
adminRouter.put('/homepage/featured', validate(featuredBody), asyncH(async (req, res) => { res.json(await replaceFeaturedEvents(req.auth!.userId, req.body.events)); }));
adminRouter.get('/settings', asyncH(async (_req, res) => { res.json(await getSettings()); }));
adminRouter.put('/settings', validate(settingsBody), asyncH(async (req, res) => { res.json(await updateSettings(req.auth!.userId, req.body)); }));
