/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { formatVnd } from "../../../services/currency";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  EmptyState,
  FIELD,
  Kpi,
  KpiStrip,
  MiniBars,
  Notice,
  PANEL,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import DatePicker from "../../DatePicker";
import Select from "../../Select";
import { useAsync } from "../useAsync";

const isoDay = (offsetDays: number) =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * The same money as the dashboard, cut by event and filterable (UC-32 step 3).
 *
 * Both controls are the ones the catalogue uses — the calendar the events page opens on "Ngày", and
 * the site's own dropdown. Two `<input type="date">` boxes and a text field asking for a category
 * *code* had the reader typing `theatre` from memory into a control drawn by Windows.
 *
 * Each control commits on its own: the calendar has an "Áp dụng" of its own, and picking a category
 * is one choice with nothing to confirm. Nothing re-queries per keystroke, which is what the
 * submit button was there to prevent.
 */
export default function AnalyticsScreen() {
  const [applied, setApplied] = useState({ from: isoDay(30), to: isoDay(0), category: "" });

  /* The real category list, so nobody has to remember that "Sân khấu" is spelled `theatre`. */
  const categories = useAsync(() => adminClient.categories(), "categories");
  const categoryOptions = [
    { value: "", label: "Tất cả danh mục" },
    ...(categories.data ?? []).map((row) => ({ value: row.code, label: row.labelVi })),
  ];
  const { data, error, loading } = useAsync(
    () =>
      adminClient.analytics({
        from: applied.from,
        to: applied.to,
        category: applied.category || undefined,
      }),
    JSON.stringify(applied),
  );

  return (
    <>
      <ScreenHead
        title="Doanh thu"
        meta={`${applied.from} → ${applied.to}${applied.category ? ` · ${applied.category}` : ""}`}
      />

      <div className={`${PANEL} flex flex-wrap items-end gap-4`}>
        <div className="w-56">
          <DatePicker
            label="Khoảng ngày"
            value={{ from: applied.from, to: applied.to }}
            /* No dots on the grid: every day of the year is a legitimate reporting range, so
               marking "days with events" would mark almost all of them and say nothing. */
            available={[]}
            onChange={(range) =>
              setApplied({
                ...applied,
                from: range?.from ?? isoDay(30),
                to: range?.to ?? isoDay(0),
              })
            }
          />
        </div>
        <div className="w-56">
          <Select
            label="Danh mục"
            value={applied.category}
            options={categoryOptions}
            onChange={(value) => setApplied({ ...applied, category: value })}
            triggerClassName={`${FIELD} justify-between`}
          />
        </div>
        <button
          type="button"
          className={ACTION_GHOST}
          onClick={() => setApplied({ from: isoDay(30), to: isoDay(0), category: "" })}
        >
          Đặt lại
        </button>
        {loading && <span className="font-meta text-body text-ink-soft">Đang tính…</span>}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {data && (
        <>
          <KpiStrip>
            <Kpi label="Doanh thu" value={formatVnd(data.totals.revenue)} />
            <Kpi label="Vé đã bán" value={data.totals.tickets.toLocaleString("vi-VN")} />
            <Kpi
              label="Đã check-in"
              value={
                data.totals.tickets === 0
                  ? "—"
                  : `${Math.round((data.totals.checkedIn / data.totals.tickets) * 100)}%`
              }
              note={`${data.totals.checkedIn} lượt quét`}
            />
            <Kpi label="Sự kiện có doanh thu" value={`${data.totals.events}`} />
          </KpiStrip>

          <div className={`${PANEL} space-y-3`}>
            <p className="label-eyebrow text-ink-soft">Theo ngày</p>
            <MiniBars points={data.byDay} format={formatVnd} />
          </div>

          <div className={`${PANEL} space-y-3`}>
            <p className="label-eyebrow text-ink-soft">Theo sự kiện · doanh thu cao nhất trước</p>
            {data.rows.length === 0 ? (
              <EmptyState text="Không có vé nào bán ra trong khoảng này." />
            ) : (
              <TableScroll>
                <table className="w-full min-w-[720px] text-left text-body">
                  <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                    <tr>
                      <Th>Sự kiện</Th>
                      <Th>Ban tổ chức</Th>
                      <Th>Danh mục</Th>
                      <Th>Vé</Th>
                      <Th>Đã vào</Th>
                      <Th>Doanh thu</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.eventId} className="border-b border-beige-kem/15">
                        <Td>{row.eventTitle}</Td>
                        <Td>{row.organizer}</Td>
                        <Td nowrap>{row.category}</Td>
                        <Td nowrap>
                          <span className="tabular-nums">{row.tickets}</span>
                        </Td>
                        <Td nowrap>
                          <span className="tabular-nums">{row.checkedIn}</span>
                        </Td>
                        <Td nowrap>
                          <span className="tabular-nums">{formatVnd(row.revenue)}</span>
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
