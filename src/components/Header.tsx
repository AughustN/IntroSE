/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_AVATAR_FG, avatarColor } from "../services/defaultAvatar";

/**
 * The signed-in user's picture, with a colour-seeded initial as the fallback.
 *
 * The URL may come from the local cache, which lets the real picture paint on the first frame
 * instead of flashing the initial while the session is restored. That cache can be stale — the
 * avatar could have been replaced from another device — so a failed load quietly falls back
 * rather than leaving a broken image.
 */
function AccountAvatar({
  userName,
  userEmail,
  avatarUrl,
}: {
  userName: string;
  userEmail?: string | null;
  avatarUrl?: string | null;
}) {
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [avatarUrl]);

  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        className="h-6 w-6 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold normal-case"
      style={{ backgroundColor: avatarColor(userEmail), color: DEFAULT_AVATAR_FG }}
    >
      {userName.charAt(0).toUpperCase()}
    </span>
  );
}

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onViewHistory: () => void;
  onHomeClick: () => void;
  onLoginClick: () => void;
  onAdminClick: () => void;
  userName?: string;
  userEmail?: string | null;
  avatarUrl?: string | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export default function Header({
  searchQuery,
  onSearchChange,
  onViewHistory,
  onHomeClick,
  onLoginClick,
  onAdminClick,
  userName,
  userEmail,
  avatarUrl,
  theme,
  onToggleTheme,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-beige-kem/25 bg-xanh-pho px-4 py-3 text-beige-kem shadow-hard sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <button onClick={onHomeClick} className="group text-left" title="Trang chủ">
            <span>
              <span className="block font-display text-2xl font-black tracking-normal text-beige-kem">
                TixHub
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
                Music / Stage / Film
              </span>
            </span>
          </button>

          <div className="flex-1 lg:max-w-xl">
            <input
              type="text"
              placeholder="Tìm tên sự kiện, nghệ sĩ, phim, rạp, nhà hát, địa điểm..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-11 w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 text-sm text-beige-kem outline-none transition placeholder:text-beige-kem/40 focus:border-burgundy"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onViewHistory}
              className="inline-flex h-10 items-center rounded-xl border-2 border-beige-kem bg-la-co px-3 text-xs font-bold uppercase tracking-normal text-on-tint transition hover:brightness-95"
              title="Vé của tôi"
            >
              Vé của tôi
            </button>
            <button
              onClick={onLoginClick}
              className="inline-flex h-10 items-center gap-2 rounded-xl border-2 border-beige-kem bg-surface-2 px-3 text-xs font-bold uppercase tracking-normal text-beige-kem transition"
              title={userName ? "Tài khoản" : "Đăng nhập"}
            >
              {userName ? (
                <>
                  <AccountAvatar userName={userName} userEmail={userEmail} avatarUrl={avatarUrl} />
                  <span className="normal-case">{userName}</span>
                </>
              ) : (
                "Đăng nhập"
              )}
            </button>
            <button
              onClick={onAdminClick}
              className="inline-flex h-10 items-center rounded-xl border-2 border-beige-kem bg-bubblegum px-3 text-xs font-bold uppercase tracking-normal text-on-tint transition hover:brightness-95"
              title="Trang quản trị mock"
            >
              Admin
            </button>
            <button
              onClick={onToggleTheme}
              className="grid h-10 w-10 place-items-center rounded-xl border-2 border-beige-kem bg-cam-dat text-on-tint transition hover:brightness-95"
              aria-label={theme === "dark" ? "Chuyển sang light mode" : "Chuyển sang dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
