/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AD_PLACEMENT_LABELS } from "@shared/ads/types.js";
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
import { PackageSalesChart, RevenueAreaChart } from "../AdminCharts";
import { useAsync } from "../useAsync";

/** How much a figure moved against the previous window, in the words a reader uses. */
function delta(now: number, before: number): string {
  if (before === 0) return now === 0 ? "không đổi" : "kỳ trước chưa có";
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return "không đổi";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% so với 30 ngày trước`;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("vi-VN");

/**
 * What advertising earns, and what is running because of it (the ad half of UC-32).
 *
 * The overview folds this money into one headline figure because that is what the platform earned;
 * this screen is where it is broken out, since "are the packages selling" and "is the site taking
 * money overall" are different questions and the second one hides the first.
 *
 * Ad revenue is counted WHOLE, not at 5%: a package is sold by the site rather than through it, so
 * there is no organizer to split it with.
 */
export default function AdsScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.ads(), "ads");

  return (
    <>
      <ScreenHead
        title="Quảng cáo"
        meta="30 ngày gần nhất · doanh thu gói quảng cáo bán cho ban tổ chức"
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
              label="Doanh thu quảng cáo 30 ngày"
              value={formatVnd(data.revenue30d)}
              note={delta(data.revenue30d, data.revenuePrev30d)}
            />
            <Kpi
              label="Gói đã bán"
              value={data.purchases30d.toLocaleString("vi-VN")}
              note="Trong 30 ngày gần nhất"
            />
            <Kpi
              label="Chiến dịch đang chạy"
              value={data.liveCampaigns.toLocaleString("vi-VN")}
              note="Đang hiển thị trên trang chủ"
            />
            <Kpi
              label="Giá trị trung bình"
              value={
                data.purchases30d === 0
                  ? "—"
                  : formatVnd(Math.round(data.revenue30d / data.purchases30d))
              }
              note="Mỗi gói bán ra"
            />
          </KpiStrip>

          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className={`${PANEL} space-y-3`}>
              <p className="label-eyebrow text-ink-soft">Doanh thu quảng cáo theo tuần · 12 tuần</p>
              {/* The KPIs above are a 30-day window; this series is longer and coarser on purpose,
                  because a handful of big packages a month has no daily shape to plot. */}
              <RevenueAreaChart
                points={data.byWeek.map((week) => ({
                  day: week.weekStart,
                  endDay: week.weekEnd,
                  amount: week.amount,
                }))}
                label="Quảng cáo"
              />
            </div>

            <div className={`${PANEL} space-y-3`}>
              <p className="label-eyebrow text-ink-soft">Theo gói</p>
              <PackageSalesChart packages={data.byPackage} />
            </div>
          </div>

          <div className={`${PANEL} space-y-3`}>
            <p className="label-eyebrow text-ink-soft">Chiến dịch · đang chạy trước</p>
            {data.campaigns.length === 0 ? (
              <EmptyState text="Chưa có ban tổ chức nào mua gói quảng cáo." />
            ) : (
              <TableScroll>
                <table className="w-full min-w-[860px] text-left text-body">
                  <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                    <tr>
                      <Th>Sự kiện</Th>
                      <Th>Ban tổ chức</Th>
                      <Th>Gói</Th>
                      <Th>Vị trí</Th>
                      <Th>Thời gian</Th>
                      <Th>Doanh thu</Th>
                      <Th>Trạng thái</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((row) => (
                      <tr key={row.id} className="border-b border-beige-kem/15">
                        <Td>{row.eventTitle}</Td>
                        <Td>{row.organizer}</Td>
                        <Td nowrap>{row.packageName}</Td>
                        <Td>
                          {row.placements.map((slot) => AD_PLACEMENT_LABELS[slot]).join(" · ")}
                        </Td>
                        <Td nowrap>
                          {day(row.startsAt)} – {day(row.endsAt)}
                        </Td>
                        <Td nowrap>{formatVnd(row.price)}</Td>
                        <Td nowrap>
                          {row.status === "cancelled" ? (
                            <Pill tone="bad">Đã huỷ</Pill>
                          ) : row.live ? (
                            <Pill tone="good">Đang chạy</Pill>
                          ) : (
                            <Pill tone="neutral">Đã kết thúc</Pill>
                          )}
                        </Td>
                      </tr>
                    ))}
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
