import { type NextFunction, type Request, type Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { AuthSuccess } from "@shared/auth/types.js";
import { REFRESH_COOKIE, REFRESH_TTL_MS, RESET_TTL_MS, config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { err } from "../../http.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireOrganizer } from "../../middleware/authz.js";
import { recentIdentifierFailures, recordAuthEvent } from "./auth.events.js";
import {
  createGoogleUser,
  createPasswordUser,
  findByEmail,
  findById,
  findByPhone,
  findByProviderSubject,
  isApprovedOrganizer,
  toMe,
  updateAvatarUrl,
  updatePasswordHash,
  updateProfile,
} from './auth.repo.js';
import { deleteAvatar, processAvatar, saveAvatar } from './avatar.js';
import { createApplication, createAppeal, getLatestAppeal, getLiveApplication, listApplications, listAppeals } from './organizer.js';
import { googleVerifier } from './oauth.google.js';
import { hashIdentifier, hashToken, randomToken } from './crypto.js';
import { classifyIdentifier, normalizeEmail, normalizePhone } from './identifier.js';
import { mailer } from './mailer.js';
import { dummyVerify, hashPassword, passwordStrengthError, verifyPassword } from './password.js';
import {
  SessionError,
  issueSession,
  revokeAllExceptFamily,
  revokeAllForUser,
  revokeFamily,
  rotateSession,
} from './sessions.js';
import { allow, applyIdentifierDelay, ipKey } from './throttle.js';
import { isDisposableEmail } from '../../middleware/emailFilter.js';
import { verifyTurnstile } from '../../services/turnstile.js';
import { checkSlidingLimit, normalizeIpKey } from '../../middleware/rateLimit.js';

// Mounted at /api → auth endpoints live under /api/auth/*, profile at /api/me.
export const authRouter = Router();

// ---- helpers ----

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TTL_MS,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/" });
}

const ctxOf = (req: Request) => ({
  userAgent: req.headers["user-agent"] ?? null,
  sourceIp: req.ip ?? null,
});

function mapUniqueViolation(e: unknown): unknown {
  const pgErr = e as { code?: string; constraint?: string };
  if (pgErr?.code === "23505") {
    if (pgErr.constraint === "uq_users_phone")
      return err.conflict("phone_taken", "Số điện thoại đã được sử dụng.");
    return err.conflict("email_taken", "Email đã được sử dụng.");
  }
  return e;
}

// ---- schemas ----

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
  passwordConfirm: z.string(),
  nickname: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).optional().nullable(),
  turnstileToken: z.string().optional(),
}); // unknown keys stripped → privilege fields ignored (FR-008/035)

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

const googleSchema = z.object({ credential: z.string().min(1) });

const forgotSchema = z.object({ email: z.string().trim().email() });

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string(),
  passwordConfirm: z.string(),
});

const updateMeSchema = z.object({
  nickname: z.string().trim().min(1).max(50).optional(),
  phone: z.string().trim().nullable().optional(),
}); // only these fields; anything else (incl. privilege fields) is stripped (FR-035/008)

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string(),
  newPasswordConfirm: z.string(),
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// ---- POST /api/auth/register (US1) ----

