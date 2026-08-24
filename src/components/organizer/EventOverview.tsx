/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import type { EventDetail } from "@/shared/catalog/types";
import type { MyEvent } from "../../services/catalogClient";
import { organizerApi } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import { formatShowtimeAt } from "../../services/formatDate";

/** `events.age_restriction`'s raw codes (`catalogAdapter.ts` carries the same map), in Vietnamese
 *  rather than the enum an organizer never chose to type. */
const AGE_LABEL: Record<string, string> = {
  all: "Mọi lứa tuổi",
  "13+": "13 tuổi trở lên",
  "16+": "16 tuổi trở lên",
  "18+": "18 tuổi trở lên",
};

/**
 * The read-only face of one event — what management shows FIRST when an event is opened.
 *
 * The old console dropped every click straight into the editor, which said "this row is a form".
 * It is not: mostly an organizer opens an event to REMEMBER things — when, where, for how much,
 * and whether it is selling — and only sometimes to change them. So information leads here, and
 * editing is one deliberate press away (`onEdit` → the existing editor, whose publish gates are
 * untouched). The owner-side preview endpoint feeds it, which is also why a draft renders here as
 * fully as a live one does.
 */
export default function EventOverview({
  event,
  onEdit,
  onBack,
}: {
  event: MyEvent;
  onEdit: () => void;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(() => {
    organizerApi
      .preview(event.id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [event.id]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  /*
   * Same vocabulary EventList badges with — one status, one word, everywhere.
   *
   * `event.status === "draft"` is checked ahead of `moderation`, same reason `EventList`'s
   * `DRAFT_BADGE` is: `events.moderation_status` defaults to `pending_review` for every row, draft
   * or not, so without this an untouched draft read "Chờ duyệt" here — the one place an organizer
   * would go looking to find out whether they had actually submitted it.
   */
  const cancelled = event.status === "cancelled";
  /*
   * Marks match `EventList`'s for the states the two share, so one event reads the same on both
   * screens. The tints here already measured 6.0–8.4:1 and are left alone — the contrast defect was
   * on the LIST, whose badges filled with the saturated hue instead of a tint of it.
   */
  const badge = cancelled
    ? { cls: "border-burgundy/60 bg-burgundy/25 text-beige-kem", text: "Đã hủy" }
    : event.status === "finished"
      ? { cls: "border-beige-kem/30 text-ink-soft", text: "Đã kết thúc" }
      : event.status === "draft"
        ? {
            cls: "border-beige-kem/35 bg-transparent text-beige-kem/75",
            text: "Bản nháp",
            mark: "○",
          }
        : event.moderation === "approved"
          ? { cls: "border-la-co/60 bg-la-co/25 text-beige-kem", text: "Đang bán" }
          : event.moderation === "pending_review"
            ? {
                cls: "border-cam-dat/60 bg-cam-dat/20 text-beige-kem",
                text: "Chờ duyệt",
                mark: "◐",
              }
            : { cls: "border-burgundy/50 bg-burgundy/10 text-beige-kem", text: "Bị gỡ" };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Borderless, like the booking flow's back link (`BookingHeader`) — an arrow and a label
            rather than a boxed button, since this is navigation, not an action taken on the page. */}
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-bold text-beige-kem/70 transition-colors hover:text-beige-kem"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Danh sách sự kiện
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={cancelled}
          title={cancelled ? "Sự kiện đã hủy không thể chỉnh sửa." : undefined}
          className="inline-flex items-center gap-1.5 bg-burgundy px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" />
          Chỉnh sửa
        </button>
      </div>

      <article className="overflow-hidden border border-beige-kem/25 bg-surface-2 p-5">
        {/*
          Information on the left, artwork on the right — the image is the one element here that
          is not a fact to read, so it gets its own column instead of sitting in the reading order
          between the title and the numbers that matter more to an organizer checking on an event.
        */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-black text-beige-kem">{event.title}</h2>
                <span
                  className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-meta font-bold leading-none ${badge.cls}`}
                >
                  <span aria-hidden="true">{badge.mark}</span>
                  {badge.text}
                </span>
              </div>

              <p className="font-mono text-sm text-ink-soft">
                {[detail?.categoryLabel, detail?.city].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>

            {/*
              The four facts an organizer opens an event to check, in the same stat shape the
              dashboard's own "Doanh thu / Vé đã bán / Sự kiện đang mở bán" row uses
              (`OrganizerEventsPage`) — a fixed 2×2 rather than the dashboard's 4-across, because
              this column now shares the row with the image instead of spanning the whole card.
              Tinted, not bordered: the article around all four is already one frame, and outlining
              each cell inside it stacked a border-2 grid inside a border — the fill against the
              article's own `surface-2` reads as four blocks without needing an edge drawn on each.
            */}
            <dl className="grid grid-cols-2 gap-3">
              {[
                { label: "Doanh thu", value: formatVnd(event.totalRevenueVnd) },
                {
                  label: "Vé đã bán",
                  value:
                    event.totalCapacity > 0
                      ? `${event.soldTickets.toLocaleString("vi-VN")}/${event.totalCapacity.toLocaleString("vi-VN")}`
                      : String(event.soldTickets),
                },
                {
                  label: "Suất diễn tiếp theo",
                  value: event.nextShowtimeAt ? formatShowtimeAt(event.nextShowtimeAt) : "Chưa có",
                },
                { label: "Địa điểm", value: event.venueName ?? "Chưa gán" },
              ].map((k) => (
                <div key={k.label} className="bg-xanh-pho p-3">
                  <dt className="font-meta text-[11px] uppercase tracking-widest text-ink-soft">
                    {k.label}
                  </dt>
                  <dd className="mt-1 truncate font-display text-base font-black tabular-nums text-beige-kem">
                    {k.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {detail?.imageUrl && (
            <img
              src={detail.imageUrl}
              alt=""
              className="aspect-video w-full object-cover lg:h-full"
            />
          )}
        </div>

        {/* Everything below is about the event rather than the at-a-glance facts above it — the
            description, then its supporting details, as one column under both. */}
        <div className="mt-5 space-y-3 border-t border-beige-kem/20 pt-5">
          {error ? (
            <p className="border border-burgundy/50 bg-burgundy/10 px-3 py-2 text-sm text-beige-kem">
              {error}
            </p>
          ) : detail === null ? (
            <p className="text-sm text-ink-soft">Đang tải nội dung…</p>
          ) : (
            <>
              <p className="whitespace-pre-line text-sm leading-relaxed text-beige-kem">
                {detail.description || "Chưa có mô tả."}
              </p>

              {/* What a ticket costs, straight off the same read buyers will get. */}
              {detail.tiers.length > 0 && (
                <div>
                  <p className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-ink-soft">
                    Giá vé
                  </p>
                  <ul className="divide-y divide-beige-kem/15 border border-beige-kem/20">
                    {detail.tiers.map((t) => (
                      <li key={t.id} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm font-semibold text-beige-kem">{t.label}</span>
                        <span className="font-mono text-sm tabular-nums text-beige-kem/80">
                          {formatVnd(t.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
                Everything else a complete overview owes an organizer: who is on the bill, what age
                it is rated for, how buyers can reach the place, what the refund promise says. Same
                label-left/value-right row the buyer-facing detail page uses (`EventDetail.tsx`) —
                one hairline per fact, in a balanced two-column grid — so a field that has no value
                drops out rather than printing an empty row.
              */}
              <dl className="grid gap-x-8 gap-y-3 border-t border-beige-kem/20 pt-3 sm:grid-cols-2">
                {[
                  ["Đơn vị / nghệ sĩ", detail.lineup.join(", ")],
                  ["Thể loại", detail.genre.join(", ")],
                  ["Độ tuổi", AGE_LABEL[detail.ageRestriction] ?? detail.ageRestriction],
                  [
                    "Đánh giá",
                    detail.rating !== null
                      ? `${detail.rating.toFixed(1)}/5 · ${detail.reviewCount} lượt`
                      : "",
                  ],
                  ["Hoàn / đổi vé", detail.refundPolicy ?? ""],
                  ["Hướng dẫn đến nơi", detail.venueGuide ?? ""],
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="flex gap-3 border-b border-beige-kem/15 pb-2">
                      <dt className="w-32 shrink-0 font-mono text-xs text-ink-soft">{label}</dt>
                      <dd className="min-w-0 flex-1 text-sm text-beige-kem">{value}</dd>
                    </div>
                  ))}
              </dl>
            </>
          )}

          {event.reviewNote && <p className="text-sm text-burgundy">{event.reviewNote}</p>}
        </div>
      </article>
    </div>
  );
}
