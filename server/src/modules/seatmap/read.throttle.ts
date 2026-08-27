import type { Request, Response, NextFunction } from "express";
import { createSlidingRateLimiter } from "../../middleware/rateLimit.js";
import { err } from "../../http.js";

// This read is authenticated and ownership-checked. Polling one map uses 2 reads/minute;
// a per-account ceiling bounds abuse without spending the public catalog's shared IP budget.
const limit = createSlidingRateLimiter("organizer-seat-map:account", {
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => String(req.auth!.userId),
  errorMessage: "Bạn tải sơ đồ quá nhanh. Vui lòng thử lại sau giây lát.",
  headers: true,
});

export function ownerMapRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.userId) {
    next(err.unauthorized("unauthenticated", "Vui lòng đăng nhập để xem sơ đồ."));
    return;
  }
  limit(req, res, next);
}
