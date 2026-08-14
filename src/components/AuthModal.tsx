/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Me } from "@/shared/auth/types";
import { ApiClientError, authClient } from "../services/authClient";

interface AuthModalProps {
  onClose: () => void;
  onLogin: (user: Me) => void;
}

// Google Identity Services global (loaded from the GSI script). Minimal typing.
interface GsiId {
  initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  prompt(): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

type Mode = "login" | "register";

const inputClass =
  "h-11 w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 text-body text-beige-kem outline-none focus:border-burgundy";
const labelText = "mb-1.5 block font-meta text-eyebrow text-beige-kem/70";

export default function AuthModal({ onClose, onLogin }: AuthModalProps) {
  // Google Identity Services captures its callback once at initialize() time, so a plain closure
  // would freeze the first render's onLogin (and the pending post-login action it closes over).
  // Route the Google callback through a ref that always holds the latest onLogin.
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) =>
    setError(
      e instanceof ApiClientError && e.userMessage
        ? e.userMessage
        : "Có lỗi xảy ra, vui lòng thử lại.",
    );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const user =
        mode === "login"
          ? await authClient.login({ identifier, password })
          : await authClient.register({
              email,
              nickname,
              phone: phone.trim() || null,
              password,
              passwordConfirm,
            });
      onLogin(user);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    setError(null);
    if (!identifier.includes("@")) {
      setError("Nhập email của bạn để nhận liên kết đặt lại mật khẩu.");
      return;
    }
    try {
      await authClient.forgotPassword({ email: identifier });
      setNotice("Nếu email tồn tại, chúng tôi đã gửi liên kết đặt lại mật khẩu.");
    } catch (e) {
      fail(e);
    }
  };

  // Render the official Google Identity Services button (reliable, unlike One Tap prompt()).
  const googleBtnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const render = (): boolean => {
      const gid = window.google?.accounts?.id;
      if (!gid || !googleBtnRef.current) return false;
      gid.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (r) => {
          try {
            const user = await authClient.loginWithGoogle(r.credential);
            onLoginRef.current(user);
          } catch (e) {
            fail(e);
          }
        },
      });
      googleBtnRef.current.replaceChildren();
      gid.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        width: 340,
        text: "continue_with",
      });
      return true;
    };
    if (render()) return;
    if (!document.getElementById("gsi-script")) {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.id = "gsi-script";
      document.head.appendChild(s);
    }
    const timer = setInterval(() => {
      if (render()) clearInterval(timer);
    }, 300);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-beige-kem bg-xanh-pho p-6 text-beige-kem">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-title-m font-black">
              {mode === "login" ? "Đăng nhập" : "Đăng ký"}
            </h2>
            <p className="mt-2 text-body leading-6 text-beige-kem/65">
              {mode === "login"
                ? "Đăng nhập bằng email hoặc số điện thoại để quản lý vé, wishlist và đơn hàng."
                : "Tạo tài khoản TixHub với email, biệt danh và mật khẩu."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 place-items-center rounded-xl border-2 border-beige-kem px-3 font-meta text-meta font-bold uppercase text-beige-kem/70 transition hover:text-beige-kem"
            title="Đóng"
          >
            Đóng
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "login" ? (
            <label className="block">
              <span className={labelText}>Email hoặc số điện thoại</span>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
              />
            </label>
          ) : (
            <>
              <label className="block">
                <span className={labelText}>Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelText}>Biệt danh</span>
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelText}>Số điện thoại (không bắt buộc)</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          <label className="block">
            <span className={labelText}>Mật khẩu</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          {mode === "register" && (
            <label className="block">
              <span className={labelText}>Nhập lại mật khẩu</span>
              <input
                type="password"
                required
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className={inputClass}
              />
            </label>
          )}

          {error && (
            <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-eyebrow leading-5 text-on-tint">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border-2 border-la-co bg-la-co/20 p-3 text-eyebrow leading-5 text-beige-kem">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center rounded-xl bg-burgundy px-5 py-3 text-body font-black text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>

          {mode === "login" && (
            <button
              type="button"
              onClick={handleForgot}
              className="block w-full text-center font-meta text-meta text-beige-kem/60 transition hover:text-ink-soft"
            >
              Quên mật khẩu?
            </button>
          )}
        </form>

        <div className="my-5 flex items-center gap-3 text-eyebrow uppercase tracking-normal text-ink-soft">
          <span className="h-px flex-1 bg-beige-kem/30" />
          Hoặc
          <span className="h-px flex-1 bg-beige-kem/30" />
        </div>

        {GOOGLE_CLIENT_ID ? (
          <div ref={googleBtnRef} className="flex justify-center" />
        ) : (
          <div className="rounded-xl border-2 border-beige-kem bg-surface-2 p-3 text-center text-eyebrow text-beige-kem/50">
            Đăng nhập Google chưa được cấu hình.
          </div>
        )}

        <p className="mt-5 text-center text-eyebrow text-beige-kem/70">
          {mode === "login" ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "login" ? "register" : "login"));
              setError(null);
              setNotice(null);
            }}
            className="font-bold text-beige-kem underline underline-offset-2 transition hover:text-ink-soft"
          >
            {mode === "login" ? "Đăng ký" : "Đăng nhập"}
          </button>
        </p>
      </div>
    </div>
  );
}
