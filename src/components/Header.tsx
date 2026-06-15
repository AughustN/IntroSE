/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Moon, Sun } from "lucide-react";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onViewHistory: () => void;
  onHomeClick: () => void;
  onLoginClick: () => void;
  onAdminClick: () => void;
  userName?: string;
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
  theme,
  onToggleTheme,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-beige-kem/10 bg-xanh-pho/95 px-4 py-3 text-beige-kem shadow-2xl backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <button
            onClick={onHomeClick}
            className="group text-left"
            title="Trang chủ"
          >
            <span>
              <span className="block font-display text-2xl font-black tracking-normal text-beige-kem">
                TicketBox
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-cam-dat">
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
              className="h-11 w-full rounded-xl border border-beige-kem/20 bg-white/[0.04] px-4 text-sm text-beige-kem outline-none transition placeholder:text-beige-kem/40 focus:border-cam-dat"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onViewHistory}
              className="inline-flex h-10 items-center rounded-xl border border-la-co/35 bg-la-co/10 px-3 text-xs font-bold uppercase tracking-normal text-la-co transition hover:border-la-co hover:bg-la-co/15"
              title="Vé của tôi"
            >
              Vé của tôi
            </button>
            <button
              onClick={onLoginClick}
              className="inline-flex h-10 items-center rounded-xl border border-beige-kem/20 bg-white/[0.04] px-3 text-xs font-bold uppercase tracking-normal text-beige-kem transition hover:border-cam-dat"
              title="Đăng nhập"
            >
              {userName || "Đăng nhập"}
            </button>
            <button
              onClick={onAdminClick}
              className="inline-flex h-10 items-center rounded-xl border border-burgundy/50 bg-burgundy/15 px-3 text-xs font-bold uppercase tracking-normal text-beige-kem transition hover:bg-burgundy/25"
              title="Trang quản trị mock"
            >
              Admin
            </button>
            <button
              onClick={onToggleTheme}
              className="grid h-10 w-10 place-items-center rounded-xl border border-cam-dat/35 bg-cam-dat/10 text-cam-dat transition hover:border-cam-dat hover:bg-cam-dat/15"
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