authRouter.post(
  "/auth/register",
  validate(registerSchema),
  asyncH(async (req, res) => {
    if (!allow(`reg:${ipKey(req.ip)}`, 30, 60_000))
      throw err.tooMany("rate_limited", "Bạn thao tác quá nhanh, thử lại sau.");
    const body = req.body as z.infer<typeof registerSchema>;

    if (isDisposableEmail(body.email)) {
      throw err.badRequest(
        'disposable_email_rejected',
        'Địa chỉ email tạm thời / rác không được chấp nhận. Vui lòng sử dụng email chính thức.',
      );
    }

    const ipNorm = normalizeIpKey(req.ip || '127.0.0.1');
    const ipCheck = checkSlidingLimit('register:ip', ipNorm, 6, 60 * 60 * 1000);
    if (!ipCheck.allowed && !body.turnstileToken) {
      res.status(403).json({
        error: 'captcha_required',
        message: 'Nhiều tài khoản vừa được tạo từ địa chỉ IP này. Vui lòng hoàn tất xác thực CAPTCHA.',
        requireCaptcha: true,
      });
      return;
    }

    if (body.turnstileToken) {
      const captchaRes = await verifyTurnstile(body.turnstileToken, req.ip);
      if (!captchaRes.success) {
        throw err.badRequest('captcha_failed', 'Xác thực CAPTCHA thất bại, vui lòng thử lại.');
      }
    }

    if (body.password !== body.passwordConfirm) throw err.badRequest('password_mismatch', 'Mật khẩu nhập lại không khớp.');
    const weak = passwordStrengthError(body.password);
    if (weak) throw err.badRequest("weak_password", weak);

    const email = normalizeEmail(body.email);
    let phone: string | null = null;
    if (body.phone) {
      phone = normalizePhone(body.phone);
      if (!phone) throw err.badRequest("validation_failed", "Số điện thoại không hợp lệ.");
    }

    // Friendly pre-check messages; the DB unique constraints are the real guarantee (SC-007).
    const existingEmail = await findByEmail(email);
    if (existingEmail) {
      throw existingEmail.provider === "google"
        ? err.conflict(
            "email_registered_with_google",
            "Email này đã đăng ký bằng Google. Hãy dùng nút đăng nhập Google.",
          )
        : err.conflict("email_taken", "Email đã được sử dụng. Bạn có thể đăng nhập.");
    }
    if (phone && (await findByPhone(phone))) {
      throw err.conflict("phone_taken", "Số điện thoại đã được sử dụng. Bạn có thể đăng nhập.");
    }

    const passwordHash = await hashPassword(body.password);
    try {
      const result = await withTransaction(async (client) => {
        const user = await createPasswordUser(client, {
          email,
          phone,
          nickname: body.nickname,
          passwordHash,
        });
        const session = await issueSession(client, user.id, ctxOf(req));
        await recordAuthEvent(
          {
            event: "login_success",
            userId: user.id,
            identifierHash: hashIdentifier(email),
            sourceIp: req.ip,
          },
          client,
        );
        return { user, session };
      });
      setRefreshCookie(res, result.session.refreshToken);
      const payload: AuthSuccess = {
        accessToken: result.session.accessToken,
        user: toMe(result.user, false),
      };
      res.status(201).json(payload);
    } catch (e) {
      throw mapUniqueViolation(e);
    }
  }),
);

// ---- POST /api/auth/login (US1) ----

authRouter.post(
  "/auth/login",
  validate(loginSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof loginSchema>;

    const ipNorm = normalizeIpKey(req.ip || '127.0.0.1');
    const ipCheck = checkSlidingLimit('login:ip', ipNorm, 15, 15 * 60 * 1000);
    if (!ipCheck.allowed) {
      throw err.tooMany('rate_limited', 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ 15 phút.');
    }

    const classified = classifyIdentifier(body.identifier);
    const idHash = classified.kind === 'unknown' ? hashIdentifier(body.identifier) : hashIdentifier(classified.value);
    // Scoped to this source: see `recentIdentifierFailures`. Counted globally, both defences below
    // become a way to lock any account whose email you know, from anywhere.
    const failCount = await recentIdentifierFailures(idHash, 15 * 60_000, ipNorm);
    const MAX_LOGIN_ATTEMPTS = 10;

    // Temporary lockout after 10 failed attempts in 15 minutes
    if (failCount >= MAX_LOGIN_ATTEMPTS) {
      throw err.tooMany(
        'account_locked_temporarily',
        'Tài khoản đã bị tạm khóa do nhập sai mật khẩu quá 10 lần. Vui lòng thử lại sau 15 phút hoặc sử dụng Quên mật khẩu.',
      );
    }

    // Adaptive Turnstile challenge on >= 3 consecutive failed logins
    if (failCount >= 3) {
      if (!body.turnstileToken) {
        res.status(403).json({
          error: 'captcha_required',
          message: 'Tài khoản đã đăng nhập sai nhiều lần. Vui lòng hoàn tất xác thực CAPTCHA để tiếp tục.',
          requireCaptcha: true,
        });
        return;
      }
      const captchaRes = await verifyTurnstile(body.turnstileToken, req.ip);
      if (!captchaRes.success) {
        throw err.badRequest('captcha_failed', 'Xác thực CAPTCHA thất bại, vui lòng thử lại.');
      }
    }

    const user =
      classified.kind === "email"
        ? await findByEmail(classified.value)
        : classified.kind === "phone"
          ? await findByPhone(classified.value)
          : null;

    // Google account (no password): only disclosed after the identifier is known to exist (FR-014).
    if (user && !user.password_hash) {
      throw err.conflict("account_uses_google", "Tài khoản này đăng nhập bằng Google.");
    }

    const ok = user?.password_hash
      ? await verifyPassword(body.password, user.password_hash)
      : await dummyVerify(body.password);
    if (!ok || !user) {
      // Progressive per-identifier delay (equal for unknown identifiers, FR-048/049).
      await applyIdentifierDelay(failCount);
      await recordAuthEvent({ event: 'login_failure', userId: user?.id ?? null, identifierHash: idHash, sourceIp: req.ip });

      const newFailCount = failCount + 1;
      const remainingAttempts = Math.max(0, MAX_LOGIN_ATTEMPTS - newFailCount);

      const message =
        remainingAttempts > 0
          ? `Mật khẩu không chính xác. Bạn còn ${remainingAttempts} lần thử trước khi tài khoản bị tạm khóa 15 phút.`
          : `Bạn đã nhập sai mật khẩu 10 lần. Tài khoản đã bị tạm khóa trong 15 phút để bảo vệ an toàn.`;

      throw err.unauthorized('invalid_credentials', message);
    }

    // Suspension is checked only AFTER the password is verified (FR-013).
    if (user.status === "suspended") {
      throw err.forbidden(
        "account_suspended",
        "Tài khoản đã bị tạm khoá. Liên hệ hỗ trợ để khiếu nại.",
      );
    }

    const session = await withTransaction(async (client) => {
      const s = await issueSession(client, user.id, ctxOf(req));
      await recordAuthEvent(
        { event: "login_success", userId: user.id, identifierHash: idHash, sourceIp: req.ip },
        client,
      );
      return s;
    });
    setRefreshCookie(res, session.refreshToken);
    const payload: AuthSuccess = {
      accessToken: session.accessToken,
      user: toMe(user, await isApprovedOrganizer(user.id)),
    };
    res.status(200).json(payload);
  }),
);

