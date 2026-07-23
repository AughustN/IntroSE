import type { NextFunction, Request, Response } from 'express';
import { err } from '../http.js';
import { isApprovedOrganizer } from '../modules/auth/auth.repo.js';

// These run after requireAuth. Every access rule is enforced server-side (FR-022).

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth?.user.isAdmin) {
    next(err.forbidden('forbidden'));
    return;
  }
  next();
}

/** Organizer capability is derived per request (FR-021) — a suspension bites immediately. */
export async function requireOrganizer(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth || !(await isApprovedOrganizer(req.auth.userId))) {
      throw err.forbidden('forbidden');
    }
    next();
  } catch (e) {
    next(e);
  }
}
