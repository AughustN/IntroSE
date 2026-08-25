import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { err } from '../http.js';

/** Validate req.body against a strict zod schema before use (FR-042). On success
 *  the parsed value replaces req.body; on failure → 400 validation_failed. */
export function validate<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(err.badRequest('validation_failed', 'Dữ liệu gửi lên không hợp lệ.'));
      return;
    }
    req.body = result.data;
    next();
  };
}
