/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode } from "react";

/**
 * Loading, empty and error as first-class states, shared by all four console levels (FR-040).
 *
 * They live in one place because the alternative — each screen inventing its own — is how a console
 * ends up with a spinner that never resolves on one level and a blank region on another. Every string
 * here is Vietnamese (USE-03).
 */

const box = " border-2 border-beige-kem/40 bg-surface-2 p-6 text-center";

export function Loading({ label = "Đang tải…" }: { label?: string }) {
  return (
    <div className={box} role="status" aria-live="polite">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-beige-kem border-t-transparent align-middle" />
      <span className="ml-3 align-middle font-mono text-xs text-beige-kem/70">{label}</span>
    </div>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className={box}>
      <p className="font-display text-base font-bold text-beige-kem">{title}</p>
      {hint && <p className="mt-1 text-sm text-beige-kem/60">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * An error always offers a way back. It never replaces the data already on screen with a silent
 * stale copy — the caller clears its data before showing this.
 */
export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={`${box} border-burgundy`} role="alert">
      <p className="text-sm text-beige-kem">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80"
      >
        Thử lại
      </button>
    </div>
  );
}

/** A server refusal rendered against the control that caused it, message as-is (FR-041). */
export function Refusal({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="mt-2 border border-burgundy bg-burgundy/10 px-3 py-2 text-xs text-beige-kem"
      role="alert"
    >
      {message}
    </p>
  );
}

/** Money as whole đồng, never a float (STD-03). */
export const dong = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
