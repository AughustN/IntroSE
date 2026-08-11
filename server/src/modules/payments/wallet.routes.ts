import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { config, TOPUP_MAX_AMOUNT, TOPUP_MIN_AMOUNT, WALLET_BALANCE_CAP } from "../../config.js";
import { err, HttpError } from "../../http.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validate } from "../../middleware/validate.js";
import { extendOnce } from "../holds/holds.service.js";
import {
  applyVnpayIpn,
  checkout,
  createTopup,
  getOrder,
  listOrders,
  getStatement,
  getTopup,
  getWallet,
} from "./wallet.service.js";
import { buildPaymentUrl, hasValidVnpaySignature, type VnpayParams } from "./vnpay.js";
import { queueTicketResend } from "../notifications/notifications.service.js";
import { cancelTicket } from "./tickets.service.js";

export const walletRouter = Router();

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// Bounds come from config so an admin can move them without a deploy (UC-36). The balance ceiling
// is not checked here — it depends on the current balance, so it lives in the service under the
// wallet's row lock.
const topupSchema = z.object({
  amount: z.number().int().min(TOPUP_MIN_AMOUNT).max(TOPUP_MAX_AMOUNT),
  /** The hold the buyer came from, when the top-up was started from a short balance at checkout. */
  reservationId: z.number().int().positive().optional(),
});
const checkoutSchema = z.object({ reservationId: z.number().int().positive() });

walletRouter.get(
  "/wallet",
  requireAuth,
  asyncH(async (req, res) => {
    const wallet = await getWallet(req.auth!.userId);
    // The limits ride along so the top-up screen can show and enforce them without a second call
    // or a hard-coded copy that drifts from the server's (UC-41 step 2).
    res.json({
      ...wallet,
      limits: { min: TOPUP_MIN_AMOUNT, max: TOPUP_MAX_AMOUNT, balanceCap: WALLET_BALANCE_CAP },
    });
  }),
);

walletRouter.post(
  "/tickets/:id/cancel",
  requireAuth,
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw err.notFound("ticket_not_found");
    await cancelTicket(req.auth!.userId, id);
    res.json({ ok: true });
  }),
);

walletRouter.post(
  "/orders/:id/resend",
  requireAuth,
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw err.notFound("order_not_found");
    const queued = await queueTicketResend(req.auth!.userId, id);
    if (!queued) {
      const owner = await getOrder(req.auth!.userId, id);
      if (!owner) throw err.notFound("order_not_found");
      throw err.tooMany(
        "resend_rate_limited",
        "Bạn chỉ có thể gửi lại tối đa 3 lần mỗi giờ cho đơn vé này.",
      );
    }
    res.status(202).json({ ok: true });
  }),
);

/** The wallet statement: balance, ledger newest first, and any top-up still in flight (UC-41). */
walletRouter.get(
  "/wallet/transactions",
  requireAuth,
  asyncH(async (req, res) => {
    const limit = Number(req.query.limit);
    const before = Number(req.query.before);
    res.json(
      await getStatement(req.auth!.userId, {
        limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
        before: Number.isInteger(before) && before > 0 ? before : undefined,
      }),
    );
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
    const { amount, reservationId } = req.body as z.infer<typeof topupSchema>;
    const topup = await createTopup(req.auth!.userId, amount, reservationId ?? null);

    // The one-time grace (UC-40 step 4, FR-010): a VNPay detour takes longer than the ordinary hold
    // window allows, so the hold that sent the buyer here gets one bounded extension. Only once, and
    // never past the 14-minute ceiling from the reservation's creation — otherwise a seat map could
    // be locked for free by opening top-ups nobody intends to pay.
    //
    // Failure here is not failure of the top-up. The money is what matters; the seat is recoverable
    // by picking again (A6). An already-spent grace is not an error either — extendOnce returns the
    // window unchanged.
    if (reservationId !== undefined) {
      try {
        await extendOnce(req.auth!.userId, reservationId);
      } catch (e) {
        console.warn(
          "top-up grace not granted for reservation",
          reservationId,
          e instanceof Error ? e.message : e,
        );
      }
    }

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

// GET /api/orders — the buyer's own tickets. Registered before `/orders/:id` so the bare path is
// never read as an order whose id happens to be missing.
walletRouter.get(
  "/orders",
  requireAuth,
  asyncH(async (req, res) => {
    res.json(await listOrders(req.auth!.userId));
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
  // VNPay's codes, in the order UC-13 step 4 checks them: 97 bad signature (already answered
  // above), 01 unknown reference, 04 amount mismatch, 02 already terminal, 00 accepted.
  //
  // A replay gets 02, not 00. It credits nothing either way — the row lock plus the
  // `status='initiated'` guard see to that — but 00 tells VNPay "this confirmation was new", which
  // for a retry of something already settled is simply not true.
  const response =
    result === "duplicate"
      ? { RspCode: "02", Message: "Order already confirmed" }
      : result === "amount_mismatch"
        ? { RspCode: "04", Message: "Invalid amount" }
        : result === "not_found"
          ? { RspCode: "01", Message: "Order not found" }
          : { RspCode: "00", Message: "Confirm Success" };
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
