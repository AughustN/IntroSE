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
  MiniBars,
  Notice,
  PANEL,
  Pill,
  ScreenHead,
  ShareRow,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import { useAsync } from "../useAsync";
import type { ScreenId } from "../AdminConsole";

/** How much a figure moved against the previous window, in the words a reader uses. */
function delta(now: number, before: number): string {
  if (before === 0) return now === 0 ? "không đổi" : "kỳ trước chưa có";
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return "không đổi";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% so với 30 ngày trước`;
}

const WAITING_KIND: Record<string, { label: string; screen: ScreenId }> = {
  event: { label: "Sự kiện", screen: "moderation" },
  organizer: { label: "Ban tổ chức", screen: "organizers" },
  report: { label: "Tố cáo", screen: "reports" },
};

/**
 * What is true right now, in the order somebody on shift asks it.
 *
 * Money and volume first, then the queues, then the individual things waiting. Every figure comes
 * from `GET /api/admin/overview`; the screen this replaces summed the viewer's own browser history
 * and called it platform revenue.
 */
export default function OverviewScreen({ onOpen }: { onOpen: (screen: ScreenId) => void }) {
  const { data, error, loading, reload } = useAsync(() => adminClient.overview(), "overview");

  const categoryTotal = data?.ticketsByCategory.reduce((sum, row) => sum + row.tickets, 0) ?? 0;

  return (
    <>
      <ScreenHead
        title="Bảng tổng quan"
        meta="30 ngày gần nhất · số liệu tổng hợp trên máy chủ"
        actions={
          <button onClick={reload} className={ACTION_GHOST} disabled={loading}>
            {loading ? "Đang tải…" : "Tải lại"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {!data && loading && <EmptyState text="Đang tải số liệu…" />}

      {data && (
        <>
          <KpiStrip>
            <Kpi
              label="Doanh thu 30 ngày"
              value={formatVnd(data.revenue30d)}
              note={delta(data.revenue30d, data.revenuePrev30d)}
            />
            <Kpi
              label="Vé đã bán"
              value={data.ticketsSold30d.toLocaleString("vi-VN")}
              note={delta(data.ticketsSold30d, data.ticketsSoldPrev30d)}
            />
            <Kpi
              label="Chờ xử lý"
              value={`${data.pendingEvents + data.pendingOrganizers + data.openReports}`}
              note={`${data.pendingEvents} sự kiện · ${data.pendingOrganizers} ban tổ chức · ${data.openReports} tố cáo`}
            />
            <Kpi
              label="Tỷ lệ check-in"
              value={data.checkedInRate === null ? "—" : `${Math.round(data.checkedInRate * 100)}%`}
              note={
                data.checkedInRate === null
                  ? "Chưa có suất diễn nào đã bắt đầu"
                  : `${data.liveEvents} sự kiện đang mở bán`
              }
            />
          </KpiStrip>

          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className={`${PANEL} space-y-3`}>
              <p className="label-eyebrow text-ink-soft">Doanh thu theo ngày · 30 ngày</p>
              <MiniBars points={data.revenueByDay} format={formatVnd} />
              <p className="font-meta text-body text-ink-soft">
                Cột cao nhất là ngày bán tốt nhất trong kỳ. Rê chuột để xem con số từng ngày.
              </p>
            </div>

            <div className={`${PANEL} space-y-4`}>
              <p className="label-eyebrow text-ink-soft">Vé theo danh mục</p>
              {data.ticketsByCategory.length === 0 ? (
                <EmptyState text="Chưa bán được vé nào trong 30 ngày." />
              ) : (
                data.ticketsByCategory
                  .slice(0, 5)
                  .map((row) => (
                    <ShareRow
                      key={row.code}
                      label={row.label}
                      value={row.tickets}
                      total={categoryTotal}
                      format={(value) => `${value} vé`}
                    />
                  ))
              )}
            </div>
          </div>

          <div className={`${PANEL} space-y-3`}>
            <p className="label-eyebrow text-ink-soft">Cần xử lý · chờ lâu nhất trước</p>
            {data.attention.length === 0 ? (
              <EmptyState text="Không còn gì đang chờ duyệt." />
            ) : (
              <TableScroll>
                <table className="w-full min-w-[560px] text-left text-body">
                  <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                    <tr>
                      <Th>Nội dung</Th>
                      <Th>Loại</Th>
                      <Th>Đã chờ</Th>
                      <Th>&nbsp;</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attention.map((item) => {
                      const kind = WAITING_KIND[item.kind];
                      // Two days is the point at which an organizer writes in to ask.
                      const overdue = item.waitingHours >= 48;
                      return (
                        <tr
                          key={`${item.kind}-${item.id}`}
                          className="border-b border-beige-kem/15"
                        >
                          <Td>{item.title}</Td>
                          <Td nowrap>{kind?.label ?? item.kind}</Td>
                          <Td nowrap>
                            <Pill tone={overdue ? "bad" : "neutral"}>
                              {item.waitingHours < 24
                                ? `${item.waitingHours} giờ`
                                : `${Math.floor(item.waitingHours / 24)} ngày`}
                            </Pill>
                          </Td>
                          <Td nowrap>
                            <button
                              className={ACTION_GHOST}
                              onClick={() => kind && onOpen(kind.screen)}
                            >
                              Mở
                            </button>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </div>
        </>
      )}
    </>
  );
}
