/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useState } from "react";
import { ApiClientError, authClient } from "../services/authClient";

const inputClass =
  "h-11 w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 text-body text-beige-kem outline-none focus:border-burgundy";
const labelText = "mb-1.5 block font-meta text-eyebrow text-beige-kem/70";

export default function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authClient.resetPassword({ token, password, passwordConfirm });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.userMessage
          ? err.userMessage
          : "Không thể đặt lại mật khẩu.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-xanh-pho px-4 text-beige-kem">
      <div className="w-full max-w-md rounded-2xl border-2 border-beige-kem bg-surface-2 p-6">
        <h1 className="font-display text-title-m font-black">Đặt lại mật khẩu</h1>

        {done ? (
          <>
            <p className="mt-3 text-body leading-6 text-beige-kem/70">
              Mật khẩu đã được cập nhật. Bạn có thể đăng nhập bằng mật khẩu mới.
            </p>
            <a
              href="/"
              className="mt-6 flex w-full items-center justify-center rounded-xl bg-burgundy px-5 py-3 text-body font-black text-white transition hover:brightness-95"
            >
              Quay về trang chủ
            </a>
          </>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className={labelText}>Mật khẩu mới</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelText}>Nhập lại mật khẩu mới</span>
              <input
                type="password"
                required
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className={inputClass}
              />
            </label>

            {error && (
              <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-eyebrow leading-5 text-on-tint">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center rounded-xl bg-burgundy px-5 py-3 text-body font-black text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {busy ? "Đang xử lý…" : "Đặt lại mật khẩu"}
            </button>
            <a
              href="/"
              className="block text-center font-meta text-meta text-beige-kem/60 transition hover:text-ink-soft"
            >
              Quay về trang chủ
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
