import type { NextFunction, Request, Response } from 'express';
import { err, HttpError } from '../http.js';
import { findById, isApprovedOrganizer, toMe } from '../modules/auth/auth.repo.js';
import { familyHasLiveToken, verifyAccessToken } from '../modules/auth/sessions.js';

/**
 * Live per-request auth check (ADR 0001, Option A). The access token proves
 * identity only; authorization state is read live so logout/suspend/reuse bite
 * on the very next request:
 *   1. verify the JWT (identity + signature)
 *   2. the account still exists and is not suspended (FR-051/052)
 *   3. the session's family still has a live refresh token (logout/reuse kill it)
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw err.unauthorized('unauthenticated');

    let userId: number;
    let familyId: string;
    try {
      ({ userId, familyId } = verifyAccessToken(header.slice(7)));
    } catch {
      throw err.unauthorized('unauthenticated');
    }

    const user = await findById(userId);
    if (!user) throw err.unauthorized('unauthenticated');
    if (user.status === 'suspended') {
      throw err.forbidden('account_suspended', 'Tài khoản đã bị tạm khoá.');
    }
    if (!(await familyHasLiveToken(familyId))) throw err.unauthorized('invalid_session');

    req.auth = { userId, familyId, user: toMe(user, await isApprovedOrganizer(userId)) };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Identify the caller if they are signed in, and carry on if they are not.
 *
 * For routes that are public but say more to somebody with a session — the review listing being the
 * first: anyone may read the ratings, and a signed-in reader also learns whether they may write one
 * and which review is theirs. Written as a wrapper around `requireAuth` rather than a second copy
 * of the token check, so the two can never disagree about what a valid session is.
 *
 * Any authentication failure is swallowed deliberately: an expired token on a public page is a
 * visitor, not an error. A *suspended* account is the one case that still refuses, because letting
 * it read as an anonymous visitor would quietly restore access it is meant to have lost.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }
  await requireAuth(req, res, (error?: unknown) => {
    if (error instanceof HttpError && error.code === 'account_suspended') {
      next(error);
      return;
    }
    next();
  });
}
