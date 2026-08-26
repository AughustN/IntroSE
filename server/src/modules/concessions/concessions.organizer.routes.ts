import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./concessions.service.js";

/**
 * Organizer menu CRUD (feature 014 US2) — mounted at /api/organizer/events/:eventId/concessions.
 * Thin on purpose: ownership and business rules live in concessions.service so the same gates
 * guard any future caller.
 */
export const concessionsOrganizerRouter = Router();
concessionsOrganizerRouter.use(requireAuth, requireOrganizer);

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const actorOf = (req: Request): service.Actor => ({
  userId: req.auth!.userId,
  isAdmin: req.auth!.user.isAdmin,
});

// priceAmount is typed loosely here on purpose — the service turns a bad number into the
// feature's own 422 invalid_price instead of the generic validation_failed.
const fieldsSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullish(),
  priceAmount: z.number(),
});

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(300).nullish(),
  priceAmount: z.number().optional(),
});

const stateSchema = z.object({ state: z.enum(["listed", "stopped"]) });

const eventIdOf = (req: Request): number => Number(req.params.eventId);
const itemIdOf = (req: Request): number => Number(req.params.concessionId);

concessionsOrganizerRouter.get(
  "/events/:eventId/concessions",
  asyncH(async (req, res) => {
    const items = await service.getOwnedMenu(actorOf(req), eventIdOf(req));
    res.json({ items });
  }),
);

concessionsOrganizerRouter.post(
  "/events/:eventId/concessions",
  validate(fieldsSchema),
  asyncH(async (req, res) => {
    const item = await service.createItem(actorOf(req), eventIdOf(req), {
      label: req.body.label,
      description: req.body.description ?? null,
      priceAmount: req.body.priceAmount,
    });
    res.status(201).json({ item });
  }),
);

concessionsOrganizerRouter.put(
  "/events/:eventId/concessions/:concessionId",
  validate(patchSchema),
  asyncH(async (req, res) => {
    const item = await service.updateItem(actorOf(req), eventIdOf(req), itemIdOf(req), {
      label: req.body.label,
      description: req.body.description,
      priceAmount: req.body.priceAmount,
    });
    res.json({ item });
  }),
);

concessionsOrganizerRouter.patch(
  "/events/:eventId/concessions/:concessionId",
  validate(stateSchema),
  asyncH(async (req, res) => {
    const item = await service.changeItemState(
      actorOf(req),
      eventIdOf(req),
      itemIdOf(req),
      req.body.state,
    );
    res.json({ item });
  }),
);

concessionsOrganizerRouter.delete(
  "/events/:eventId/concessions/:concessionId",
  asyncH(async (req, res) => {
    await service.removeItem(actorOf(req), eventIdOf(req), itemIdOf(req));
    res.status(204).send();
  }),
);
