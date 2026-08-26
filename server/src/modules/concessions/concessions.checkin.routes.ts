import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { isApprovedOrganizer } from "../auth/auth.repo.js";
import { err } from "../../http.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./concessions.service.js";

/**
 * Counter-side voucher redemption (feature 014 US3) — mounted at /api/checkin.
 *
 * The counter is staffed by the event's organizer OR an admin — wider than requireOrganizer,
 * which would turn a platform admin away for lacking an organizer application. Ownership beyond
 * that gate is still enforced inside the service.
 */
export const concessionsCheckinRouter = Router();

async function requireCounterStaff(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) throw err.forbidden("forbidden");
    if (!req.auth.user.isAdmin && !(await isApprovedOrganizer(req.auth.userId)))
      throw err.forbidden("forbidden");
    next();
  } catch (e) {
    next(e);
  }
}

concessionsCheckinRouter.use(requireAuth, requireCounterStaff);

const redeemSchema = z.object({ code: z.string().trim().min(1).max(200) });

concessionsCheckinRouter.post(
  "/concessions/redeem",
  validate(redeemSchema),
  async (req, res, next) => {
    try {
      const view = await service.redeemVoucher(req.body.code, {
        userId: req.auth!.userId,
        isAdmin: req.auth!.user.isAdmin,
      });
      res.json(view);
    } catch (e) {
      next(e);
    }
  },
);
