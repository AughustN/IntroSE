/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MyEvent } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import { formatShowtimeAt } from "../../services/formatDate";
import { Empty } from "./states";

const ghost = " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

const BADGE: Record<string, { cls: string; text: string }> = {
  pending_review: { cls: "text-on-tint border-beige-kem bg-cam-dat", text: "Chờ duyệt" },
  approved: { cls: "text-on-tint border-beige-kem bg-la-co", text: "Đã duyệt" },
  removed: { cls: "text-beige-kem/60 border-beige-kem/25 bg-surface-2", text: "Đã gỡ/từ chối" },
  flagged: { cls: "text-on-tint border-beige-kem bg-cam-dat", text: "Bị gắn cờ" },
};

/**
 * Level 1 of the console: the organizer's events.
 *
 * The empty state is explicit rather than a blank region — an organizer who has just been approved
 * and has nothing yet should be told what to do next, not left looking at nothing (FR-040).
 */
export default function EventList({
  events,
  onOpen,
  onCreate,
}: {
  events: MyEvent[];
  onOpen: (event: MyEvent) => void;
  onCreate: () => void;
}) {
  if (events.length === 0) {
    return (
      <Empty
        title="Bạn chưa có sự kiện nào."
        hint="Tạo sự kiện đầu tiên để bắt đầu bán vé."
        action={
          <button onClick={onCreate} className={ghost}>
            Tạo sự kiện
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {events.map((ev) => {
        // Cancelled outranks whatever the moderation column says: an approved event that has been
        // cancelled and refunded is not "Đã duyệt" in any sense the organizer cares about.
        const cancelled = ev.status === "cancelled";
        const badge = cancelled
          ? { cls: "text-beige-kem border-burgundy bg-burgundy/30", text: "Đã hủy" }
          : (BADGE[ev.moderation] ?? { cls: "", text: ev.moderation });
        const isLive = !cancelled && ev.moderation === "approved" && ev.status === "on_sale";
        return (
          <button
            key={ev.id}
            onClick={() => onOpen(ev)}
            className="w-full border-2 border-beige-kem p-3 text-left transition hover:border-burgundy"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* ONE statement of where this event stands. The raw `ev.status` used to sit here in
                  mono beside the badge, so an organizer read "draft" and "Chờ duyệt" side by side —
                  two answers to one question, one of them a database enum they never chose. */}
              <div className="min-w-0">
                <span className="break-words font-bold">{ev.title}</span>
                <span className={`ml-2 border px-2 py-0.5 font-mono text-[10px] ${badge.cls}`}>
                  {badge.text}
                </span>
              </div>
              <span className="font-mono text-[11px] text-beige-kem/45">
                {isLive ? "Đang hiển thị công khai" : "Chưa hiển thị công khai"}
              </span>
            </div>

            {/*
              WHEN and WHERE. Rendered only when there is a showtime to name — an event created but
              not yet scheduled prints no line at all rather than a row of dashes, because a
              placeholder costs the same vertical space as the answer while carrying none of it.
            */}
            {ev.nextShowtimeAt && (
              <p className="mt-1 font-mono text-[11px] text-beige-kem/60">
                {formatShowtimeAt(ev.nextShowtimeAt)}
                {ev.venueName ? ` · ${ev.venueName}` : ""}
              </p>
            )}

            {/*
              HOW IT IS SELLING — the question the organizer opened this page with, and until now the
              one thing the row would not answer. Sold-over-capacity rather than sold alone: 12 tickets
              means nothing without knowing whether the room holds 20 or 2,000.

              Capacity of 0 means no tier has been created yet, so there is nothing to be a fraction
              OF; that case shows the revenue alone rather than the "0/0" that reads like a sold-out
              room of no seats.
            */}
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-beige-kem/70">
              {ev.totalCapacity > 0
                ? `${ev.soldTickets.toLocaleString("vi-VN")}/${ev.totalCapacity.toLocaleString("vi-VN")} vé`
                : "Chưa có hạng vé"}
              {" · "}
              {formatVnd(ev.totalRevenueVnd)}
            </p>

            {ev.reviewNote && <p className="mt-1 text-[11px] text-burgundy">{ev.reviewNote}</p>}
          </button>
        );
      })}
    </div>
  );
}
