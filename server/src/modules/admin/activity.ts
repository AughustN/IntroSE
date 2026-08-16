import type { NextFunction, Request, Response } from "express";
import { pool } from "../../db/pool.js";
import { verifyAccessToken } from "../auth/sessions.js";

/*
 * Who used the site today (0035_user_activity.sql).
 *
 * Mounted app-wide, ahead of every router, so a signed-in reader counts as present whatever they
 * came to do — the console's other figures all start at a purchase, which measures conversion and
 * calls it traffic.
 *
 * Three things keep this off the request's critical path:
 *
 *   1. **Signature only.** It verifies the JWT and reads the subject; it does not re-check the
 *      account the way `requireAuth` does. A logged-out or suspended user whose token has not
 *      expired yet is counted for a few more minutes, which is the right trade for not adding three
 *      database reads to every request in the app. Nothing is authorised from what it learns — the
 *      real guard still runs on the routes that need it.
 *   2. **Once per user per day.** An in-process set remembers who has already been written, so the
 *      hundredth request of somebody's afternoon costs a set lookup. The set is per-process and
 *      resets on deploy; the table's primary key is what actually makes the write idempotent, so a
 *      cold process re-inserting is a no-op rather than a duplicate.
 *   3. **Fire and forget.** The insert is not awaited and its failure is swallowed. Analytics must
 *      never be able to fail a request, or a full disk stops ticket sales.
 */

/** `${userId}:${day}` for everyone already recorded today. Cleared when the local day rolls over. */
const seen = new Set<string>();
let seenDay = "";

/** Today in Asia/Ho_Chi_Minh as `YYYY-MM-DD` — the same day boundary the SQL uses. */
function localDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Record that this user was present today, at most once per process per day. */
export function touchActivity(userId: number): void {
  const day = localDay();
  if (day !== seenDay) {
    seen.clear();
    seenDay = day;
  }
  const key = `${userId}:${day}`;
  if (seen.has(key)) return;
  seen.add(key);

  void pool
    .query(`INSERT INTO user_activity_days (user_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      userId,
      day,
    ])
    .catch(() => {
      // Let the next request try again rather than pretending the day is recorded.
      seen.delete(key);
    });
}

/** Express middleware wrapper. Never blocks, never fails, never authorises anything. */
export function recordActivity(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      touchActivity(verifyAccessToken(header.slice(7)).userId);
    } catch {
      // An expired or forged token is a visitor we cannot name. Not this middleware's problem.
    }
  }
  next();
}

/** Test seam: the in-process dedupe is global state, and a suite that truncates must clear it. */
export const activityTest = {
  reset(): void {
    seen.clear();
    seenDay = "";
  },
};
