import type { NextFunction, Request, Response } from 'express';
import { UPLOAD_CONCURRENCY, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS } from '../../config.js';
import { err } from '../../http.js';

/**
 * Per-organizer upload throttle plus a concurrency cap (FR-023a).
 *
 * Two different bounds for two different risks. The rate limit bounds *sustained* abuse. The
 * concurrency cap bounds the *instantaneous* memory spike — a 5 MB decode holds real memory in a
 * process bounded at ~450 MB (PERF-07) that is also serving the live seat map every buyer is holding
 * seats on. A rate limit alone does not stop ten uploads arriving in the same second.
 *
 * Layout saves are deliberately NOT throttled: they are bounded writes, and throttling them would
 * fight the save-and-iterate rhythm the editor is built around.
 *
 * In memory for the same reason feature 003's hold throttle is: one Node process behind Nginx
 * (ADR 0003).
 */

const buckets = new Map<number, { count: number; resetAt: number }>();
let inFlight = 0;

export function uploadRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.auth?.userId;
  if (!userId) {
    next();
    return;
  }

  const now = Date.now();
  const bucket = buckets.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + UPLOAD_RATE_WINDOW_MS });
  } else {
    bucket.count += 1;
    if (bucket.count > UPLOAD_RATE_LIMIT) {
      next(err.tooMany('upload_rate_limited', 'Bạn đang tải lên quá nhanh. Vui lòng thử lại sau giây lát.'));
      return;
    }
  }

  // Refused rather than queued: a queued request holds its 5 MB body in memory while it waits,
  // which is exactly the thing this cap exists to prevent.
  if (inFlight >= UPLOAD_CONCURRENCY) {
    next(err.tooMany('upload_rate_limited', 'Hệ thống đang xử lý ảnh khác. Vui lòng thử lại sau giây lát.'));
    return;
  }
  next();
}

/** Run the expensive decode/re-encode inside the concurrency cap. */
export async function withUploadSlot<T>(fn: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
  }
}

/** Test seam — the suite resets between cases, like feature 003's hold throttle. */
export function resetUploadThrottle(): void {
  buckets.clear();
  inFlight = 0;
}
