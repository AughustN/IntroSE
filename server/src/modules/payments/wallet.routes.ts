import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { err, HttpError } from "../../http.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import {
  applyVnpayIpn,
  checkout,
  createTopup,
  getOrder,
  getTopup,
  getWallet,
} from "./wallet.service.js";
import { buildPaymentUrl, hasValidVnpaySignature, type VnpayParams } from "./vnpay.js";

export const walletRouter = Router();

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const topupSchema = z.object({ amount: z.number().int().min(10_000).max(100_000_000) });
const checkoutSchema = z.object({ reservationId: z.number().int().positive() });

walletRouter.get(
  "/wallet",
  requireAuth,
  asyncH(async (req, res) => {
    res.json(await getWallet(req.auth!.userId));
  }),
);

walletRouter.post(
  "/wallet/topups",
  requireAuth,
  validate(topupSchema),
  asyncH(async (req, res) => {
    if (!config.vnpayTmnCode || !config.vnpayHashSecret) {
      throw new HttpError(503, "payment_not_configured", "Thanh toán VNPay chưa được cấu hình.");
    }
    const { amount } = req.body as z.infer<typeof topupSchema>;
    const topup = await createTopup(req.auth!.userId, amount);
    try {
      topup.paymentUrl = buildPaymentUrl({
        orderRef: topup.orderRef,
        amount: topup.amount,
        ipAddress: req.ip ?? "127.0.0.1",
        orderInfo: `Nap vi TixHub ${topup.orderRef}`,
      });
    } catch (e) {
      // Keep a pending row out of the user view if URL construction failed before redirect.
      throw new HttpError(
        503,
        "payment_not_configured",
        e instanceof Error ? e.message : undefined,
      );
    }
    res.status(201).json(topup);
  }),
);

walletRouter.get(
  "/wallet/topups/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw err.notFound("topup_not_found");
    res.json(await getTopup(req.auth!.userId, id));
  }),
);

walletRouter.post(
  "/checkout",
  requireAuth,
  validate(checkoutSchema),
  asyncH(async (req, res) => {
    const { reservationId } = req.body as z.infer<typeof checkoutSchema>;
    res.status(201).json(await checkout(req.auth!.userId, reservationId));
  }),
);

walletRouter.get(
  "/orders/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw err.notFound("order_not_found");
    res.json(await getOrder(req.auth!.userId, id));
  }),
);

function stringParams(source: Record<string, unknown>): VnpayParams {
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function ipnPayload(req: Request): VnpayParams {
  return stringParams(req.method === "POST" ? req.body : req.query);
}

async function handleIpn(req: Request, res: Response): Promise<void> {
  const params = ipnPayload(req);
  if (!hasValidVnpaySignature(params)) {
    res.json({ RspCode: "97", Message: "Invalid signature" });
    return;
  }
  const amountRaw = Number(params.vnp_Amount);
  const amount = Number.isSafeInteger(amountRaw) ? amountRaw / 100 : NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    res.json({ RspCode: "04", Message: "Invalid amount" });
    return;
  }

  const result = await applyVnpayIpn({
    orderRef: params.vnp_TxnRef ?? "",
    amount,
    responseCode: params.vnp_ResponseCode ?? "",
    transactionStatus: params.vnp_TransactionStatus ?? "",
    transactionNo: params.vnp_TransactionNo ?? null,
  });
  const response =
    result === "paid" || result === "duplicate" || result === "failed"
      ? { RspCode: "00", Message: "Confirm Success" }
      : result === "amount_mismatch"
        ? { RspCode: "04", Message: "Invalid amount" }
        : { RspCode: "01", Message: "Order not found" };
  res.json(response);
}

// VNPay IPN is server-to-server and intentionally unauthenticated; the signature is the auth.
walletRouter.get("/payments/vnpay/ipn", asyncH(handleIpn));
walletRouter.post("/payments/vnpay/ipn", asyncH(handleIpn));

// The browser return URL is display-only. It never credits the wallet.
walletRouter.get("/payments/vnpay/return", (req, res) => {
  const params = stringParams(req.query);
  const valid = hasValidVnpaySignature(params);
  res.json({
    ok: valid && params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00",
    orderRef: params.vnp_TxnRef ?? null,
    responseCode: params.vnp_ResponseCode ?? null,
  });
});
