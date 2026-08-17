/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import DecisionPanel, { type DecisionOption } from "../DecisionPanel";
import { useAsync } from "../useAsync";

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  suspended: "Đã đình chỉ",
};

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  approved: "good",
  pending: "neutral",
  rejected: "bad",
  suspended: "warn",
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * One organizer, on their own page, for reading before a decision (UC-33).
 *
 * The queue row carries a name and a one-line description — enough to tell two applications apart,
 * not enough to judge either. What actually decides an application is who is behind it and what
 * they have already put on the platform, so this leads with the account and the trading record.
 *
 * The decision sits under the record. What is offered follows the profile's own status: a pending
 * application can be approved or refused, an approved organizer can be suspended, and one already
 * rejected or suspended has nothing left for this screen to do.
 */
export default function OrganizerPreview({
  organizerId,
  onBack,
  onDecided,
}: {
  organizerId: number;
  onBack: () => void;
  /** Called after a decision lands, so the queue behind this page reloads rather than lying. */
  onDecided: () => void;
}) {
  const { data, error, loading } = useAsync(
    () => adminClient.organizerDetail(organizerId),
    `organizer-${organizerId}`,
  );

  const decisions: DecisionOption[] = !data
    ? []
    : data.status === "pending"
      ? [
          {
            id: "approve",
            label: "Duyệt",
            effect: "Ban tổ chức được phép tạo sự kiện và bán vé ngay sau khi duyệt.",
            reason: "none",
            primary: true,
            run: () => adminClient.approveOrganizer(data.id),
          },
          {
            id: "reject",
            label: "Từ chối",
            effect: "Hồ sơ bị từ chối; người nộp đọc được lý do và có thể sửa rồi nộp lại.",
            reason: "required",
            run: (reason) => adminClient.rejectOrganizer(data.id, reason),
          },
        ]
      : data.status === "approved"
        ? [
            {
              id: "suspend",
              label: "Đình chỉ",
              effect:
                "Đình chỉ chặn quyền bán vé ngay lập tức, kể cả với sự kiện đang mở bán — hãy đọc số vé đã bán ở trên trước khi xác nhận.",
              reason: "required",
              primary: true,
              run: (reason) => adminClient.suspendOrganizer(data.id, reason),
            },
          ]
        : [];

  return (
    <>
      <ScreenHead
        title="Hồ sơ ban tổ chức"
        meta={data ? `#${data.id} · nộp ngày ${day(data.appliedAt)}` : "Đang tải…"}
        actions={
          <button className={ACTION_GHOST} onClick={onBack}>
            <span aria-hidden="true">&lt;</span> Về danh sách
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {!data && <EmptyState text={loading ? "Đang tải hồ sơ…" : "Không có dữ liệu."} />}

      {data && (
        <>
          <div className="grid gap-5 md:grid-cols-[200px_1fr]">
            {data.logoUrl ? (
              <img
                src={data.logoUrl}
                alt={data.displayName}
                referrerPolicy="no-referrer"
                className="h-[200px] w-full border border-beige-kem/25 object-cover"
              />
            ) : (
              <div className="grid h-[200px] place-items-center border border-dashed border-beige-kem/30 font-meta text-meta text-ink-soft">
                Không có logo
              </div>
            )}

            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_TONE[data.status] ?? "neutral"}>
                  {STATUS_LABEL[data.status] ?? data.status}
                </Pill>
                {data.approvedAt && <Pill tone="neutral">Duyệt ngày {day(data.approvedAt)}</Pill>}
              </div>
              <h3 className="font-display text-title-m font-black uppercase tracking-[0.03em] text-beige-kem">
                {data.displayName}
              </h3>
              {/* The account, not just the brand: one person may file several applications. */}
              <p className="font-meta text-meta text-ink-soft">
                {data.ownerName ? `${data.ownerName} · ` : ""}
                {data.ownerEmail} · tài khoản từ {day(data.ownerJoinedAt)}
              </p>
              <p className="whitespace-pre-line text-body leading-7 text-beige-kem">
                {data.description || "(hồ sơ không có phần giới thiệu)"}
              </p>
              {data.reviewNote && (
                <p className="border-l-2 border-cam-dat bg-cam-dat/15 px-4 py-3 font-meta text-body text-beige-kem">
                  Ghi chú kiểm duyệt: {data.reviewNote}
                </p>
              )}
            </div>
          </div>

          <KpiStrip>
            <Kpi label="Sự kiện đã tạo" value={`${data.eventCount}`} tone="volume" />
            <Kpi label="Vé đã bán" value={data.ticketsSold.toLocaleString("vi-VN")} tone="volume" />
            <Kpi
              label="Doanh thu vé"
              value={formatVnd(data.revenue)}
              tone="money"
              note="Tiền của ban tổ chức"
            />
            <Kpi label="Số lần nộp hồ sơ" value={`${data.history.length}`} tone="rate" />
          </KpiStrip>

          {/*
            The account's other applications.
            Shown only when there are others: a first-time applicant has no history to read, and a
            one-row table saying so is noise on the page that matters most.
          */}
          {data.history.length > 1 && (
            <div className={`${PANEL} space-y-3`}>
              <p className="label-eyebrow text-ink-soft">
                Lịch sử hồ sơ của tài khoản này · {data.history.length} lần nộp
              </p>
              {data.history.map((entry) => (
                <div
                  key={entry.id}
                  className={`border-b border-beige-kem/15 pb-2 ${
                    entry.id === data.id ? "text-beige-kem" : "text-ink-soft"
                  }`}
                >
                  <p className="font-meta text-meta">
                    {day(entry.appliedAt)} · {STATUS_LABEL[entry.status] ?? entry.status}
                    {entry.id === data.id && " · hồ sơ đang xem"}
                  </p>
                  {entry.reviewNote && (
                    <p className="font-meta text-eyebrow text-ink-soft">“{entry.reviewNote}”</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={`${PANEL} space-y-3`}>
            <p className="label-eyebrow text-ink-soft">
              Sự kiện của ban tổ chức · {data.events.length} gần nhất
            </p>
            {data.events.length === 0 ? (
              <EmptyState text="Ban tổ chức này chưa tạo sự kiện nào." />
            ) : (
              <TableScroll>
                <table className="w-full min-w-[600px] text-left text-meta">
                  <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                    <tr>
                      <Th>Sự kiện</Th>
                      <Th>Trạng thái</Th>
                      <Th>Kiểm duyệt</Th>
                      <Th>Tạo ngày</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={event.id} className="border-b border-beige-kem/15">
                        <Td>
                          <span className="block text-beige-kem">{event.title}</span>
                          <span className="block font-meta text-eyebrow text-ink-soft">
                            /{event.slug}
                          </span>
                        </Td>
                        <Td nowrap>{event.status}</Td>
                        <Td nowrap>
                          <Pill tone={event.moderation === "approved" ? "good" : "warn"}>
                            {event.moderation}
                          </Pill>
                        </Td>
                        <Td nowrap>{day(event.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </div>

          <DecisionPanel options={decisions} onDecided={onDecided} />
        </>
      )}
    </>
  );
}
