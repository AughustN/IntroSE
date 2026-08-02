import { TOPUP_RECONCILE_AFTER_MS, TOPUP_SWEEP_INTERVAL_MS } from "../../config.js";
import { pool } from "../../db/pool.js";
import { applyVnpayIpn } from "./wallet.service.js";
import { queryTransaction } from "./vnpay.js";

/**
 * The top-up reconciliation sweep (UC-40 A5, UC-13 A4).
 *
 * An IPN can be lost — the backend was down, the tunnel was closed, VNPay gave up retrying. Without
 * this the top-up sits `initiated` forever and the buyer's money looks lost, which is the one thing
 * a wallet must never do. So anything still `initiated` after TOPUP_RECONCILE_AFTER_MS is settled by
 * asking VNPay directly what happened.
 *
 * Settlement goes through `applyVnpayIpn`, the same function the callback uses, rather than writing
 * the balance here. That is deliberate: it means the credit path is reached one way only, keeps the
 * duplicate guard (`status='initiated'` under a row lock) covering both callers, and makes a late
 * IPN arriving mid-sweep harmless — the second one to land sees a terminal row and credits nothing.
 *
 * Nothing here touches a seat. A top-up holds no inventory, so a late settlement has no deadline to
 * miss [DATA-03].
 */
export async function reconcilePendingTopups(): Promise<number> {
  const { rows } = await pool.query<{
    provider_txn_ref: string;
    amount: number;
    created_at: Date;
  }>(
    `SELECT provider_txn_ref, amount_cents AS amount, created_at
       FROM payment_transactions
      WHERE payment_kind = 'topup' AND status = 'initiated'
        AND provider_txn_ref IS NOT NULL
        AND created_at < now() - ($1::bigint * INTERVAL '1 millisecond')
      ORDER BY created_at
      LIMIT 50`,
    [TOPUP_RECONCILE_AFTER_MS],
  );

  let settled = 0;
  for (const row of rows) {
    try {
      const result = await queryTransaction({
        orderRef: row.provider_txn_ref,
        createdAt: row.created_at,
      });
      // Gateway unreachable or still processing — leave it pending and ask again next sweep.
      if (!result) continue;

      // VNPay reports the amount in the same ×100 form as the IPN. Trusting our own stored amount
      // instead would defeat the mismatch check inside applyVnpayIpn, so pass through what the
      // gateway said and let that check run.
      const outcome = await applyVnpayIpn({
        orderRef: row.provider_txn_ref,
        amount: result.amount ?? row.amount,
        responseCode: result.responseCode,
        transactionStatus: result.transactionStatus,
        transactionNo: result.transactionNo,
      });
      if (outcome === "paid" || outcome === "failed") settled += 1;
    } catch (e) {
      // One unsettleable top-up must not stop the rest — the others are someone's money too.
      console.error(
        "topup reconciliation failed for",
        row.provider_txn_ref,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return settled;
}

let timer: NodeJS.Timeout | null = null;

export function startTopupReconciliation(intervalMs = TOPUP_SWEEP_INTERVAL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    void reconcilePendingTopups();
  }, intervalMs);
  // Never keep the process alive just to reconcile.
  timer.unref?.();
}

export function stopTopupReconciliation(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
