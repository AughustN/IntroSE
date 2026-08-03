import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import type { ApiError } from "@shared/auth/types.js";
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
    res.status(errv.status).json(body);
    return;
  }
  if (errv instanceof MulterError) {
    const code = errv.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_image";
    res
      .status(400)
      .json({ error: code, message: "Ảnh vượt quá 2MB hoặc không hợp lệ." } satisfies ApiError);
    return;
  }
  console.error("unhandled error:", errv instanceof Error ? errv.message : errv);
  res.status(500).json({ error: "internal_error" } satisfies ApiError);
}
