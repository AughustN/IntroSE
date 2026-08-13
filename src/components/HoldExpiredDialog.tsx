/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { TimerOff } from "lucide-react";

/** How long the notice stays up before it closes itself. */
const AUTO_DISMISS_MS = 30_000;

interface HoldExpiredDialogProps {
  /** Stay on the screen the buyer was returned to. Also what the backdrop, Escape and the timer do. */
  onStay: () => void;
  /** Leave the flow for the landing page. */
  onGoHome: () => void;
}

/**
 * Shown when the seat hold runs out (UC-11 A2).
 *
 * A toast was the wrong shape for this: losing the selection ends the purchase, and a corner
 * notification that fades on its own timer is read as an aside — buyers looked back at a seat map
 * that had silently reset and did not know why. So this is centre-screen and modal, with the two
 * moves that actually follow: pick again here, or leave for the landing page.
 *
 * It is not a question, so unlike `ConfirmDialog` it does close itself — after 30s, long enough to
 * read and act on rather than the few seconds a toast lived for. The remaining seconds are printed
 * so the close is not a surprise either.
 */
export default function HoldExpiredDialog({ onStay, onGoHome }: HoldExpiredDialogProps) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const [secondsLeft, setSecondsLeft] = useState(Math.round(AUTO_DISMISS_MS / 1000));

  // Latest closer, so the countdown below is started once and never restarted by a new callback
  // identity — a re-render must not hand the buyer a fresh 30 seconds.
  const onStayRef = useRef(onStay);
  useEffect(() => {
    onStayRef.current = onStay;
  }, [onStay]);

  useEffect(() => {
    stayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStayRef.current();
    };
    window.addEventListener("keydown", onKey);

    const deadline = Date.now() + AUTO_DISMISS_MS;
    const tick = window.setInterval(() => {
      const left = Math.max(deadline - Date.now(), 0);
      setSecondsLeft(Math.ceil(left / 1000));
      if (left === 0) {
        window.clearInterval(tick);
        onStayRef.current();
      }
    }, 250);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(tick);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onStay}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hold-expired-title"
        aria-describedby="hold-expired-message"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border-2 border-cam-dat bg-xanh-pho p-6 text-center sm:p-8"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cam-dat/15">
          <TimerOff className="h-7 w-7 text-cam-dat" />
        </span>

        <h2
          id="hold-expired-title"
          className="mt-4 font-display text-title-m font-black text-beige-kem sm:text-title-l"
        >
          Đã hết thời gian giữ chỗ
        </h2>
        <p
          id="hold-expired-message"
          className="mx-auto mt-3 max-w-md text-body leading-6 text-beige-kem/70"
        >
          Ghế bạn chọn đã được trả lại cho người khác. Bạn có thể chọn lại từ đầu hoặc quay về trang
          chủ để tìm sự kiện khác.
        </p>

        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <button
            onClick={onGoHome}
            className="rounded-xl border-2 border-beige-kem px-5 py-2.5 font-meta text-body text-beige-kem/80 transition hover:border-beige-kem/40 hover:text-beige-kem"
          >
            Về trang chủ
          </button>
          <button
            ref={stayRef}
            onClick={onStay}
            className="rounded-xl bg-cam-dat px-5 py-2.5 font-meta text-body font-bold text-beige-kem transition hover:brightness-95"
          >
            Quay lại chọn vé
          </button>
        </div>

        <p className="mt-4 font-meta text-eyebrow uppercase tracking-wider text-beige-kem/40 tabular-nums">
          Tự đóng sau {secondsLeft}s
        </p>
      </div>
    </div>
  );
}
