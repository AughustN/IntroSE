import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { validate } from "../../middleware/validate.js";
import { chat, generateEventListing, listBookmarks, recordEventView, toggleBookmark } from "./ai.service.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

const asyncH = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/**
 * Conversation turns are bounded here, not truncated.
 *
 * A client that sends nine turns has a bug, and silently dropping one leaves the two sides
 * disagreeing about what was asked. `.strict()` throughout so an unknown field is a 400 rather than
 * something that slips into the prompt.
 */
const turnSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(600) }).strict();
const chatSchema = z.object({ message: z.string().trim().min(1).max(600), history: z.array(turnSchema).max(8).optional() }).strict();
const listingSchema = z.object({ brief: z.string().trim().min(1).max(3_000), category: z.string().trim().min(1).max(120).optional(), eventType: z.enum(["general_admission", "seated"]).optional() }).strict();

aiRouter.post("/chat", validate(chatSchema), asyncH(async (req, res) => { res.json(await chat(req.auth!.userId, req.body)); }));
aiRouter.post("/event-assistant", requireOrganizer, validate(listingSchema), asyncH(async (req, res) => { res.json(await generateEventListing(req.auth!.userId, req.body)); }));
aiRouter.get("/bookmarks", asyncH(async (req, res) => { res.json(await listBookmarks(req.auth!.userId)); }));
aiRouter.post("/events/:slug/bookmark", asyncH(async (req, res) => { res.json(await toggleBookmark(req.auth!.userId, req.params.slug)); }));
aiRouter.post("/events/:slug/view", asyncH(async (req, res) => { await recordEventView(req.auth!.userId, req.params.slug); res.status(204).end(); }));
