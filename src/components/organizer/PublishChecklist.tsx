/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { MyEvent, organizerApi, type ManageShowtime } from "../../services/catalogClient";

/**
 * What stands between an event and the public catalog (Phase 4 / first-run checklist).
 *
 * The server's publish gate is a single SQL fact — "≥1 upcoming showtime with ≥1 tier"
 * (`publishEvent`, needs_showtime_and_tier) — and an organizer who hits that 409 with no idea why
 * has no map of the map either. This panel states the same fact in advance, item by item, and adds
 * the one requirement the gate cannot express: a seated event whose showtimes have no map applied
 * sells nothing, so it belongs on the list even though the SQL does not look for it.
 *
 * Read-only on purpose: every item links to where it is FIXED (the showtime list, the seat-map
 * designer), rather than offering its own forms — the checklist tells you what, the tools do it.
 */

type Check = { done: boolean; label: string; hint: string };

export default function PublishChecklist({
  event,
  onOpenSeatMap,
}: {
  event: MyEvent;
  onOpenSeatMap: (eventId: number) => void;
}) {
  const [rows, setRows] = useState<ManageShowtime[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    organizerApi
      .showtimesManage(event.id)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        // The checklist is advisory: a fetch failure leaves it saying "loading", and the editor's
        // own publish button remains the source of truth.
      });
    return () => {
      alive = false;
    };
  }, [event.id]);

  if (dismissed) return null;

  // The event is live — the checklist is complete by definition, and the header already says so.
  const isLive = event.moderation === "approved" && event.status === "on_sale";

  const upcoming = (rows ?? []).filter((s) => new Date(s.startsAt) > new Date());
  const withTiers = upcoming.filter((s) => s.tiers.some((t) => !t.archived));
  const seatedMapped = upcoming.filter((s) => s.hasSeatMap);

  const checks: Check[] = [
    {
      done: upcoming.length > 0,
      label: `Có suất chiếu sắp diễn (${upcoming.length})`,
      hint: "Thêm suất chiếu ở danh sách bên dưới — suất đã qua không tính.",
    },
    {
      done: upcoming.length > 0 && withTiers.length === upcoming.length,
      label: `Mỗi suất có hạng vé đang hoạt động (${withTiers.length}/${upcoming.length})`,
      hint: "Mở suất chiếu và thêm ít nhất một hạng vé đang hoạt động cho suất đó.",
    },
    ...(event.eventType === "seated"
      ? [
          {
            done: upcoming.length > 0 && seatedMapped.length === upcoming.length,
            label: `Sơ đồ ghế đã áp cho mọi suất (${seatedMapped.length}/${upcoming.length})`,
            hint: "Bấm “Sơ đồ ghế” trên thanh tiêu đề, thiết kế sơ đồ rồi áp cho từng suất.",
          },
        ]
      : []),
  ];

  const remaining = checks.filter((c) => !c.done).length;

  return (
    <div className="border-2 border-beige-kem bg-surface-2 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold">
          {isLive ? "Đã sẵn sàng bán" : "Những gì còn thiếu để được duyệt & hiển thị"}
        </h3>
        <button
          onClick={() => setDismissed(true)}
          className="font-meta text-meta text-beige-kem/50 transition hover:text-beige-kem"
          aria-label="Ẩn bảng kiểm tra"
        >
          Ẩn
        </button>
      </div>

      {rows === null ? (
        <p className="mt-2 font-meta text-meta text-beige-kem/55">Đang kiểm tra…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border-2 text-[10px] font-black ${
                  c.done ? "border-la-co bg-la-co text-on-tint" : "border-cam-dat text-transparent"
                }`}
              >
                ✓
              </span>
              <div>
                <p className={`text-eyebrow ${c.done ? "text-la-co" : "text-beige-kem"}`}>
                  {c.label}
                </p>
                {!c.done && <p className="font-meta text-meta text-beige-kem/60">{c.hint}</p>}
                {!c.done && c.label.startsWith("Sơ đồ ghế") && (
                  <button
                    onClick={() => onOpenSeatMap(event.id)}
                    className="mt-1 font-meta text-meta font-bold text-burgundy underline"
                  >
                    Mở trình thiết kế sơ đồ →
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {remaining === 0 && !isLive && (
        <p className="mt-3 font-meta text-meta text-la-co">
          Đủ điều kiện — bấm “Gửi duyệt” để quản trị viên phê duyệt và hiển thị công khai.
        </p>
      )}
    </div>
  );
}
