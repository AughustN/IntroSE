/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BellOff, BellRing, Check, Loader2 } from "lucide-react";
import type { WaitlistEntry } from "../services/waitlistClient";

/**
 * What a sold-out scope offers: a way into the queue, or — once you are in it — confirmation that
 * you hold a place and a way out (UC-17, FR-011).
 *
 * One component for both places it appears, because they are the same offer at two sizes: a row in
 * the general-admission price list, and the primary action of a showtime with nothing left at all.
 * `tone="cta"` is the second of those.
 */
export default function WaitlistControl({
  entry,
  busy,
  closed = false,
  tone = "row",
  onJoin,
  onLeave,
}: {
  /** The reader's place in this queue, or `null` when they hold none. */
  entry: WaitlistEntry | null;
  busy: boolean;
  /** Inside the 24-hour cutoff: nothing can come back, so there is no queue to join. */
  closed?: boolean;
  tone?: "row" | "cta";
  onJoin: () => void;
  onLeave: () => void;
}) {
  const wide = tone === "cta";

  // Somebody already in the queue still gets their way out, even after it closes to newcomers:
  // their place is about to be closed by the server, and leaving is theirs to do meanwhile.
  if (!entry && closed) {
    return (
      <span
        className={`inline-flex items-center gap-2 border border-beige-kem/30 px-3 py-1.5 font-meta text-meta text-ink-soft ${
          wide ? "w-full justify-center" : ""
        }`}
      >
        <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Danh sách chờ đã đóng · dưới 24 giờ trước giờ diễn
      </span>
    );
  }

  if (entry) {
    return (
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${wide ? "w-full" : ""}`}>
        <span className="inline-flex items-center gap-2 border border-la-co bg-la-co/10 px-3 py-1.5 font-meta text-meta text-beige-kem">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {/* No place in line: waiting longer earns no priority, so a number would promise a turn
              that is never taken. What the queue does promise is the message. */}
          Đang chờ · sẽ báo khi có vé
        </span>
        <button
          type="button"
          onClick={onLeave}
          disabled={busy}
          className="font-meta text-meta text-ink-soft underline-offset-4 transition hover:text-beige-kem hover:underline disabled:opacity-50"
        >
          {busy ? "Đang xử lý…" : "Rời danh sách chờ"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onJoin}
      disabled={busy}
      className={
        wide
          ? "inline-flex h-12 w-full items-center justify-center gap-2 bg-burgundy px-6 font-display text-body font-black uppercase tracking-[0.04em] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          : "inline-flex h-11 shrink-0 items-center justify-center gap-2 border-2 border-beige-kem px-4 font-display text-body font-bold uppercase tracking-[0.04em] text-beige-kem transition hover:bg-bubblegum/25 disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <BellRing className="h-4 w-4 shrink-0" aria-hidden />
      )}
      Vào danh sách chờ
    </button>
  );
}