// ---- POST /api/auth/oauth/google (US3) ----

authRouter.post(
  "/auth/oauth/google",
  validate(googleSchema),
  asyncH(async (req, res) => {
    const { credential } = req.body as z.infer<typeof googleSchema>;

    let identity;
    try {
      identity = await googleVerifier.verify(credential);
    } catch {
      throw err.unauthorized("invalid_google_credential", "Xác thực Google thất bại.");
    }

    // Look up by the stable provider subject, never by email (FR-025).
    const existing = await findByProviderSubject("google", identity.sub);
    if (existing) {
      // Suspension is checked only after the provider confirms identity (FR-013).
      if (existing.status === "suspended") {
        throw err.forbidden(
          "account_suspended",
          "Tài khoản đã bị tạm khoá. Liên hệ hỗ trợ để khiếu nại.",
        );
      }
      const session = await withTransaction(async (client) => {
        const s = await issueSession(client, existing.id, ctxOf(req));
        await recordAuthEvent(
          {
            event: "login_success",
            userId: existing.id,
            identifierHash: hashIdentifier(identity.email),
            sourceIp: req.ip,
          },
          client,
        );
        return s;
      });
      setRefreshCookie(res, session.refreshToken);
      const payload: AuthSuccess = {
        accessToken: session.accessToken,
        user: toMe(existing, await isApprovedOrganizer(existing.id)),
      };
      res.status(200).json(payload);
      return;
    }

    // No Google account yet. A colliding email that belongs to a password account is refused,
    // never linked or merged (D5, FR-046).
    const byEmail = await findByEmail(identity.email);
    if (byEmail) {
      throw err.conflict(
        "email_registered_with_password",
        "Email này đã đăng ký bằng mật khẩu. Hãy đăng nhập bằng mật khẩu.",
      );
    }

    const avatarUrl = identity.picture?.startsWith("https://") ? identity.picture : null;
    const result = await withTransaction(async (client) => {
      const user = await createGoogleUser(client, {
        email: identity.email,
        subject: identity.sub,
        nickname: identity.name ?? null,
        avatarUrl,
      });
      const session = await issueSession(client, user.id, ctxOf(req));
      await recordAuthEvent(
        {
          event: "login_success",
          userId: user.id,
          identifierHash: hashIdentifier(identity.email),
          sourceIp: req.ip,
        },
        client,
      );
      return { user, session };
    });
    setRefreshCookie(res, result.session.refreshToken);
    const payload: AuthSuccess = {
      accessToken: result.session.accessToken,
      user: toMe(result.user, false),
    };
    res.status(201).json(payload);
  }),
);

// ---- POST /api/auth/refresh (US1/US2) ----

