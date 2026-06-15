/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useState } from "react";

interface AuthModalProps {
  onClose: () => void;
  onLogin: (userName: string) => void;
}

export default function AuthModal({ onClose, onLogin }: AuthModalProps) {
  const [email, setEmail] = useState("khachhang@ticketbox.vn");

  const handleEmailLogin = (event: FormEvent) => {
    event.preventDefault();
    const userName = email.split("@")[0] || "Khách hàng";
    onLogin(userName);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-beige-kem/15 bg-xanh-pho p-6 text-beige-kem shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-black">Đăng nhập</h2>
            <p className="mt-2 text-sm leading-6 text-beige-kem/65">
              Mock đăng nhập để thử luồng vé của tôi, wishlist và gửi lại vé.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 place-items-center rounded-xl border border-beige-kem/10 px-3 font-mono text-[11px] font-bold uppercase text-beige-kem/70 transition hover:border-cam-dat hover:text-beige-kem"
            title="Đóng"
          >
            Đóng
          </button>
        </div>

        <form onSubmit={handleEmailLogin} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block font-mono text-xs text-beige-kem/70">Email</span>
            <span className="relative block">
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 w-full rounded-xl border border-beige-kem/20 bg-white/[0.035] px-4 text-sm text-beige-kem outline-none focus:border-cam-dat"
              />
            </span>
          </label>

          <button
            type="submit"
            className="flex w-full items-center justify-center rounded-xl bg-burgundy px-5 py-3 text-sm font-black text-beige-kem transition hover:bg-burgundy/90"
          >
            Tiếp tục với email
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-normal text-beige-kem/40">
          <span className="h-px flex-1 bg-beige-kem/10" />
          Hoặc
          <span className="h-px flex-1 bg-beige-kem/10" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => onLogin("Google User")}
            className="rounded-xl border border-beige-kem/15 bg-white/[0.035] px-4 py-3 text-sm font-bold transition hover:border-cam-dat"
          >
            Google
          </button>
          <button
            onClick={() => onLogin("Facebook User")}
            className="rounded-xl border border-beige-kem/15 bg-white/[0.035] px-4 py-3 text-sm font-bold transition hover:border-cam-dat"
          >
            Facebook
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-xs leading-5 text-la-co">
          <span>Backend sau này cần OAuth thật, session/token, quên mật khẩu và liên kết lịch sử đơn hàng theo user id.</span>
        </div>
      </div>
    </div>
  );
}
