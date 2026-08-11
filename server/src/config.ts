import "dotenv/config";

/** Fail-fast env loading + validation (task T004).
 *  REQUIRED: DATABASE_URL, JWT_SECRET, AUTH_EVENT_HASH_KEY.
 *  REQUIRED under vitest: TEST_DATABASE_URL.
 *  Optional / gated: GOOGLE_CLIENT_ID (US3), RESEND_API_KEY (empty → ConsoleMailer). */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "" || v.includes("REPLACE_WITH")) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

// node-pg does not understand libpq's channel_binding param in the URL — strip it.
function normalizeDbUrl(url: string): string {
  return url.replace(/([?&])channel_binding=[^&]*/i, "").replace(/[?&]$/, "");
}

const openaiBaseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const defaultOpenaiChatUrl = openaiBaseUrl.endsWith("/chat/completions")
  ? openaiBaseUrl
  : `${openaiBaseUrl}/chat/completions`;

/*
 * Two variables can name the same endpoint, and `OPENAI_CHAT_URL` wins.
 *
 * That is a deliberate escape hatch for a gateway whose path is not `/chat/completions`, but it is
 * also a way to spend an afternoon editing `OPENAI_BASE_URL` and watching nothing change. It is not
 * in `.env.example`, so anyone who has it has it by choice or by inheritance — say so once at
 * startup rather than letting the override be invisible.
 */
if (process.env.OPENAI_CHAT_URL?.trim() && process.env.OPENAI_BASE_URL?.trim()) {
  console.warn(
    `[config] OPENAI_CHAT_URL is set and overrides OPENAI_BASE_URL. Editing OPENAI_BASE_URL will have no effect. Unset one of them.`,
  );
}

/**
 * The project runs against three Neon branches, one per job:
 *
 *   DATABASE_URL       the app. `dev:server`, `db:migrate` and `seed` all talk to this one.
 *   TEST_DATABASE_URL  vitest, and nothing else. The suite truncates every table between cases.
 *   DEMO_DATABASE_URL  the demo branch. Its data was uploaded by hand and nothing regenerates it,
 *                      so no destructive job may point at it — see server/src/db/guards.ts.
 *
 * The test URL is resolved here rather than in the suite because `pool.ts` builds one pool at
 * import time from `config.databaseUrl`. Deliberately no fallback to DATABASE_URL: a suite that
 * silently truncates whatever database happens to be configured is the exact accident this
 * split exists to prevent, so a missing TEST_DATABASE_URL fails the run instead.
 */
const isTest = Boolean(process.env.VITEST);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  isTest,
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  corsOrigins: (process.env.CORS_ORIGINS ?? "https://tixhub.fit,http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  databaseUrl: normalizeDbUrl(required(isTest ? "TEST_DATABASE_URL" : "DATABASE_URL")),
  /** Empty until the demo branch URL is filled in. Only ever compared against, never connected to. */
  demoDatabaseUrl: normalizeDbUrl(process.env.DEMO_DATABASE_URL ?? ""),
  jwtSecret: required("JWT_SECRET"),
  authEventHashKey: required("AUTH_EVENT_HASH_KEY"),

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "", // gated (US3)
  resendApiKey: process.env.RESEND_API_KEY ?? "", // empty → ConsoleMailer
  mailFrom: process.env.MAIL_FROM ?? "TixHub <no-reply@tixhub.fit>",

  // AI is optional: the request path falls back to database-ranked events when no provider is set.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiChatUrl: process.env.OPENAI_CHAT_URL?.trim() || defaultOpenaiChatUrl,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",

  // VNPay is optional at boot so local catalog/hold development does not require gateway secrets.
  vnpayTmnCode: process.env.VNPAY_TMN_CODE ?? "",
  vnpayHashSecret: process.env.VNPAY_HASH_SECRET ?? "",
  vnpayPaymentUrl:
    process.env.VNPAY_PAYMENT_URL ?? "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  /** `querydr` endpoint — the reconciliation sweep's only way to settle a top-up whose IPN was lost. */
  vnpayQueryUrl:
    process.env.VNPAY_QUERY_URL ?? "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
  /**
   * Where VNPay sends the browser back. A frontend page, not the API: the buyer must land on
   * something that explains itself, and the return URL is display-only anyway — the balance moves
   * on the signed IPN, so this page polls the top-up's status rather than reading the redirect
   * (UC-13 A6, SEC-06). `GET /api/payments/vnpay/return` still exists for verifying the signature.
   */
  vnpayReturnUrl:
    process.env.VNPAY_RETURN_URL ??
    `${process.env.APP_URL ?? "http://localhost:3000"}/vnpay-return`,
} as const;

