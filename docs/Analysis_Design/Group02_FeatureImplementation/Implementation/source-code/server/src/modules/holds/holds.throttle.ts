import type { NextFunction, Request, Response } from 'express';
import { HOLD_RATE_LIMIT, HOLD_RATE_WINDOW_MS } from '../../config.js';
import { err } from '../../http.js';

/**
 * Per-user hold/release throttle (FR-017). Sized so a normal selection pace — clicking through a
 * seat map, changing your mind a few times — never trips it, while a script hammering the map does.
 *
 * In memory on purpose: one Node process behind Nginx (ADR 0003), and the real anti-hoarding control
 * is the per-reservation cap (FR-016), which is enforced in the database. This only blunts spam.
 */
const buckets = new Map<number, { count: number; resetAt: number }>();

export function holdRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.auth?.userId;
  if (!userId) {
    next();
    return;
  }

  const now = Date.now();
  const bucket = buckets.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + HOLD_RATE_WINDOW_MS });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > HOLD_RATE_LIMIT) {
    next(err.tooMany('rate_limited', 'Bạn thao tác quá nhanh, vui lòng thử lại sau giây lát.'));
    return;
  }
  next();
}

/** Test seam — the throttle is process-wide state, so cases must not leak into each other. */
export function resetHoldRateLimit(): void {
  buckets.clear();
}
