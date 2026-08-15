/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { walletClient, WalletError, type WalletLimits } from "../../services/walletClient";
import { formatVnd } from "../../services/currency";

/** Presets from UC-40 step 2. Anything else goes in the custom field. */
const PRESETS = [100_000, 200_000, 500_000, 1_000_000];

/** Where the client parks the top-up id, so the page VNPay returns to knows what to poll. */
export const PENDING_TOPUP_KEY = "tixhub_pending_topup_v1";

interface TopUpSheetProps {
  balance: number;
  limits: WalletLimits;
  /**
   * The hold this top-up is being started from, when it came from a short balance at checkout.
   * Passing it is what buys the seats their one-time grace across the VNPay detour (UC-40 step 4).
   */
  reservationId?: number;
  /** Pre-fills the amount — the exact shortfall when arriving from UC-12 A2. */
  suggestedAmount?: number;
  onCancel?: () => void;
}

/**
 * Amount picker + hand-off to VNPay (UC-40 steps 1-4).
 *
 * Every limit is checked here *before* the hand-off, mirroring the server: rejecting after payment
 * would take money the wallet has nowhere to put. The server re-checks under a row lock — this copy
 * is for the buyer's benefit, not for safety.
 */
export default function TopUpSheet({
  balance,
  limits,
  reservationId,
  suggestedAmount,
  onCancel,
}: TopUpSheetProps) {
  const [amount, setAmount] = useState<number>(suggestedAmount ?? PRESETS[0]);
  const [custom, setCustom] = useState(suggestedAmount ? String(suggestedAmount) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const headroom = Math.max(limits.balanceCap - balance, 0);

  const problem =
    amount < limits.min
      ? `Nạp tối thiểu ${formatVnd(limits.min)}.`
      : amount > limits.max
        ? `Mỗi lần nạp tối đa ${formatVnd(limits.max)}.`
        : amount > headroom
          ? headroom > 0
            ? `Ví chỉ còn nhận thêm được ${formatVnd(headroom)}.`
            : `Số dư đã đạt mức tối đa ${formatVnd(limits.balanceCap)}.`
          : "";

  const pick = (value: number) => {
    setAmount(value);
    setCustom("");
    setError("");
  };

  const handleCustom = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    setCustom(digits);
    setAmount(Number(digits || 0));
    setError("");
  };

  const handleSubmit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError("");
    try {
      const topup = await walletClient.createTopup(amount, reservationId);
      if (!topup.paymentUrl)
        throw new WalletError("no_payment_url", "Chưa nhận được liên kết thanh toán.");
      // Parked before navigating away: the return page is display-only and cannot be trusted to
      // tell us which top-up it belongs to.
      try {
        sessionStorage.setItem(PENDING_TOPUP_KEY, String(topup.id));
      } catch {
        // Private mode with storage disabled — the return page falls back to the wallet screen.
      }
      window.location.href = topup.paymentUrl;
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof WalletError ? e.message : "Không tạo được giao dịch nạp. Vui lòng thử lại.",
      );
    }
  };

  return (
    <div className="space-y-5 border-2 border-beige-kem bg-xanh-pho p-6">
      <div>
        <h4 className="font-display text-title-m font-black text-beige-kem">Nạp tiền vào ví</h4>
        <p className="mt-1 font-meta text-eyebrow text-ink-soft">
          Số dư hiện tại {formatVnd(balance)} · tối đa {formatVnd(limits.balanceCap)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => pick(preset)}
            disabled={preset > headroom}
            className={`border-2 px-3 py-3 font-meta text-eyebrow font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${ amount === preset && !custom
                ? "border-beige-kem bg-cam-dat text-on-tint"
                : "border-beige-kem/60 text-beige-kem hover:border-beige-kem"
            }`}
          >
            {formatVnd(preset)}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="topup-custom" className="block font-meta text-eyebrow text-beige-kem/75">
          Hoặc nhập số tiền khác
        </label>
        <input
          id="topup-custom"
          inputMode="numeric"
          placeholder={`${limits.min.toLocaleString("vi-VN")} – ${limits.max.toLocaleString("vi-VN")}`}
          value={custom ? Number(custom).toLocaleString("vi-VN") : ""}
          onChange={(e) => handleCustom(e.target.value)}
          className="h-11 w-full border-2 border-beige-kem bg-surface-2 px-4 text-body text-beige-kem outline-none transition focus:border-burgundy"
        />
      </div>

      {(problem || error) && (
        <p className="border-2 border-beige-kem bg-bubblegum p-3 font-meta text-eyebrow leading-5 text-on-tint">
          {error || problem}
        </p>
      )}

      <div className="border-2 border-beige-kem bg-la-co p-3 text-meta leading-5 text-on-tint">
        Bạn sẽ được chuyển sang VNPay. Ví chỉ được cộng tiền khi VNPay xác nhận về máy chủ, nên số
        dư có thể cập nhật chậm vài giây sau khi quay lại.
        {reservationId !== undefined && " Chỗ bạn đang giữ được gia hạn một lần cho lần nạp này."}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={Boolean(problem) || busy}
          className="bg-burgundy px-6 py-3 text-body font-black text-white transition hover:brightness-95 disabled:bg-surface-2 disabled:text-white/60"
        >
          {busy ? "Đang chuyển..." : `Nạp ${formatVnd(amount || 0)}`}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="border-2 border-beige-kem px-6 py-3 text-body font-bold text-beige-kem transition hover:bg-surface-2"
          >
            Để sau
          </button>
        )}
      </div>
    </div>
  );
}