authRouter.post(
  "/auth/refresh",
  asyncH(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw err.unauthorized("invalid_session");
    try {
      const result = await rotateSession(raw, {
        idempotencyKey: (req.headers["x-idempotency-key"] as string) ?? null,
        ...ctxOf(req),
      });
      setRefreshCookie(res, result.refreshToken);
      const payload: AuthSuccess = { accessToken: result.accessToken, user: result.user };
      res.status(200).json(payload);
    } catch (e) {
      if (e instanceof SessionError) {
        clearRefreshCookie(res);
        throw err.unauthorized(e.code);
      }
      throw e;
    }
  }),
);

// ---- POST /api/auth/logout, /api/auth/logout-all (US2) ----

authRouter.post(
  "/auth/logout",
  requireAuth,
  asyncH(async (req, res) => {
    await revokeFamily(req.auth!.familyId, "logout");
    await recordAuthEvent({ event: "logout", userId: req.auth!.userId, sourceIp: req.ip });
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  "/auth/logout-all",
  requireAuth,
  asyncH(async (req, res) => {
    await revokeAllForUser(req.auth!.userId, "logout_all");
    await recordAuthEvent({ event: "logout_all", userId: req.auth!.userId, sourceIp: req.ip });
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

// ---- GET /api/me (US1) ----

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json(req.auth!.user);
});

// ---- PATCH /api/me (US5) — nickname / phone only ----

authRouter.patch(
  "/me",
  requireAuth,
  validate(updateMeSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof updateMeSchema>;
    const fields: { nickname?: string; phone?: string | null } = {};
    if (body.nickname !== undefined) fields.nickname = body.nickname;
    if (body.phone !== undefined) {
      if (!body.phone) fields.phone = null;
      else {
        const p = normalizePhone(body.phone);
        if (!p) throw err.badRequest("validation_failed", "Số điện thoại không hợp lệ.");
        const owner = await findByPhone(p);
        if (owner && owner.id !== req.auth!.userId)
          throw err.conflict("phone_taken", "Số điện thoại đã được sử dụng.");
        fields.phone = p;
      }
    }
    try {
      const updated = await updateProfile(req.auth!.userId, fields);
      res.json(toMe(updated, await isApprovedOrganizer(req.auth!.userId)));
    } catch (e) {
      throw mapUniqueViolation(e);
    }
  }),
);

// ---- POST /api/me/password (US5) — change password, revoke OTHER sessions (FR-057) ----

authRouter.post(
  "/me/password",
  requireAuth,
  validate(changePasswordSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof changePasswordSchema>;
    if (body.newPassword !== body.newPasswordConfirm)
      throw err.badRequest("password_mismatch", "Mật khẩu nhập lại không khớp.");
    const weak = passwordStrengthError(body.newPassword);
    if (weak) throw err.badRequest("weak_password", weak);

    const user = await findById(req.auth!.userId);
    if (!user?.password_hash)
      throw err.badRequest("validation_failed", "Tài khoản này không dùng mật khẩu.");
    if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
      throw err.forbidden("wrong_current_password", "Mật khẩu hiện tại không đúng.");
    }

    const newHash = await hashPassword(body.newPassword);
    await updatePasswordHash(req.auth!.userId, newHash);
    await revokeAllExceptFamily(req.auth!.userId, req.auth!.familyId, "password_changed"); // FR-057
    await recordAuthEvent({
      event: "password_changed",
      userId: req.auth!.userId,
      sourceIp: req.ip,
    });
    res.status(200).json({ ok: true, message: "Đổi mật khẩu thành công." });
  }),
);

// ---- POST /api/me/avatar (US5) — upload, re-encode, store on disk (ADR 0004) ----

authRouter.post(
  "/me/avatar",
  requireAuth,
  upload.single("file"),
  asyncH(async (req, res) => {
    if (!req.file) throw err.badRequest("invalid_image", "Chưa chọn ảnh.");
    let webp: Buffer;
    try {
      webp = await processAvatar(req.file.buffer);
    } catch {
      throw err.badRequest("invalid_image", "Ảnh không hợp lệ (chỉ chấp nhận JPEG/PNG/WebP).");
    }
    const previous = req.auth!.user.avatarUrl;
    const url = await saveAvatar(req.auth!.userId, webp);
    await updateAvatarUrl(req.auth!.userId, url);
    await deleteAvatar(previous);
    res.json({ ...req.auth!.user, avatarUrl: url });
  }),
);

// ---- POST /api/auth/password/forgot, /api/auth/password/reset (US4) ----

