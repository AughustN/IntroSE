import type { NextFunction, Request, Response } from 'express';
import { err } from '../http.js';
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
