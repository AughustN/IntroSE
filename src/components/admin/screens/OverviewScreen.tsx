/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import { ACTION_GHOST, EmptyState, Kpi, KpiStrip, Notice, PANEL, ScreenHead } from "../adminUi";
import {
  ActiveUsersLineChart,
  CategoryDonutChart,
  RevenueAreaChart,
  RevenueSplitChart,
} from "../AdminCharts";
import { useAsync } from "../useAsync";
import type { ScreenId } from "../AdminConsole";

/** How much a figure moved against the previous window, in the words a reader uses. */
function delta(now: number, before: number): string {
  if (before === 0) return now === 0 ? "không đổi" : "kỳ trước chưa có";
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return "không đổi";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% so với 30 ngày trước`;
}

/**
 * What is true right now, in the order somebody on shift asks it.
 *
 * Money and volume first, then the queues. Every figure comes from `GET /api/admin/overview`; the
 * screen this replaces summed the viewer's own browser history and called it platform revenue.
 *
 * There is no list of individual waiting items here any more. It restated what the "Chờ xử lý" tile
 * already counts, and each row's only action was to open the queue screen that owns it — which is
 * what the tile itself now does.
 */
export default function OverviewScreen({ onOpen }: { onOpen: (screen: ScreenId) => void }) {
  const { data, error, loading, reload } = useAsync(() => adminClient.overview(), "overview");

  return (
    <>
      <ScreenHead
        title="Bảng tổng quan"
        meta="30 ngày gần nhất"
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
              onClick={() => onOpen("moderation")}
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
              <RevenueAreaChart points={data.revenueByDay} />
            </div>

            <div className={`${PANEL} space-y-4`}>
              <p className="label-eyebrow text-ink-soft">Vé theo danh mục</p>
              <CategoryDonutChart slices={data.ticketsByCategory} />
            </div>
          </div>

          {/*
            Audience and mix, under money and volume: who turned up, and which income stream the
            money came from. Same 2fr/1fr grid, so the two time series line up column-for-column and
            a spike in traffic can be read against the revenue day above it.
          */}
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className={`${PANEL} space-y-3`}>
              <p className="label-eyebrow text-ink-soft">Lượng truy cập · DAU / MAU · 30 ngày</p>
              <ActiveUsersLineChart points={data.activityByDay} />
            </div>

            <div className={`${PANEL} space-y-4`}>
              <p className="label-eyebrow text-ink-soft">Cơ cấu doanh thu</p>
              <RevenueSplitChart
                commission={data.revenue30d - data.adRevenue30d}
                ads={data.adRevenue30d}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