authRouter.post(
  "/auth/password/forgot",
  validate(forgotSchema),
  asyncH(async (req, res) => {
    const email = normalizeEmail((req.body as z.infer<typeof forgotSchema>).email);
    // Keyed on hash(identifier)+IP, never on account existence (R-13) — fires identically for real/fake.
    const perId = allow(`forgot:id:${hashIdentifier(email)}`, 3, 60 * 60_000);
    const perIp = allow(`forgot:ip:${ipKey(req.ip)}`, 10, 60 * 60_000);
    if (!perId || !perIp)
      throw err.tooMany("rate_limited", "Bạn đã yêu cầu quá nhiều lần, hãy thử lại sau.");

    const user = await findByEmail(email);
    // Google accounts get no link (FR-053, D5); suspended ones get none either — a reset must not
    // be a way back in (UC-05 A6). Both cases fall through to the same response as an unknown address.
    if (user && user.provider === "email" && user.status === "active") {
      const token = randomToken();
      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3::int * interval '1 millisecond'))`,
        [user.id, hashToken(token), RESET_TTL_MS],
      );
      await recordAuthEvent({
        event: "password_reset_requested",
        userId: user.id,
        identifierHash: hashIdentifier(email),
        sourceIp: req.ip,
      });
      try {
        await mailer.sendPasswordReset(email, `${config.appUrl}/reset-password?token=${token}`);
        console.info("[mailer] password reset accepted for delivery:", { userId: user.id });
      } catch (e) {
        // A mail-provider failure must never change the reply: a 500 here would only ever fire for
        // a registered address, turning the uniform response (FR-028) into an enumeration oracle.
        console.error("[mailer] password reset send failed:", e);
      }
    } else {
      // Never log the address or reset token. This is enough to distinguish a skipped request
      // from a provider failure while keeping credentials out of process logs.
      console.info("[mailer] password reset skipped:", {
        identifierHash: hashIdentifier(email),
        reason: user ? `${user.provider}_${user.status}` : "unknown_email",
      });
    }
    // Uniform response whether or not the address is registered (FR-028).
    res.status(200).json({
      ok: true,
      message: "Nếu email tồn tại, chúng tôi đã gửi liên kết đặt lại mật khẩu.",
    });
  }),
);

authRouter.post(
  "/auth/password/reset",
  validate(resetSchema),
  asyncH(async (req, res) => {
    const body = req.body as z.infer<typeof resetSchema>;
    if (body.password !== body.passwordConfirm)
      throw err.badRequest("password_mismatch", "Mật khẩu nhập lại không khớp.");
    const weak = passwordStrengthError(body.password);
    if (weak) throw err.badRequest("weak_password", weak);

    const tokenHash = hashToken(body.token);
    const newHash = await hashPassword(body.password);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, user_id FROM password_resets
          WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
        [tokenHash],
      );
      const reset = rows[0];
      if (!reset)
        throw err.badRequest(
          "invalid_or_expired_token",
          "Liên kết đặt lại không hợp lệ hoặc đã hết hạn.",
        );
      await client.query(`UPDATE password_resets SET consumed_at = now() WHERE id = $1`, [
        reset.id,
      ]);
      await updatePasswordHash(reset.user_id, newHash, client);
      await revokeAllForUser(reset.user_id, "password_reset", client); // FR-030
      await recordAuthEvent(
        { event: "password_reset_completed", userId: reset.user_id, sourceIp: req.ip },
        client,
      );
    });

    res.status(200).json({ ok: true, message: "Đặt lại mật khẩu thành công." });
  }),
);

// ---- Organizer application (US6) ----

const applySchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1),
  logoUrl: z.string().url().nullable().optional(),
});

authRouter.post(
  "/organizers/apply",
  requireAuth,
  upload.single("logo"),
  asyncH(async (req, res) => {
    const rawBody = req.body || {};
    const displayName = String(rawBody.displayName || "").trim();
    const description = String(rawBody.description || "").trim();
    const logoUrl = rawBody.logoUrl ? String(rawBody.logoUrl).trim() : null;

    if (!displayName || displayName.length < 1 || displayName.length > 100) {
      throw err.badRequest("validation_failed", "Tên hiển thị nhà tổ chức không hợp lệ.");
    }
    if (!description || description.length < 1) {
      throw err.badRequest("validation_failed", "Mô tả nhà tổ chức không hợp lệ.");
    }

    const live = await getLiveApplication(req.auth!.userId);
    if (live) {
      if (live.status === "pending")
        throw err.conflict("already_pending", "Đơn của bạn đang chờ duyệt.");
      if (live.status === "approved")
        throw err.conflict("already_approved", "Bạn đã là nhà tổ chức.");
      // suspended: re-applying must never shed a suspension (FR-059)
      throw err.conflict(
        "suspended_cannot_reapply",
        "Tài khoản nhà tổ chức đang bị đình chỉ, không thể nộp lại.",
      );
    }

    let finalLogoUrl = logoUrl;
    let appRow: { id: number } | undefined;
    try {
      appRow = await createApplication(req.auth!.userId, {
        displayName,
        description,
        logoUrl: finalLogoUrl,
      });

      if (req.file?.buffer) {
        const { sanitizeSquareImage } = await import("../media/sanitizer.js");
        const { uploadToCloudinary } = await import("../../services/cloudinary.js");
        const sanitized = await sanitizeSquareImage(req.file.buffer, 2 * 1024 * 1024);
        const cloudResult = await uploadToCloudinary(sanitized, {
          folder: `tixhub/organizers/${appRow.id}/logo`,
          publicId: String(appRow.id),
          resourceType: "image",
          overwrite: true,
          invalidate: true,
        });
        finalLogoUrl = cloudResult.secure_url;
        await pool.query(`UPDATE organizers SET logo_url = $1 WHERE id = $2`, [
          finalLogoUrl,
          appRow.id,
        ]);
      }
    } catch (e) {
      // concurrent apply → unique live-application index → treat as already pending
      if ((e as { code?: string }).code === "23505")
        throw err.conflict("already_pending", "Đơn của bạn đang chờ duyệt.");
      // The application row is committed but the logo failed: leaving it would strand a pending
      // application no retry can reach (the next attempt hits `already_pending`). Roll the row
      // back — guarded on status so it can never clobber an admin decision made in between — and
      // surface the real error, so nothing is committed unless everything succeeded.
      if (appRow) {
        await pool.query(`DELETE FROM organizers WHERE id = $1 AND status = 'pending'`, [
          appRow.id,
        ]);
      }
      throw e;
    }
    await recordAuthEvent({
      event: "organizer_applied",
      userId: req.auth!.userId,
      sourceIp: req.ip,
    });
    res.status(201).json({
      ok: true,
      message: "Đã gửi đơn đăng ký nhà tổ chức, đang chờ duyệt.",
      logoUrl: finalLogoUrl,
    });
  }),
);

const appealSchema = z.object({
  reason: z.string().trim().min(5, 'Vui lòng nhập lý do giải trình chi tiết (tối thiểu 5 ký tự).').max(2000),
});

authRouter.post(
  '/organizers/appeal',
  requireAuth,
  validate(appealSchema),
  asyncH(async (req, res) => {
    const { reason } = req.body as z.infer<typeof appealSchema>;
    const live = await getLiveApplication(req.auth!.userId);
    if (!live || live.status !== 'suspended') {
      throw err.conflict('not_suspended', 'Chỉ tài khoản ban tổ chức đang bị đình chỉ mới có thể gửi khiếu nại.');
    }

    const existingPending = await getLatestAppeal(live.id);
    if (existingPending && existingPending.status === 'pending') {
      throw err.conflict('appeal_already_pending', 'Đơn khiếu nại của bạn đang được Admin xem xét, vui lòng không gửi lại.');
    }

    const appeal = await createAppeal(live.id, req.auth!.userId, reason);
    res.status(201).json({
      ok: true,
      message: 'Đã gửi đơn khiếu nại thành công. Vui lòng chờ Admin xem xét.',
      appeal,
    });
  }),
);

// Applicant's own status + history (for the FE).
authRouter.get(
  "/organizers/me",
  requireAuth,
  asyncH(async (req, res) => {
    const applications = await listApplications(req.auth!.userId);
    const live = applications.find((a) => ['pending', 'approved', 'suspended'].includes(a.status));
    const appeals = live ? await listAppeals(live.id) : [];
    const latestAppeal = appeals[0] ?? null;
    res.json({
      isOrganizer: req.auth!.user.isOrganizer,
      applications,
      latestAppeal,
      appeals,
    });
  }),
);

// An organizer-only action: allowed only while an approved application exists (FR-038).
// A suspension bites here on the very next request (FR-021 / SC-008).
authRouter.get(
  "/organizers/dashboard",
  requireAuth,
  requireOrganizer,
  (req: Request, res: Response) => {
    res.json({ ok: true, userId: req.auth!.userId });
  },
);
