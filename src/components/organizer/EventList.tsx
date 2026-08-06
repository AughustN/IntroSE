/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MyEvent } from "../../services/catalogClient";
import { Empty } from "./states";

const ghost =
  "rounded-lg border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

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
        const badge = BADGE[ev.moderation] ?? { cls: "", text: ev.moderation };
        const isLive = ev.moderation === "approved" && ev.status === "on_sale";
        return (
          <button
            key={ev.id}
            onClick={() => onOpen(ev)}
            className="w-full rounded-xl border-2 border-beige-kem p-3 text-left transition hover:border-burgundy"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold">{ev.title}</span>
                <span className="ml-2 font-mono text-[10px] text-beige-kem/40">{ev.status}</span>
                <span
                  className={`ml-2 rounded-lg border px-2 py-0.5 font-mono text-[10px] ${badge.cls}`}
                >
                  {badge.text}
                </span>
              </div>
              <span className="font-mono text-[11px] text-beige-kem/45">
                {isLive ? "Đang hiển thị công khai" : "Chưa hiển thị công khai"}
              </span>
            </div>
            {ev.reviewNote && <p className="mt-1 text-[11px] text-burgundy">{ev.reviewNote}</p>}
          </button>
        );
      })}
    </div>
  );
}
