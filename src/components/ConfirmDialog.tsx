/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for anything that throws work away — leaving the flow, dropping a hold, wiping history. */
  tone: "danger" | "normal";
}

interface ConfirmDialogProps extends ConfirmRequest {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app replacement for `window.confirm`. Unlike a toast this is a question, so it is modal on
 * purpose: it takes focus, traps Escape, and blocks the page behind it until answered.
 *
 * Cancel is the default focus and the outcome of Escape / a backdrop click — the safe answer, since
 * every use of this dialog is about discarding something the buyer already has.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border-2 border-beige-kem bg-xanh-pho p-6"
      >
        <h2 id="confirm-title" className="font-display text-title-m font-black text-beige-kem">
          {title}
        </h2>
        <p
          id="confirm-message"
          className="mt-3 whitespace-pre-line text-body leading-6 text-beige-kem/70"
        >
          {message}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-xl border-2 border-beige-kem px-4 py-2.5 font-meta text-body text-beige-kem/80 transition hover:border-beige-kem/40 hover:text-beige-kem"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2.5 font-meta text-body font-bold text-beige-kem transition ${
              tone === "danger"
                ? "bg-burgundy hover:brightness-95"
                : "bg-cam-dat hover:brightness-95"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
