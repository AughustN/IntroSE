/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
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
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import Select from "../../Select";
import { useAsync } from "../useAsync";

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "neutral" }> = {
  checked_in: { label: "Đã vào", tone: "good" },
  valid: { label: "Chưa vào", tone: "neutral" },
  void: { label: "Đã huỷ", tone: "warn" },
};

/**
 * The door list (UC-29).
 *
 * The event is chosen from the events that have actually sold something in the last 90 days, which
 * is the only kind that has attendees — a dropdown of the whole catalogue would be mostly rows that
 * lead to an empty table.
 */
export default function AttendeesScreen() {
  const [eventId, setEventId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const sellers = useAsync(
    () =>
      adminClient.analytics({
        from: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
      }),
    "sellers",
  );
  const list = useAsync(
    () => (eventId === null ? Promise.resolve(null) : adminClient.attendees(eventId)),
    String(eventId ?? "none"),
  );

  const eventOptions = (sellers.data?.rows ?? []).map((row) => ({
    value: String(row.eventId),
    label: `${row.eventTitle} · ${row.tickets} vé`,
  }));

  const download = async () => {
    if (eventId === null) return;
    setDownloading(true);
    setFailure(null);
    try {
      const blob = await adminClient.attendeesCsv(eventId);
      // The file is fetched with the session's credentials, so it arrives as bytes rather than as a
      // URL: an anchor pointed at the endpoint would send no Authorization header and save a 401.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `khach-tham-du-${eventId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Không tải được tệp.");
    } finally {
      setDownloading(false);
    }
  };

  const data = list.data;

  return (
    <>
      <ScreenHead
        title="Khách tham dự"
        meta={data ? data.eventTitle : "Chọn một sự kiện để xem danh sách"}
        actions={
          data && (
            <button className={ACTION_PRIMARY} onClick={download} disabled={downloading}>
              {downloading ? "Đang tạo tệp…" : "Xuất CSV"}
            </button>
          )
        }
      />

      <div className={`${PANEL} flex flex-wrap items-end gap-3`}>
        <div className="min-w-[280px] flex-1">
          <Select
            label="Sự kiện có vé bán ra · 90 ngày"
            value={eventId === null ? "" : String(eventId)}
            options={eventOptions}
            placeholder="— Chọn sự kiện —"
            onChange={(value) => setEventId(value ? Number(value) : null)}
            triggerClassName={`${FIELD} w-full justify-between`}
          />
        </div>
        <button className={ACTION_GHOST} onClick={() => list.reload()} disabled={eventId === null}>
          Tải lại
        </button>
      </div>

      {sellers.error && <Notice tone="error">{sellers.error}</Notice>}
      {list.error && <Notice tone="error">{list.error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      {eventId === null ? (
        <EmptyState text="Chưa chọn sự kiện nào." />
      ) : !data ? (
        <EmptyState text={list.loading ? "Đang tải danh sách…" : "Không có dữ liệu."} />
      ) : (
        <>
          <KpiStrip>
            <Kpi label="Tổng vé" value={`${data.counts.total}`} />
            <Kpi label="Đã vào" value={`${data.counts.checkedIn}`} />
            <Kpi
              label="Tỷ lệ vào cửa"
              value={
                data.counts.total === 0
                  ? "—"
                  : `${Math.round((data.counts.checkedIn / data.counts.total) * 100)}%`
              }
            />
            <Kpi label="Vé đã huỷ" value={`${data.counts.void}`} />
          </KpiStrip>

          {data.rows.length === 0 ? (
            <EmptyState text="Sự kiện này chưa có vé nào được thanh toán." />
          ) : (
            <TableScroll>
              <table className="w-full min-w-[820px] text-left text-body">
                <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                  <tr>
                    <Th>Khách</Th>
                    <Th>Mã đơn</Th>
                    <Th>Hạng vé</Th>
                    <Th>Ghế</Th>
                    <Th>Trạng thái</Th>
                    <Th>Giờ vào</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.ticketId} className="border-b border-beige-kem/15">
                      <Td>
                        <span className="block text-beige-kem">{row.buyerName}</span>
                        <span className="block font-meta text-meta text-ink-soft">
                          {row.buyerEmail}
                        </span>
                      </Td>
                      <Td nowrap>
                        <span className="font-meta">{row.orderCode}</span>
                      </Td>
                      <Td nowrap>{row.tier}</Td>
                      <Td nowrap>{row.seat ?? "—"}</Td>
                      <Td nowrap>
                        <Pill tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Pill>
                      </Td>
                      <Td nowrap>{row.checkedInAt ? row.checkedInAt.slice(11, 16) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </>
      )}
    </>
  );
}
