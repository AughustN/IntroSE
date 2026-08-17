/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReportedEvent } from "@shared/admin/types.js";
import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  EmptyState,
  Kpi,
  KpiStrip,
  Notice,
  PANEL,
  Pill,
  ScreenHead,
} from "../adminUi";
import DecisionPanel, { type DecisionOption } from "../DecisionPanel";
import { useAsync } from "../useAsync";

/**
 * The same page, fetched by id and framed with a way back — what the moderation queues open.
 *
 * `ReportDetail` renders `EventBody` inside a report it has already loaded, so it wants the body
 * alone. The queues have only a row id, so they want the fetch too. One component each rather than
 * one with a nullable prop, because "which of my two inputs is set" is not a question a screen
 * should have to ask itself.
 *
 * The decision sits at the bottom, under the evidence — the order the work happens in. Which
 * decisions are offered comes from the event's own moderation state rather than from whichever
 * queue opened the page: an event waiting for review can be approved or refused, one already live
 * can be flagged or taken down, and one already removed is finished with.
 */
export function EventPreviewScreen({
  eventId,
  onBack,
  onDecided,
}: {
  eventId: number;
  onBack: () => void;
  /** Called after a decision lands, so the queue behind this page reloads rather than lying. */
  onDecided: () => void;
}) {
  const { data, error, loading } = useAsync(
    () => adminClient.eventDetail(eventId),
    `event-${eventId}`,
  );

  /*
   * What may be done to this event, from what it currently is.
   *
   * Driven by `moderationStatus` rather than by which queue opened the page, and — since the state
   * machine refuses anything else — nothing here is offered that the server would answer with a 409.
   * The list screens used to show "Gắn cờ" on an already-flagged event, which could only ever fail.
   */
  const APPROVE: DecisionOption | null = !data
    ? null
    : {
        id: "approve",
        label: data.moderationStatus === "flagged" ? "Duyệt lại" : "Duyệt",
        effect:
          data.moderationStatus === "flagged"
            ? "Gỡ cờ và cho sự kiện hiển thị lại trên trang công khai. Vé được bán tiếp."
            : "Sự kiện được công khai và bắt đầu bán vé theo các suất đã đặt.",
        reason: "none",
        primary: true,
        run: () => adminClient.approveEvent(data.eventId),
      };

  const REMOVE: DecisionOption | null = !data
    ? null
    : {
        id: "remove",
        label: "Gỡ",
        effect:
          "Gỡ vì vi phạm là quyết định cuối: huỷ các suất tương lai, void vé chưa sử dụng và hoàn tiền vào ví người mua.",
        reason: "required",
        run: (reason) => adminClient.removeEvent(data.eventId, reason),
      };

  const decisions: DecisionOption[] = !data
    ? []
    : data.moderationStatus === "pending_review"
      ? [
          APPROVE!,
          {
            id: "reject",
            label: "Từ chối",
            effect:
              "Sự kiện bị trả lại và không lên trang công khai. Ban tổ chức đọc được lý do và có thể sửa rồi nộp lại.",
            reason: "required",
            run: (reason) => adminClient.rejectEvent(data.eventId, reason),
          },
        ]
      : data.moderationStatus === "approved"
        ? [
            { ...REMOVE!, primary: true },
            {
              id: "flag",
              label: "Gắn cờ",
              effect:
                "Sự kiện bị ẩn khỏi trang công khai để xem xét thêm. Vé ngừng bán ngay. Có thể duyệt lại sau.",
              reason: "optional",
              run: (reason) => adminClient.flagEvent(data.eventId, reason || undefined),
            },
          ]
        : data.moderationStatus === "flagged"
          ? // Flagged is a pause: the way out is back to approved, or all the way to removed.
            [APPROVE!, REMOVE!]
          : // `removed` is terminal — the tickets are already refunded.
            [];

  return (
    <>
      <ScreenHead
        title="Xem trước sự kiện"
        meta={data ? `#${data.eventId} · /${data.slug}` : "Đang tải…"}
        actions={
          <button className={ACTION_GHOST} onClick={onBack}>
            <span aria-hidden="true">&lt;</span> Về danh sách
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {!data && <EmptyState text={loading ? "Đang tải sự kiện…" : "Không có dữ liệu."} />}
      {data && (
        <>
          <EventBody event={data} />
          <DecisionPanel options={decisions} onDecided={onDecided} />
        </>
      )}
    </>
  );
}

/**
 * One event, read-only: everything a reader sees, minus everything that sells.
 *
 * Lifted out of `ReportDetail`, which had it inline, when the three moderation queues needed the
 * same page. Deciding whether an event should go live cannot be done from a table cell — the
 * question is what the event *says*, and the row only carries its title.
 *
 * No ticket steppers, no seat map, no "sự kiện tương tự": an admin here is judging content, and a
 * buy button on a page about taking that content down is a button nobody should have.
 */
export default function EventBody({ event }: { event: ReportedEvent }) {
  const price =
    event.priceFrom === null
      ? "Chưa có hạng vé"
      : event.priceFrom === event.priceTo
        ? formatVnd(event.priceFrom)
        : `${formatVnd(event.priceFrom)} – ${formatVnd(event.priceTo ?? event.priceFrom)}`;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        {event.imageUrl ? (
          <img
            src={event.imageUrl}
            alt={event.title}
            referrerPolicy="no-referrer"
            className="h-[320px] w-full border border-beige-kem/25 object-cover md:h-[340px]"
          />
        ) : (
          <div className="grid h-[320px] place-items-center border border-dashed border-beige-kem/30 font-meta text-meta text-ink-soft">
            Không có ảnh bìa
          </div>
        )}

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={event.moderationStatus === "approved" ? "neutral" : "warn"}>
              {event.moderationStatus}
            </Pill>
            <Pill tone="neutral">{event.status}</Pill>
            <Pill tone="neutral">{event.category}</Pill>
            <Pill tone="neutral">{event.ageRestriction}</Pill>
          </div>
          <h3 className="font-display text-title-m font-black uppercase tracking-[0.03em] text-beige-kem">
            {event.title}
          </h3>
          <p className="font-meta text-meta text-ink-soft">
            {event.organizer} · /{event.slug} · tạo ngày {event.createdAt.slice(0, 10)}
          </p>
          <p className="whitespace-pre-line text-body leading-7 text-beige-kem">
            {event.description}
          </p>
          {event.reviewNote && (
            <p className="border-l-2 border-cam-dat bg-cam-dat/15 px-4 py-3 font-meta text-body text-beige-kem">
              Ghi chú kiểm duyệt trước đó: {event.reviewNote}
            </p>
          )}
        </div>
      </div>

      <KpiStrip>
        <Kpi label="Giá vé" value={price} tone="money" />
        <Kpi label="Vé đã bán" value={`${event.ticketsSold}`} tone="volume" />
        <Kpi label="Số suất diễn" value={`${event.showtimes.length}`} tone="volume" />
        <Kpi
          label="Suất gần nhất"
          tone="rate"
          value={
            event.showtimes[0]
              ? event.showtimes[0].startsAt.slice(0, 10).split("-").reverse().join("/")
              : "—"
          }
        />
      </KpiStrip>

      {event.showtimes.length > 0 && (
        <div className={`${PANEL} space-y-2`}>
          <p className="label-eyebrow text-ink-soft">Suất diễn</p>
          {event.showtimes.map((showtime) => (
            <p key={showtime.id} className="font-meta text-meta text-beige-kem">
              {showtime.startsAt.slice(0, 16).replace("T", " ")} · {showtime.venue}, {showtime.city}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
