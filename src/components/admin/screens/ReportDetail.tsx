/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ReportedEvent, ReportedReview } from "@shared/admin/types.js";
import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  ACTION_PRIMARY,
  EmptyState,
  FIELD,
  Kpi,
  KpiStrip,
  Notice,
  PANEL,
  Pill,
  ScreenHead,
} from "../adminUi";
import { useAsync } from "../useAsync";

type Decision = "flag" | "remove" | "dismiss";

const DECISION_LABEL: Record<Decision, string> = {
  flag: "Gắn cờ",
  remove: "Gỡ nội dung",
  dismiss: "Bỏ qua",
};

const DECISION_EFFECT: Record<Decision, string> = {
  flag: "Sự kiện bị ẩn khỏi trang công khai để xem xét thêm. Vé ngừng bán ngay. Có thể duyệt lại sau.",
  remove:
    "Gỡ vì vi phạm là quyết định cuối: huỷ các suất tương lai, void vé chưa sử dụng và hoàn tiền vào ví người mua.",
  dismiss: "Nội dung giữ nguyên. Tố cáo đóng lại và không hiện trong hàng chờ nữa.",
};

/**
 * One report, on its own page.
 *
 * Deciding whether an event should come down cannot be done from a table cell: the question is what
 * the event *says*, and the row only carries its title. So this is the event as a reader sees it —
 * poster, description, showtimes, price — with everything that sells removed. No ticket steppers,
 * no seat map, no "sự kiện tương tự": an admin here is judging content, and a buy button on a page
 * about taking that content down is a button nobody should have.
 *
 * The reason sits under the event rather than above it, which is the order the work happens in:
 * read the thing, then read the complaint about it.
 */
export default function ReportDetail({
  reportId,
  onBack,
  onDecided,
}: {
  reportId: number;
  onBack: () => void;
  onDecided: () => void;
}) {
  const { data, error, loading, reload } = useAsync(
    () => adminClient.contentReport(reportId),
    String(reportId),
  );
  const [pending, setPending] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    if (!pending) return;
    const text = reason.trim();
    if (pending !== "dismiss" && !text) {
      setFailure("Cần lý do — ban tổ chức đọc dòng này, và nhật ký thao tác lưu lại nó.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (pending === "dismiss") await adminClient.dismissReport(reportId, text || undefined);
      else await adminClient.resolveReport(reportId, pending, text);
      onDecided();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Không xử lý được tố cáo này.");
      setBusy(false);
    }
  };

  const open = data?.status === "open";

  return (
    <>
      <ScreenHead
        title="Tố cáo nội dung"
        meta={data ? `Tố cáo #${data.id} · ${data.createdAt.slice(0, 10)}` : "Đang tải…"}
        actions={
          <button className={ACTION_GHOST} onClick={onBack}>
            <span aria-hidden="true">&lt;</span> Về danh sách
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {!data && <EmptyState text={loading ? "Đang tải tố cáo…" : "Không có dữ liệu."} />}

      {data && (
        <>
          {data.target.kind === "event" ? (
            <EventBody event={data.target} />
          ) : (
            <ReviewBody review={data.target} />
          )}

          {/* The complaint itself, under the thing it is about. */}
          <div className={`${PANEL} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-eyebrow text-ink-soft">Lý do tố cáo</p>
              <Pill tone={open ? "warn" : "neutral"}>
                {open ? "Chưa xử lý" : `Đã xử lý · ${data.status}`}
              </Pill>
            </div>
            <p className="text-body leading-7 text-beige-kem">“{data.reason}”</p>
            <p className="font-meta text-meta text-ink-soft">
              {data.reporterEmail} · gửi ngày {data.createdAt.slice(0, 10)}
            </p>
            {data.resolutionNote && (
              <p className="border-l-2 border-la-co bg-la-co/10 px-4 py-3 font-meta text-body text-beige-kem">
                Ghi chú xử lý: {data.resolutionNote}
              </p>
            )}

            {data.otherReports.length > 0 && (
              <div className="space-y-2 border-t border-beige-kem/25 pt-4">
                <p className="label-eyebrow text-ink-soft">
                  {data.otherReports.length} tố cáo khác về cùng nội dung này
                </p>
                {data.otherReports.map((other) => (
                  <div key={other.id} className="border-b border-beige-kem/15 pb-2">
                    <p className="text-body text-beige-kem">“{other.reason}”</p>
                    <p className="font-meta text-meta text-ink-soft">
                      {other.reporterEmail} · {other.createdAt.slice(0, 10)} · {other.status}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {open && (
            <div className={`${PANEL} space-y-3`}>
              <p className="label-eyebrow text-ink-soft">Quyết định</p>
              {pending ? (
                <>
                  <p className="font-meta text-body text-ink-soft">{DECISION_EFFECT[pending]}</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      autoFocus
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={
                        pending === "dismiss" ? "Ghi chú (không bắt buộc)" : "Lý do (bắt buộc)"
                      }
                      className={`${FIELD} min-w-[280px] flex-1`}
                    />
                    <button className={ACTION_PRIMARY} onClick={submit} disabled={busy}>
                      {busy ? "Đang gửi…" : `Xác nhận ${DECISION_LABEL[pending].toLowerCase()}`}
                    </button>
                    <button
                      className={ACTION_GHOST}
                      onClick={() => {
                        setPending(null);
                        setReason("");
                        setFailure(null);
                      }}
                    >
                      Huỷ
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(["remove", "flag", "dismiss"] as Decision[]).map((decision) => (
                    <button
                      key={decision}
                      className={decision === "remove" ? ACTION_PRIMARY : ACTION_GHOST}
                      onClick={() => {
                        setPending(decision);
                        setReason("");
                        setFailure(null);
                      }}
                    >
                      {DECISION_LABEL[decision]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!open && (
            <button className={ACTION_GHOST} onClick={reload}>
              Tải lại
            </button>
          )}
        </>
      )}
    </>
  );
}

/** The event, read-only: everything a reader sees, minus everything that sells. */
function EventBody({ event }: { event: ReportedEvent }) {
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
          <div className="grid h-[320px] place-items-center border border-dashed border-beige-kem/30 font-meta text-body text-ink-soft">
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
          <p className="font-meta text-body text-ink-soft">
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
        <Kpi label="Giá vé" value={price} />
        <Kpi label="Vé đã bán" value={`${event.ticketsSold}`} />
        <Kpi label="Số suất diễn" value={`${event.showtimes.length}`} />
        <Kpi
          label="Suất gần nhất"
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
            <p key={showtime.id} className="font-meta text-body text-beige-kem">
              {showtime.startsAt.slice(0, 16).replace("T", " ")} · {showtime.venue}, {showtime.city}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The same page for a reported comment, so one route serves both kinds of report. */
function ReviewBody({ review }: { review: ReportedReview }) {
  return (
    <div className={`${PANEL} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={review.status === "removed" ? "warn" : "neutral"}>
          {review.status === "removed" ? "Đã ẩn" : "Đang hiển thị"}
        </Pill>
        <Pill tone="neutral">{review.rating}★</Pill>
      </div>
      <p className="text-body leading-7 text-beige-kem">
        {review.body ? `“${review.body}”` : "(chỉ chấm sao, không có lời)"}
      </p>
      <p className="font-meta text-meta text-ink-soft">
        {review.authorName ?? "Tài khoản đã xoá"} · {review.createdAt.slice(0, 10)} · dưới sự kiện{" "}
        {review.eventTitle}
      </p>
    </div>
  );
}
