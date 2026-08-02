import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";

export type VnpayParams = Record<string, string>;

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

export function buildPaymentUrl(input: {
  orderRef: string;
  amount: number;
  ipAddress: string;
  orderInfo: string;
  now?: Date;
}): string {
  if (!config.vnpayTmnCode || !config.vnpayHashSecret) throw new Error("vnpay_not_configured");
  const params: VnpayParams = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: config.vnpayTmnCode,
    vnp_Amount: String(input.amount * 100),
    vnp_CreateDate: timestamp(input.now),
    vnp_CurrCode: "VND",
    vnp_IpAddr: input.ipAddress,
    vnp_Locale: "vn",
    vnp_OrderInfo: input.orderInfo,
    vnp_OrderType: "other",
    vnp_ReturnUrl: config.vnpayReturnUrl,
    vnp_TxnRef: input.orderRef,
  };
  return `${config.vnpayPaymentUrl}?${signingQuery(params)}&vnp_SecureHash=${signVnpay(params)}`;
}
