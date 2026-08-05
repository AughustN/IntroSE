import type { AuthErrorCode } from "@shared/auth/types.js";

/** A failure with a stable machine code + Vietnamese user message, mapped to a
 *  uniform JSON error shape by the error middleware (Principle VI). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: AuthErrorCode | string,
    public userMessage?: string,
    /** Numbers the client acts on — see `ApiError.details`. Optional; most refusals carry none. */
    public details?: Record<string, number | string>,
    /**
     * Structured payload merged into the response body. For refusals that must name *which* things
     * were refused and why — the per-seat `refusals` of a rejected map edit (005 FR-029) and the
     * `issues` of an invalid layout (FR-031) — where a flat string/number map is not enough.
     */
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

type Details = Record<string, number | string>;

export const err = {
  badRequest: (code: AuthErrorCode | string, msg?: string) => new HttpError(400, code, msg),
  notFound: (code: AuthErrorCode | string, msg?: string) => new HttpError(404, code, msg),
  unauthorized: (code: AuthErrorCode | string, msg?: string) => new HttpError(401, code, msg),
  forbidden: (code: AuthErrorCode | string, msg?: string) => new HttpError(403, code, msg),
  conflict: (code: AuthErrorCode | string, msg?: string) => new HttpError(409, code, msg),
  unprocessable: (code: AuthErrorCode | string, msg?: string, details?: Details) =>
    new HttpError(422, code, msg, details),
  /** A refusal that must name what it refused — see `HttpError.extra`. */
  refused: (status: number, code: string, msg: string, extra: Record<string, unknown>) =>
    new HttpError(status, code, msg, undefined, extra),
  tooMany: (code: AuthErrorCode | string, msg?: string) => new HttpError(429, code, msg),
};
