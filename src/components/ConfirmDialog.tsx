/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useId } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus";

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
  busy?: boolean;
  error?: string | null;
  onSave?: () => void;
  saveLabel?: string;
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
  busy = false,
  error,
  onSave,
  saveLabel = "Lưu rồi rời đi",
}: ConfirmDialogProps) {
  const id = useId();
  const dialogRef = useDialogFocus(onCancel, busy);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto border-2 border-beige-kem bg-xanh-pho p-6 text-beige-kem"
      >
        <h2 id={`${id}-title`} className="font-display text-title-m font-black text-beige-kem">
          {title}
        </h2>
        <p
          id={`${id}-message`}
          className="mt-3 whitespace-pre-line text-body leading-6 text-beige-kem/70"
        >
          {message}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-burgundy-ink">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            data-dialog-autofocus
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 border-2 border-beige-kem px-4 py-2.5 font-meta text-body text-beige-kem/80 transition hover:border-beige-kem/40 hover:text-beige-kem focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-11 px-4 py-2.5 font-meta text-body font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${
              onSave
                ? "border-2 border-burgundy text-burgundy-ink hover:bg-burgundy/10"
                : tone === "danger"
                  ? "bg-burgundy text-white hover:brightness-95"
                  : "bg-cam-dat text-on-tint hover:brightness-95"
            }`}
          >
            {confirmLabel}
          </button>
          {onSave && (
            <button
              type="button"
              disabled={busy}
              onClick={onSave}
              className="min-h-11 bg-burgundy px-4 py-2.5 font-meta text-body font-bold text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {busy ? "Đang lưu…" : saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
