/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BellOff,
  BellPlus,
  BellRing,
  CalendarClock,
  CheckCheck,
  Inbox,
  Megaphone,
  Ticket,
} from "lucide-react";
import type { NotificationItem, NotificationType } from "../services/notificationsClient";

/** What each kind of message is about, at a glance. */
const ICONS: Record<NotificationType, typeof BellRing> = {
  waitlist_joined: BellPlus,
  waitlist_open: BellRing,
  waitlist_closed: BellOff,
  order_confirmed: Ticket,
  ticket_resend: Ticket,
  reminder_7d: CalendarClock,
  reminder_1d: CalendarClock,
  event_changed: Megaphone,
  event_cancelled: Megaphone,
  announcement: Megaphone,
};

const formatMoment = (iso: string): string =>
  new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Saigon" });

/**
 * Everything the product has said to this account (UC-19), newest first.
 *
 * The page exists because messages were being written and never read: a `waitlist_open` told a
 * waiter that tickets had come back, and the only place it landed was a database row and an email.
 *
 * Opening a row marks it read and goes where it points — for a waitlist message, the event whose
 * tickets came back, since the whole message is an invitation to race for them.
 */
export default function NotificationsPage({
  items,
  loading,
  error,
  onBack,
  onOpen,
  onMarkAllRead,
}: {
  items: NotificationItem[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  /** Mark read, then follow it if it leads anywhere. */
  onOpen: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
}) {
  const unread = items.filter((item) => item.readAt === null).length;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <button
          onClick={onBack}
          className="font-meta text-meta text-ink-soft transition hover:text-beige-kem"
        >
          ← Quay về trang chủ
        </button>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-beige-kem/30 pb-5">
          <h1 className="font-display text-title-l font-black uppercase leading-none tracking-[0.02em] text-beige-kem">
            Thông báo
          </h1>
          {unread > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="inline-flex items-center gap-2 font-meta text-meta text-ink-soft transition hover:text-beige-kem"
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              Đánh dấu tất cả đã đọc ({unread})
            </button>
          )}
        </div>
      </div>

      {loading && <p className="font-meta text-body text-ink-soft">Đang tải thông báo…</p>}

      {error && !loading && (
        <div
          role="alert"
          className="ticket-corners border-l-2 border-burgundy bg-bubblegum/25 p-5 text-body leading-6 text-beige-kem"
        >
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        // Words, not an empty frame: an account with nothing waiting for it should be told that
        // plainly rather than left looking at a container.
        <div className="hud-dashed mx-auto max-w-lg px-6 py-20 text-center">
          <Inbox aria-hidden="true" className="mx-auto h-8 w-8 text-ink-soft" />
          <h2 className="mt-4 font-display text-title-s font-black uppercase tracking-[0.03em] text-beige-kem">
            Chưa có thông báo nào
          </h2>
          <p className="mt-3 text-body leading-6 text-beige-kem/70">
            Xác nhận mua vé, nhắc lịch trước ngày diễn và tin báo có vé lại từ danh sách chờ sẽ xuất
            hiện ở đây.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="border-t border-beige-kem/25">
          {items.map((item) => {
            const Icon = ICONS[item.type] ?? Megaphone;
            const unreadRow = item.readAt === null;
            return (
              <li key={item.id} className="border-b border-beige-kem/25">
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="flex w-full items-start gap-4 px-2 py-5 text-left transition hover:bg-bubblegum/20"
                >
                  {/*
                    Unread is carried twice — a filled marker and full-strength ink — because
                    colour alone is not a state a reader can be assumed to see.
                  */}
                  <span className="mt-1 flex shrink-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={`h-2 w-2 rounded-full ${unreadRow ? "bg-burgundy" : "bg-transparent"}`}
                    />
                    <Icon
                      className={`h-5 w-5 ${unreadRow ? "text-beige-kem" : "text-ink-soft"}`}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block font-display text-body uppercase tracking-[0.03em] ${
                        unreadRow ? "font-black text-beige-kem" : "font-bold text-ink-soft"
                      }`}
                    >
                      {item.title}
                      <span className="sr-only">{unreadRow ? " — chưa đọc" : " — đã đọc"}</span>
                    </span>
                    <span className="mt-1.5 block text-body leading-6 text-beige-kem/80">
                      {item.body}
                    </span>
                    <span className="mt-1.5 block font-meta text-meta text-ink-soft">
                      {formatMoment(item.createdAt)}
                      {/* A waitlist row leads somewhere with something to do on arrival, so it
                          says so: "xem" undersells an invitation to race for returned stock. */}
                      {item.eventSlug &&
                        (item.type === "waitlist_open" ? " · Mua vé ngay" : " · Xem sự kiện")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
