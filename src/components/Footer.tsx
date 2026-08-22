/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Screen } from "../routes";

interface FooterProps {
  onNavigate: (screen: Screen) => void;
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

export default function Footer({ onNavigate, onApplyAsOrganizer, isOrganizer = false }: FooterProps) {

  return (
    <footer className="border-t border-beige-kem/25 bg-xanh-pho">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {/*
          One hairline, not the three-bar stack.

          `hud-rule-stack` draws rules at 100%, 62% and 28% of the width, two pixels apart — a
          drafting-sheet mark that reads as deliberate above a card band, where it is one motif among
          several. Sitting alone across the top of the footer it had nothing to belong to, and three
          lines of unequal length just look like a rule that failed to paint. The footer already has
          its own `border-t` above; this one only has to separate the columns from the band.
        */}
        <div className="border-t border-beige-kem/25" />

        <div className="mt-10 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          {/*
           * The wordmark takes the first cell on its own, and the three nav columns take the rest.
           *
           * It used to share the cell with "Khám phá" stacked under it, because a newsletter box
           * held the fourth. That box is gone — it promised early access and discount codes, and
           * nothing in the system sends either, while the waitlist and its notifications already do
           * the job it was miming. Promoting "Khám phá" into the freed slot keeps the row at four
           * and gives every column one heading, which is what the other three always had.
           *
           * Broken by hand into three lines: at forty characters it would otherwise break wherever
           * the column happened to run out, which lands mid-phrase. `text-balance` is no help — it
           * evens out ragged lines, it does not know where the sense of a sentence divides.
           */}
          <div>
            <p className="font-display text-title-m font-black leading-[1.05] tracking-tight text-beige-kem sm:text-title-m">
              {["TixHub:", "Đặt vé liền tay,", "săn ngay kẻo hết."].map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          </div>

          {COLUMNS.map((column) => (
            <NavColumn key={column.title} column={column} onNavigate={onNavigate} />
          ))}

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
