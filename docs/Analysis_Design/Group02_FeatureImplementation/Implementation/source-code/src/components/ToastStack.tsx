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
const TONE: Record<ToastKind, { frame: string; accent: string; label: string }> = {
  info: { frame: "border-beige-kem/25 bg-xanh-pho", accent: "bg-surface-2", label: "Thông báo" },
  success: { frame: "border-la-co/45 bg-xanh-pho", accent: "bg-la-co", label: "Thành công" },
  warning: { frame: "border-cam-dat/50 bg-xanh-pho", accent: "bg-cam-dat", label: "Lưu ý" },
  error: { frame: "border-burgundy/60 bg-xanh-pho", accent: "bg-burgundy", label: "Lỗi" },
};

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[26rem]"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => {
        const tone = TONE[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-3 overflow-hidden rounded-xl border ${tone.frame} p-3 pr-2`}
          >
            <span className={`mt-0.5 h-full w-1 shrink-0 self-stretch rounded-full ${tone.accent}`} />

            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-beige-kem/45">{tone.label}</p>
              <p className="mt-1 text-sm leading-5 text-beige-kem">{toast.text}</p>
            </div>

            <button
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded-lg p-1.5 text-beige-kem/40 transition hover:bg-surface-2 hover:text-beige-kem"
              aria-label="Đóng thông báo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