// ---- Auth constants (decisions from research/ADRs) ----
export const BCRYPT_COST = 12; // SEC-02
export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 min (Q7)
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day sliding (R-3)
export const REFRESH_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day cap (R-12 #6)
export const RESET_TTL_MS = 30 * 60 * 1000; // 30 min (R-3)
export const REFRESH_GRACE_MS = 60 * 1000; // idempotency-keyed grace cap (R-12)
export const REFRESH_COOKIE = "tix_refresh";
export const JWT_ISS = "tixhub.fit";
export const JWT_AUD = "tixhub.fit";

// ---- Seat holds (feature 003). Settings an admin can adjust (UC-36), never hard-coded. ----
const ms = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Seeded defaults for the `system_settings` table (feature 007). SettingService is the runtime
 * source of truth for anything an admin can adjust; these are the values it falls back to.
 */
export const DEFAULT_SYSTEM_SETTINGS = {
  seat_hold_ttl_minutes: 7,
  topup_grace_minutes: 7,
  absolute_ceiling_minutes: 14,
  max_tickets_per_buyer: 8,
  wallet_topup_min: 5_000,
  wallet_topup_max: 10_000_000,
  wallet_balance_ceiling: 20_000_000,
  ai_features_enabled: true,
  // The automatic quota guard beneath the manual switch above (UC-10 A3, UC-22 A3, SCAL-03). Model-
  // backed requests permitted per window across all attendees; at the ceiling every AI operation
  // serves cache or a non-AI fallback and makes no external call. Zero is a valid emergency value.
  ai_platform_request_ceiling: 2_000,
  ai_platform_window_hours: 24,
} as const;

export const AI_REQUEST_LIMIT = 10;
export const AI_CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * How long a model call may run before it is abandoned for the non-AI fallback.
 *
 * UC-10 and UC-22 alternative flow A4 say roughly eight seconds, and eight is what this was. The
 * number was written when the AI row of the technology table still said Gemini; the gateway the
 * team actually configured serves reasoning models, and measured against the real prompt every one
 * of them is slower than that budget:
 *
 *   alic/deepseek-v4-flash (configured)  18.8 s, 19.8 s   (~1100 reasoning tokens)
 *   deepseek-v4-flash                    23.1 s
 *   MiniMax-M2.7                         14.5 s
 *   Minimax-M3                           3.3 s – 8.7 s    (fastest, but swings ~2.5x)
 *
 * At eight seconds every real question timed out and the assistant answered from the non-AI
 * fallback every time — working exactly as designed, and useless. Twenty-five clears the configured
 * model with headroom for its variance. Switching the model to `Minimax-M3` would allow ten.
 *
 * This is a deliberate, recorded deviation from PERF-05: see the Complexity Tracking table in
 * specs/008-ai-chatbot/plan.md. The guarantee PERF-05 actually protects is that AI never blocks a
 * purchase, and that still holds — the call is off the critical path, the page stays interactive,
 * and the wait is legible because the panel shows a typing indicator throughout.
 */
export const AI_REQUEST_TIMEOUT_MS = ms("AI_REQUEST_TIMEOUT_MS", 25_000);

// The env-derived constants below remain for process-only consumers (the sweep, throttles, startup
// checks) that run outside a request and so have no SettingService cache to read. Request paths —
// holds, top-ups — must read SettingService, not these.

/** Hold window from the reservation's first hold (Vision REL-02, FR-006). */
export const HOLD_TTL_MS = ms("HOLD_TTL_MS", DEFAULT_SYSTEM_SETTINGS.seat_hold_ttl_minutes * 60 * 1000);
/** One-time grace granted when a wallet top-up carries the reservation (FR-010, schema D2 amendment). */
export const HOLD_GRACE_MS = ms("HOLD_GRACE_MS", DEFAULT_SYSTEM_SETTINGS.topup_grace_minutes * 60 * 1000);
/** Absolute ceiling measured from `reservations.created_at` — the window can never exceed it. */
export const HOLD_ABSOLUTE_MS = ms("HOLD_ABSOLUTE_MS", DEFAULT_SYSTEM_SETTINGS.absolute_ceiling_minutes * 60 * 1000);
/** Tickets one attendee may hold at once for one showtime: seats (seated) or quantity (GA) (FR-016). */
export const SEAT_CAP = ms("SEAT_CAP", DEFAULT_SYSTEM_SETTINGS.max_tickets_per_buyer);
/** How often the release sweep runs. Expiry is exact; the sweep is what acts on it (REL-02). */
export const HOLD_SWEEP_INTERVAL_MS = ms("HOLD_SWEEP_INTERVAL_MS", 60 * 1000);
/** Hold/release requests allowed per user per window — anti hold-spam (FR-017). */
export const HOLD_RATE_LIMIT = ms("HOLD_RATE_LIMIT", 30);
export const HOLD_RATE_WINDOW_MS = ms("HOLD_RATE_WINDOW_MS", 10 * 1000);

// ---- Wallet & top-ups (feature 004, UC-40). Admin-adjustable (UC-36). VND đồng, integers [STD-03].
/** Smallest top-up VNPay is worth a round trip for. */
export const TOPUP_MIN_AMOUNT = ms("TOPUP_MIN_AMOUNT", 5_000);
/** Per-transaction ceiling. */
export const TOPUP_MAX_AMOUNT = ms("TOPUP_MAX_AMOUNT", 10_000_000);
/**
 * Most store credit one wallet may hold. Checked at top-up time only, never on credit: applying it
 * to a refund would strand a refund the buyer is owed, and the ceiling exists to bound how much
 * money the platform holds on someone's behalf, not to reject money coming back (UC-40 A2, DATA-04).
 */
export const WALLET_BALANCE_CAP = ms("WALLET_BALANCE_CAP", 20_000_000);
/**
 * How stale an `initiated` top-up must be before the reconciliation sweep asks VNPay what happened
 * (UC-40 A5). Long enough that a buyer still on the sandbox page is not queried mid-payment.
 */
export const TOPUP_RECONCILE_AFTER_MS = ms("TOPUP_RECONCILE_AFTER_MS", 15 * 60 * 1000);
/** How often that sweep runs. */
export const TOPUP_SWEEP_INTERVAL_MS = ms("TOPUP_SWEEP_INTERVAL_MS", 5 * 60 * 1000);

// ---- Seat map designer (feature 005). Settings with defaults, not hard-coded constants (UC-36).
/** Layout coordinate space: 0–LAYOUT_SPACE integer units on each axis (FR-008). */
export const LAYOUT_SPACE = ms("LAYOUT_SPACE", 10_000);
/** Nominal seat size. Two seats overlap when their centres are closer than this (FR-008, FR-030a). */
export const SEAT_DIAMETER = ms("SEAT_DIAMETER", 100);
/** Ceilings — chosen to keep the editor and the buyer map inside PLAT-01 and PERF-02 (FR-007, FR-019). */
export const LAYOUT_MAX_SEATS = ms("LAYOUT_MAX_SEATS", 2_000);
export const LAYOUT_MAX_ELEMENTS = ms("LAYOUT_MAX_ELEMENTS", 200);
export const VENUE_MAX_LAYOUTS = ms("VENUE_MAX_LAYOUTS", 20);
/** Floor-plan upload bounds. Dimensions are checked before re-encoding, so a decompression bomb is
 *  refused rather than allocated (FR-023). */
export const FLOORPLAN_MAX_BYTES = ms("FLOORPLAN_MAX_BYTES", 5 * 1024 * 1024);
export const FLOORPLAN_MAX_PX = ms("FLOORPLAN_MAX_PX", 4_000);
/** Upload abuse bound: a rate limit for sustained abuse, a concurrency cap for the instantaneous
 *  memory spike a 5 MB decode causes in a process bounded at ~450 MB (FR-023a, PERF-07). */
export const UPLOAD_RATE_LIMIT = ms("UPLOAD_RATE_LIMIT", 10);
export const UPLOAD_RATE_WINDOW_MS = ms("UPLOAD_RATE_WINDOW_MS", 60 * 1000);
export const UPLOAD_CONCURRENCY = ms("UPLOAD_CONCURRENCY", 2);
