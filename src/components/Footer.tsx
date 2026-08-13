/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { Screen } from "../routes";

interface FooterProps {
  onNavigate: (screen: Screen) => void;
  /**
   * Absent until a subscribe endpoint exists. The form renders either way, but without a handler
   * it stays disabled rather than swallowing an address and returning nothing — a newsletter box
   * that accepts an email and does not subscribe anyone is worse than a visibly unfinished one.
   */
  onSubscribe?: (email: string) => void;
  /** Opens the account page on its "Nhà tổ chức" section, where the application form lives. */
  onApplyAsOrganizer: () => void;
  /** If the currently authenticated user has the ORGANIZER role, hide the registration CTA. */
  isOrganizer?: boolean;
}

/** A column of destinations. Every entry here is a route that exists. */
const COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<[string, Screen]> }> = [
  {
    title: "Khám phá",
    links: [
      ["Sự kiện", "browse"],
      ["Trang chủ", "home"],
    ],
  },
  {
    title: "Của tôi",
    links: [
      ["Vé của tôi", "history"],
      ["Đã lưu", "saved"],
      ["Ví TixHub", "wallet"],
    ],
  },
  {
    title: "Hỗ trợ",
    links: [
      ["Về chúng tôi", "about-us"],
      ["Điều khoản sử dụng", "terms-of-service"],
      ["Chính sách hoàn vé", "refund-policy"],
    ],
  },
];

function NavColumn({
  column,
  onNavigate,
  className = "",
}: {
  column: (typeof COLUMNS)[number];
  onNavigate: (screen: Screen) => void;
  className?: string;
}) {
  return (
    <nav className={className}>
      <p className="label-eyebrow text-ink-soft">{column.title}</p>
      <ul className="mt-4 space-y-2">
        {column.links.map(([label, screen]) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => onNavigate(screen)}
              className="font-meta text-body text-beige-kem transition hover:text-burgundy-ink"
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function Footer({ onNavigate, onSubscribe, onApplyAsOrganizer, isOrganizer = false }: FooterProps) {
  const [email, setEmail] = useState("");

  return (
    <footer className="border-t border-beige-kem/25 bg-xanh-pho">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="hud-rule-stack" />

        <div className="mt-10 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          {/*
           * The wordmark sits in the first cell, directly over the first column, rather than
           * spanning the footer as a banner. Broken by hand into three lines: at forty characters it
           * would otherwise break wherever the column happened to run out, which lands mid-phrase.
           * `text-balance` is no help — it evens out ragged lines, it does not know where the sense
           * of a sentence divides.
           */}
          <div>
            <p className="font-display text-title-m font-black leading-[1.05] tracking-tight text-beige-kem sm:text-title-m">
              {["TixHub:", "Đặt vé liền tay,", "săn ngay kẻo hết."].map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>

            <NavColumn column={COLUMNS[0]} onNavigate={onNavigate} className="mt-9" />
          </div>

          {COLUMNS.slice(1).map((column) => (
            <NavColumn key={column.title} column={column} onNavigate={onNavigate} />
          ))}

          <div>
            <p className="label-eyebrow text-ink-soft">Giữ liên lạc</p>
            <p className="mt-4 text-body leading-6 text-beige-kem/70">
              Nhận vé mở bán sớm, mã giảm giá và lịch diễn mới trước khi hết chỗ.
            </p>

            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!onSubscribe || !email) return;
                onSubscribe(email);
                setEmail("");
              }}
            >
              <div className="flex items-center border-b border-beige-kem/40 focus-within:border-beige-kem">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!onSubscribe}
                  placeholder="email@cua-ban.com"
                  aria-label="Email nhận bản tin"
                  className="w-full bg-transparent py-2 font-meta text-body text-beige-kem outline-none placeholder:text-beige-kem/35 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!onSubscribe}
                  className="label-eyebrow shrink-0 py-2 pl-3 text-beige-kem transition hover:text-burgundy-ink disabled:cursor-not-allowed disabled:text-ink-soft"
                >
                  Đăng ký &gt;
                </button>
              </div>
            </form>

            {!onSubscribe && <p className="mt-2 font-meta text-meta text-ink-soft">Sắp mở.</p>}
          </div>
        </div>

        {/*
          The organiser pitch, Doron's affiliate banner in the same slot.

          It opens the application form, not the management console. This is the one place in the
          product aimed at someone who is *not* an organizer yet — sending them to `/organizer` gave
          them an empty event list and no way to find out what to do about it. The console has its
          own way in, from the nav menu, and only once an application has been approved.
        */}
        {!isOrganizer && (
          <div className="hud-dashed mt-14 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-title-m font-black text-beige-kem">
                Bán vé cùng TixHub
              </p>
              <p className="mt-1 text-body text-beige-kem/70">
                Đăng sự kiện, dựng sơ đồ ghế và theo dõi doanh thu trong một trang.
              </p>
            </div>
            <button
              type="button"
              onClick={onApplyAsOrganizer}
              className="label-eyebrow inline-flex shrink-0 items-center gap-2 text-beige-kem transition hover:text-burgundy-ink"
            >
              Đăng ký làm nhà tổ chức
              <span aria-hidden="true">&gt;</span>
            </button>
          </div>
        )}

        {/*
          Copyright alone. "Điều khoản website" used to sit here as well, opening a second terms
          page beside the "Điều khoản sử dụng" already in the Hỗ trợ column above — two links, two
          routes, one subject, and no way for a reader to tell which one they wanted.
        */}
        <div className="mt-10 border-t border-beige-kem/25 pt-6 font-meta text-meta text-ink-soft">
          <p>© 2026 TixHub</p>
        </div>
      </div>
    </footer>
  );
}
