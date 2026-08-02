import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";

export type VnpayParams = Record<string, string>;

/**
 * How long the sandbox keeps a payment open. Shorter than the reconciliation threshold on purpose:
 * by the time the sweep asks `querydr` what happened, VNPay has already made up its mind.
 */
const VNPAY_EXPIRE_MS = 10 * 60 * 1000;

/**
 * Space becomes `+`, not `%20`.
 *
 * The written spec says "urlencode", which is ambiguous — PHP's `urlencode()` emits `+` while
 * `rawurlencode()` emits `%20`, and the two produce different signatures for the same parameters.
 * VNPay's own Node.js sample resolves it as `encodeURIComponent(v).replace(/%20/g, "+")`, and the
 * gateway validates against that. Changing this to `%20` makes every signature fail with no
 * diagnostic beyond a generic rejection.
 */
const encode = (value: string): string => encodeURIComponent(value).replace(/%20/g, "+");

export function signingQuery(params: VnpayParams): string {
  return Object.keys(params)
    .filter((key) => key !== "vnp_SecureHash" && key !== "vnp_SecureHashType" && params[key] !== "")
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join("&");
}

export function signVnpay(params: VnpayParams, secret = config.vnpayHashSecret): string {
  return createHmac("sha512", secret).update(signingQuery(params), "utf8").digest("hex");
}

export function hasValidVnpaySignature(params: VnpayParams): boolean {
  const received = params.vnp_SecureHash ?? "";
  if (!received || !config.vnpayHashSecret) return false;
  const expected = signVnpay(params);
  const a = Buffer.from(received.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function timestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((out, part) => {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/**
 * Asks VNPay what actually happened to a transaction whose IPN never arrived (UC-40 A5, UC-13 A4).
 *
 * `querydr` is a JSON POST rather than a redirect, and it signs a fixed field order — not the
 * sorted-query form the redirect and IPN use — so it cannot share `signingQuery`. Getting that
 * order wrong yields a signature VNPay rejects with no explanation.
 *
 * Returns null when the gateway is unreachable or answers something unparseable: the sweep must
 * leave the record `initiated` and try again later, never guess.
 */
export async function queryTransaction(input: {
  orderRef: string;
  createdAt: Date;
  ipAddress?: string;
}): Promise<{
  responseCode: string;
  transactionStatus: string;
  transactionNo: string | null;
  amount: number | null;
} | null> {
  if (!config.vnpayTmnCode || !config.vnpayHashSecret) return null;

  const requestId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const version = "2.1.0";
  const command = "querydr";
  const orderInfo = `Doi soat giao dich ${input.orderRef}`;
  const transactionDate = timestamp(input.createdAt);
  const createDate = timestamp(new Date());
  const ipAddr = input.ipAddress ?? "127.0.0.1";

  const raw = [
    requestId,
    version,
    command,
    config.vnpayTmnCode,
    input.orderRef,
    transactionDate,
    createDate,
    ipAddr,
    orderInfo,
  ].join("|");
  const secureHash = createHmac("sha512", config.vnpayHashSecret).update(raw, "utf8").digest("hex");

  try {
    const res = await fetch(config.vnpayQueryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vnp_RequestId: requestId,
        vnp_Version: version,
        vnp_Command: command,
        vnp_TmnCode: config.vnpayTmnCode,
        vnp_TxnRef: input.orderRef,
        vnp_OrderInfo: orderInfo,
        vnp_TransactionDate: transactionDate,
        vnp_CreateDate: createDate,
        vnp_IpAddr: ipAddr,
        vnp_SecureHash: secureHash,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as Record<string, unknown>;
    const responseCode = typeof body.vnp_ResponseCode === "string" ? body.vnp_ResponseCode : "";
    if (!responseCode) return null;

    const amountRaw = Number(body.vnp_Amount);
    return {
      responseCode,
      transactionStatus:
        typeof body.vnp_TransactionStatus === "string" ? body.vnp_TransactionStatus : "",
      transactionNo: typeof body.vnp_TransactionNo === "string" ? body.vnp_TransactionNo : null,
      amount: Number.isSafeInteger(amountRaw) ? amountRaw / 100 : null,
    };
  } catch {
    // Network failure, timeout, malformed JSON — all mean "still unknown", not "failed".
    return null;
  }
}

export function buildPaymentUrl(input: {
  orderRef: string;
  amount: number;
  ipAddress: string;
  orderInfo: string;
  now?: Date;
}): string {
  if (!config.vnpayTmnCode || !config.vnpayHashSecret) throw new Error("vnpay_not_configured");
  const createdAt = input.now ?? new Date();
  const params: VnpayParams = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: config.vnpayTmnCode,
    vnp_Amount: String(input.amount * 100),
    vnp_CreateDate: timestamp(createdAt),
    vnp_CurrCode: "VND",
    // Mandatory in 2.1.0. Without it the sandbox leaves the payment open indefinitely, which would
    // let a top-up sit `initiated` past the point where the reconciliation sweep gives up asking.
    vnp_ExpireDate: timestamp(new Date(createdAt.getTime() + VNPAY_EXPIRE_MS)),
    vnp_IpAddr: input.ipAddress,
    vnp_Locale: "vn",
    vnp_OrderInfo: input.orderInfo,
    vnp_OrderType: "other",
    vnp_ReturnUrl: config.vnpayReturnUrl,
    vnp_TxnRef: input.orderRef,
  };
  return `${config.vnpayPaymentUrl}?${signingQuery(params)}&vnp_SecureHash=${signVnpay(params)}`;
}
