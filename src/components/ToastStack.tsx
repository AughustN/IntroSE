/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { X } from "lucide-react";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

/**
 * In-app notifications, replacing `window.alert`. A browser alert blocks the whole page and hides
 * the very thing it is talking about — on the seat map that means the buyer cannot see the seat that
 * was just taken, or the countdown that just ran out, until they dismiss it.
 *
 * Announced politely to screen readers, except errors, which interrupt (WCAG 2.1, USE-02).
 */
/** What each kind of news calls itself. The heading is the only tone signal the card carries. */
const LABEL: Record<ToastKind, string> = {
  info: "Thông báo",
  success: "Thành công",
  warning: "Lưu ý",
  error: "Lỗi",
};

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    /*
     * Dressed as `ConfirmDialog` — the same scrim, the same centred card, the same border, heading
     * and body type. The two say different kinds of thing (that one asks a question, this one
     * reports an outcome), but they are the app's two ways of speaking directly to the reader, and
     * a notice that looks like a passing corner chip reads as less important than it is.
     *
     * One scrim for the whole stack, not one per notice: three outcomes at once would otherwise
     * stack three washes and darken the page three times over.
     */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      // Anywhere outside the cards clears them, as the dialog's backdrop cancels it.
      onClick={() => toasts.forEach((toast) => onDismiss(toast.id))}
      role="presentation"
    >
      <div
        className="flex w-full max-w-md flex-col gap-3"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => {
          return (
            <div
              key={toast.id}
              role={toast.kind === "error" ? "alert" : "status"}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl border-2 border-beige-kem bg-xanh-pho p-6"
            >
              <div className="flex items-start gap-3">
                {/* The heading is the whole signal. A coloured dot beside a word that already says
                    "Lỗi" or "Thành công" adds nothing a reader was missing. */}
                <h2 className="flex-1 font-display text-title-m font-black text-beige-kem">
                  {LABEL[toast.kind]}
                </h2>
                <button
                  onClick={() => onDismiss(toast.id)}
                  className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-soft transition hover:bg-bubblegum/25 hover:text-beige-kem"
                  aria-label="Đóng thông báo"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="mt-3 whitespace-pre-line text-body leading-6 text-beige-kem/70">
                {toast.text}
              </p>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => onDismiss(toast.id)}
                  className="rounded-xl border-2 border-beige-kem px-4 py-2.5 font-meta text-body text-beige-kem/80 transition hover:border-beige-kem/40 hover:text-beige-kem"
                >
                  Đóng
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
