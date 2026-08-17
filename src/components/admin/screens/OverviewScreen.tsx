/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  Delta,
  EmptyState,
  Kpi,
  KpiStrip,
  Notice,
  PANEL,
  ROW_LINK,
  ScreenHead,
} from "../adminUi";
import {
  ActiveUsersLineChart,
  CategoryDonutChart,
  RevenueAreaChart,
  RevenueSplitChart,
} from "../AdminCharts";
import { useAsync } from "../useAsync";
import type { ScreenId } from "../AdminConsole";

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
/**
 * One queue's depth, and the way into it.
 *
 * An empty queue is plain text rather than a dead link: there is nothing to go and do, and a control
 * that opens an empty screen is a control that wastes the one press somebody had time for.
 */
function QueueLink({ count, label, onOpen }: { count: number; label: string; onOpen: () => void }) {
  if (count === 0) return <span>0 {label}</span>;
  return (
    <button type="button" className={ROW_LINK} onClick={onOpen}>
      {count} {label}
    </button>
  );
}

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
              tone="money"
              note={<Delta now={data.revenue30d} before={data.revenuePrev30d} />}
            />
            <Kpi
              label="Vé đã bán"
              value={data.ticketsSold30d.toLocaleString("vi-VN")}
              tone="volume"
              note={<Delta now={data.ticketsSold30d} before={data.ticketsSoldPrev30d} />}
            />
            {/*
              Three queues, three destinations.
              The tile used to be one big button that always opened the event queue, so a count made
              entirely of open reports sent the reader to an empty screen. The whole tile is no
              longer the target — each figure in the note is, which is also the only way to keep it
              valid HTML (a button cannot hold three more).
            */}
            <Kpi
              label="Chờ xử lý"
              value={`${data.pendingEvents + data.pendingOrganizers + data.openReports}`}
              tone="rate"
              note={
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <QueueLink
                    count={data.pendingEvents}
                    label="sự kiện"
                    onOpen={() => onOpen("moderation")}
                  />
                  <span aria-hidden="true">·</span>
                  <QueueLink
                    count={data.pendingOrganizers}
                    label="ban tổ chức"
                    onOpen={() => onOpen("organizers")}
                  />
                  <span aria-hidden="true">·</span>
                  <QueueLink
                    count={data.openReports}
                    label="tố cáo"
                    onOpen={() => onOpen("reports")}
                  />
                </span>
              }
            />
            <Kpi
              label="Tỷ lệ check-in"
              value={data.checkedInRate === null ? "—" : `${Math.round(data.checkedInRate * 100)}%`}
              tone="rate"
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
