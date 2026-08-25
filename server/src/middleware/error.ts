import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import type { ApiError } from "@shared/auth/types.js";
import { LOCK_TIMEOUT } from "../db/pool.js";
import { HttpError } from "../http.js";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "not_found" } satisfies ApiError);
}

// Uniform error shape for every failing endpoint. Never leak internals or credentials.
export function errorHandler(
  errv: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (errv instanceof HttpError) {
    const body: ApiError = { error: errv.code };
    if (errv.userMessage) body.message = errv.userMessage;
    if (errv.details) body.details = errv.details;
    // Structured refusal payloads (which seats, which validation issues) ride alongside the uniform
    // shape rather than replacing it, so existing clients are unaffected.
    res.status(errv.status).json(errv.extra ? { ...body, ...errv.extra } : body);
    return;
  }
  if (errv instanceof MulterError) {
    const code = errv.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_image";
    res
      .status(400)
      .json({ error: code, message: "Ảnh vượt quá dung lượng cho phép hoặc không hợp lệ." } satisfies ApiError);
    return;
  }
  // A lock wait that ran out (see `DB_LOCK_TIMEOUT_MS`) is contention, not a fault: the row was
  // busy and this transaction was cut loose rather than left holding a pool connection. Paths that
  // can say something better translate it themselves — seat holds answer `seat_taken` (409). This
  // is the floor for the rest, so contention never surfaces as an opaque 500 the caller reads as a
  // bug. 503 + Retry-After because retrying is exactly the right move.
  if ((errv as { code?: string }).code === LOCK_TIMEOUT) {
    console.warn("lock timeout:", errv instanceof Error ? errv.message : errv);
    res.set("Retry-After", "1");
    res.status(503).json({
      error: "busy",
      message: "Hệ thống đang bận, vui lòng thử lại.",
    } satisfies ApiError);
    return;
  }
  console.error("unhandled error:", errv instanceof Error ? errv.message : errv);
  res.status(500).json({ error: "internal_error" } satisfies ApiError);
}
