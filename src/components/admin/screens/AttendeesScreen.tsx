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
  Pager,
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

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "valid", label: "Chưa vào" },
  { value: "checked_in", label: "Đã vào" },
  { value: "void", label: "Đã huỷ" },
];

const PAGE = 50;

/** `2026-08-17T19:30:00Z` → `17/08 · 19:30`, the way a door list is read. */
function showtimeLabel(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} · ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/**
 * The door list (UC-29).
 *
 * The event is chosen from the events that have actually sold something in the last 90 days, which
 * is the only kind that has attendees — a dropdown of the whole catalogue would be mostly rows that
 * lead to an empty table.
 *
 * **Everything below the picker is narrowed on the server.** This screen used to fetch every ticket
 * for the event in one array and render all of them: a sold-out arena meant a multi-megabyte payload
 * and tens of thousands of table rows, and the page had no vertical scroll of its own, so it simply
 * grew. Now the list is a page and the filters are query parameters.
 *
 * The three controls are in the order the work happens in. Which night, then who — because a door
 * list is per-showtime in reality, and a three-night run shown merged tells the person on the door
 * nothing about tonight.
 */
export default function AttendeesScreen() {
  const [eventId, setEventId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * Typed, then applied — the same two-state filter the moderation queues use. It matters more here
   * than there: every keystroke would otherwise be a round trip against the biggest table in the
   * product. The showtime and status pickers apply immediately, because choosing from a list is
   * already a deliberate act with nothing half-finished about it.
   */
  const [draft, setDraft] = useState("");
  const [applied, setApplied] = useState({ q: "", status: "", showtimeId: "" });
  const [page, setPage] = useState(0);

  const sellers = useAsync(
    () =>
      adminClient.analytics({
        from: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
      }),
    "sellers",
  );

  const showtimes = useAsync(
    () => (eventId === null ? Promise.resolve(null) : adminClient.eventShowtimes(eventId)),
    `showtimes-${eventId ?? "none"}`,
  );

  const list = useAsync(
    () =>
      eventId === null
        ? Promise.resolve(null)
        : adminClient.attendees(eventId, {
            showtimeId: applied.showtimeId ? Number(applied.showtimeId) : undefined,
            q: applied.q || undefined,
            status: applied.status || undefined,
            limit: PAGE,
            offset: page * PAGE,
          }),
    JSON.stringify({ eventId, applied, page }),
  );

  const eventOptions = (sellers.data?.rows ?? []).map((row) => ({
    value: String(row.eventId),
    label: `${row.eventTitle} · ${row.tickets} vé`,
  }));

  const showtimeOptions = [
    { value: "", label: "Tất cả suất diễn" },
    ...(showtimes.data ?? []).map((showtime) => ({
      value: String(showtime.id),
      label: `${showtimeLabel(showtime.startsAt)} · ${showtime.venue} · ${showtime.tickets} vé`,
    })),
  ];

  /** Reset to the first page whenever the filters change, or page 4 of 4 becomes an empty table. */
  const narrow = (next: Partial<typeof applied>) => {
    setPage(0);
    setApplied({ ...applied, ...next });
  };

  const pickEvent = (value: string) => {
    setEventId(value ? Number(value) : null);
    setPage(0);
    setDraft("");
    setApplied({ q: "", status: "", showtimeId: "" });
  };

  const download = async () => {
    if (eventId === null) return;
    setDownloading(true);
    setFailure(null);
    try {
      // The export carries the same filters the screen is showing — an admin who has narrowed to
      // "tonight, not yet checked in" wants that list in the file, not the whole run again. The
      // server ignores the paging for CSV, so the file is always complete for those filters.
      const blob = await adminClient.attendeesCsv(eventId, {
        showtimeId: applied.showtimeId ? Number(applied.showtimeId) : undefined,
        q: applied.q || undefined,
        status: applied.status || undefined,
      });
      // The file is fetched with the session's credentials, so it arrives as bytes rather than as a
      // URL: an anchor pointed at the endpoint would send no Authorization header and save a 401.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `khach-tham-du-${eventId}.csv`;
      /*
       * In the document, and revoked on the next turn of the loop.
       *
       * Firefox ignores `click()` on an anchor that was never attached, and revoking the object URL
       * synchronously after the click can pull the blob out from under a save that has not started
       * yet. Both failures look identical to the admin: the button works and no file appears.
       */
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Không tải được tệp.");
    } finally {
      setDownloading(false);
    }
  };

  const data = list.data;
  const lastPage = Math.max(0, Math.ceil((data?.total ?? 0) / PAGE) - 1);
  /*
   * Clamped, and shown even when the page is empty.
   *
   * The list can shrink under a page number that is still pointing past the end — tickets get
   * voided, `Tải lại` re-reads without resetting paging — and the pager used to live inside the
   * "we have rows" branch. So the reader landed on the empty state with no control to get back and
   * no way to tell an over-run page from a genuinely empty filter.
   */
  const safePage = Math.min(page, lastPage);
  const overrun = data !== null && data.rows.length === 0 && data.total > 0;
  const filtered = applied.q !== "" || applied.status !== "" || applied.showtimeId !== "";

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
            onChange={pickEvent}
            triggerClassName={`${FIELD} w-full justify-between`}
          />
        </div>
        <button className={ACTION_GHOST} onClick={() => list.reload()} disabled={eventId === null}>
          Tải lại
        </button>
      </div>

      {eventId !== null && (
        <form
          className={`${PANEL} flex flex-wrap items-end gap-3`}
          onSubmit={(event) => {
            event.preventDefault();
            narrow({ q: draft });
          }}
        >
          <div className="w-64">
            <Select
              label="Suất diễn"
              value={applied.showtimeId}
              options={showtimeOptions}
              onChange={(value) => narrow({ showtimeId: value })}
              triggerClassName={`${FIELD} justify-between`}
            />
          </div>
          <label className="min-w-[240px] flex-1 space-y-1">
            <span className="label-eyebrow block text-ink-soft">Khách · email · mã đơn</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Nguyễn Văn A…"
              className={`${FIELD} w-full`}
            />
          </label>
          <div className="w-44">
            <Select
              label="Trạng thái"
              value={applied.status}
              options={STATUS_OPTIONS}
              onChange={(value) => narrow({ status: value })}
              triggerClassName={`${FIELD} justify-between`}
            />
          </div>
          <button type="submit" className={ACTION_PRIMARY} disabled={list.loading}>
            {list.loading ? "Đang tìm…" : "Tìm"}
          </button>
        </form>
      )}

      {sellers.error && <Notice tone="error">{sellers.error}</Notice>}
      {showtimes.error && <Notice tone="error">{showtimes.error}</Notice>}
      {list.error && <Notice tone="error">{list.error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}

      {eventId === null ? (
        <EmptyState text="Chưa chọn sự kiện nào." />
      ) : !data ? (
        <EmptyState text={list.loading ? "Đang tải danh sách…" : "Không có dữ liệu."} />
      ) : (
        <>
          {/*
            Event-wide, and deliberately unaffected by the search box: these answer "how full is this
            door", which does not change because somebody typed a name. Only the showtime filter
            moves them, because a different night genuinely is a different door.
          */}
          <KpiStrip>
            <Kpi label="Tổng vé" value={`${data.counts.total}`} tone="volume" />
            <Kpi label="Đã vào" value={`${data.counts.checkedIn}`} tone="volume" />
            <Kpi
              label="Tỷ lệ vào cửa"
              tone="rate"
              value={
                data.counts.total === 0
                  ? "—"
                  : `${Math.round((data.counts.checkedIn / data.counts.total) * 100)}%`
              }
            />
            <Kpi label="Vé đã huỷ" value={`${data.counts.void}`} tone="rate" />
          </KpiStrip>

          {data.rows.length === 0 ? (
            <>
              <EmptyState
                text={
                  overrun
                    ? "Trang này không còn dòng nào — danh sách đã ngắn đi."
                    : filtered
                      ? "Không có khách nào khớp bộ lọc."
                      : "Sự kiện này chưa có vé nào được thanh toán."
                }
              />
              {overrun && (
                <Pager
                  page={safePage}
                  lastPage={lastPage}
                  disabled={list.loading}
                  onChange={setPage}
                />
              )}
            </>
          ) : (
            <>
              <p className="font-meta text-meta text-ink-soft">
                {data.total.toLocaleString("vi-VN")} vé khớp bộ lọc
                {data.total > PAGE && ` · hiển thị ${data.rows.length} mỗi trang`}
              </p>

              <TableScroll>
                <table className="w-full min-w-[820px] text-left text-meta">
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
                          <span className="block font-meta text-eyebrow text-ink-soft">
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

              <Pager
                page={safePage}
                lastPage={lastPage}
                disabled={list.loading}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
