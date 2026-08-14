/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { walletClient, type Topup } from "../../services/walletClient";
import { PENDING_TOPUP_KEY } from "./TopUpSheet";
import { formatVnd } from "../../services/currency";

/** How long to keep asking before saying "still pending" — the IPN usually lands in seconds. */
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1500;

/**
 * The page VNPay redirects the browser back to (UC-13 A6).
 *
 * The redirect's own query string is **not** trusted for anything: it is display-only, and the
 * balance only ever moves on the signed server-to-server IPN [SEC-06]. So this screen polls the
 * top-up's real status instead. That also means "pending" is a normal outcome, not a failure —
 * the IPN may simply not have landed yet, and the reconciliation sweep settles it either way.
 */
export default function VnpayReturn({ onDone }: { onDone: (topup: Topup | null) => void }) {
  const [topup, setTopup] = useState<Topup | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const id = Number(sessionStorage.getItem(PENDING_TOPUP_KEY) ?? 0);
    if (!Number.isInteger(id) || id <= 0) {
      setSettled(true);
      return;
    }

    const poll = async () => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS && !cancelled; attempt++) {
        try {
          const current = await walletClient.getTopup(id);
          if (cancelled) return;
          setTopup(current);
          if (current.status !== "pending") {
            sessionStorage.removeItem(PENDING_TOPUP_KEY);
            setSettled(true);
            return;
          }
        } catch {
          // Keep polling: a transient failure here is not an answer about the money.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!cancelled) setSettled(true);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, []);

  const heading =
    topup?.status === "paid"
      ? "Nạp tiền thành công"
      : topup?.status === "failed"
        ? "Giao dịch không thành công"
        : settled
          ? "Đang chờ VNPay xác nhận"
          : "Đang kiểm tra giao dịch...";

  const body =
    topup?.status === "paid"
      ? `Đã cộng ${formatVnd(topup.amount)} vào ví.`
      : topup?.status === "failed"
        ? "Không có khoản tiền nào bị trừ. Bạn có thể thử nạp lại."
        : "VNPay chưa báo về máy chủ. Tiền chưa vào ví và cũng chưa mất — hệ thống sẽ tự đối soát lại. Bạn có thể xem trạng thái ở trang Ví.";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-xanh-pho/95 px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border-2 border-beige-kem bg-xanh-pho p-8">
        <h2 className="font-display text-title-m font-black text-beige-kem">{heading}</h2>
        <p className="font-meta text-eyebrow leading-6 text-ink-soft">{body}</p>

        {topup?.status === "paid" && topup.reservationId !== null && (
          <p className="rounded-xl border-2 border-la-co bg-la-co/20 p-3 text-meta leading-5 text-beige-kem">
            Nếu chỗ bạn giữ vẫn còn hạn, bạn có thể quay lại thanh toán ngay. Nếu đã hết hạn, tiền
            vẫn nằm an toàn trong ví — chỉ cần chọn lại chỗ.
          </p>
        )}

        <button
          onClick={() => onDone(topup)}
          disabled={!settled}
          className="w-full rounded-xl bg-burgundy px-6 py-3 text-body font-black text-white transition hover:brightness-95 disabled:bg-surface-2 disabled:text-white/60"
        >
          {settled ? "Tiếp tục" : "Đang kiểm tra..."}
        </button>
      </div>
    </div>
  );
}
