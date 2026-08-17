/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ContentReportRow } from "@shared/admin/types.js";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_PRIMARY,
  ACTION_ROW_GHOST,
  EmptyState,
  FIELD,
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
import ReportDetail from "./ReportDetail";

const PAGE = 25;

type StatusFilter = "" | "open" | "flagged" | "resolved" | "dismissed";

const STATUS_OPTIONS = [
  { value: "open", label: "Chưa xử lý" },
  { value: "flagged", label: "Đã gắn cờ" },
  { value: "resolved", label: "Đã gỡ" },
  { value: "dismissed", label: "Đã bỏ qua" },
  { value: "", label: "Tất cả" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Chưa xử lý",
  flagged: "Đã gắn cờ",
  resolved: "Đã gỡ",
  dismissed: "Đã bỏ qua",
};

const STATUS_TONE: Record<string, "warn" | "bad" | "neutral"> = {
  open: "warn",
  flagged: "warn",
  resolved: "bad",
  dismissed: "neutral",
};

/**
 * Reported events (UC-39 → UC-34).
 *
 * This half of the queue used to be structurally empty: the table accepted `target_type = 'event'`
 * and the admin service knew how to resolve one, but nothing in the product could *open* an event
 * report. The event page now has the control, so this is the screen that receives them.
 *
 * Built as the comment queue is — search, a status filter, open work first — because they are the
 * same job on two kinds of content, and two moderation screens that behave differently is two
 * things to learn. What differs is where a decision leads: judging an event needs the event, so a
 * row opens its own page rather than deciding from a table cell.
 */
export default function ReportsScreen() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ q: string; status: StatusFilter }>({
    q: "",
    status: "open",
  });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(0);

  const { data, error, loading, reload } = useAsync(
    () =>
      adminClient.contentReports({
        q: applied.q || undefined,
        status: applied.status || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    JSON.stringify({ applied, page }),
  );

  if (openId !== null) {
    return (
      <ReportDetail
        reportId={openId}
        onBack={() => setOpenId(null)}
        onDecided={() => {
          setOpenId(null);
          reload();
        }}
      />
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <>
      <ScreenHead
        title="Tố cáo nội dung"
        meta={
          data
            ? `${total} tố cáo khớp bộ lọc · ${data.openCount} chưa xử lý`
            : "Tố cáo sự kiện từ người dùng"
        }
      />

      <form
        className={`${PANEL} flex flex-wrap items-end gap-3`}
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setApplied(draft);
        }}
      >
        <label className="min-w-[240px] flex-1 space-y-1">
          <span className="label-eyebrow block text-ink-soft">Tên sự kiện</span>
          <input
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="Đêm nhạc Trịnh…"
            className={`${FIELD} w-full`}
          />
        </label>
        <div className="w-56">
          <Select
            label="Trạng thái"
            value={draft.status}
            options={STATUS_OPTIONS}
            onChange={(value) => setDraft({ ...draft, status: value as StatusFilter })}
            triggerClassName={`${FIELD} justify-between`}
          />
        </div>
        <button type="submit" className={ACTION_PRIMARY} disabled={loading}>
          {loading ? "Đang tìm…" : "Tìm"}
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      {rows.length === 0 && !loading ? (
        <EmptyState
          text={
            applied.status === "open"
              ? "Không có tố cáo sự kiện nào đang chờ."
              : "Không có tố cáo nào khớp bộ lọc."
          }
        />
      ) : (
        <>
          <TableScroll>
            <table className="w-full min-w-[860px] text-left text-meta">
              <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                <tr>
                  <Th>Sự kiện</Th>
                  <Th>Lý do tố cáo</Th>
                  <Th>Người báo</Th>
                  <Th>Trạng thái</Th>
                  <Th>&nbsp;</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((report: ContentReportRow) => (
                  <tr key={report.id} className="border-b border-beige-kem/15">
                    <Td>
                      <span className="block text-beige-kem">{report.eventTitle}</span>
                      <span className="mt-1 block font-meta text-eyebrow text-ink-soft">
                        /{report.eventSlug} · {report.eventModeration}
                        {/* Several people flagging one event is the strongest signal this screen
                            carries, and it is invisible if each report is only ever read alone. */}
                        {report.openCountForTarget > 1 &&
                          ` · ${report.openCountForTarget} tố cáo đang chờ`}
                      </span>
                    </Td>
                    <Td>{report.reason}</Td>
                    <Td>
                      <span className="block font-meta text-eyebrow text-ink-soft">
                        {report.reporterEmail}
                      </span>
                      <span className="block font-meta text-eyebrow text-ink-soft">
                        {report.createdAt.slice(0, 10)}
                      </span>
                    </Td>
                    <Td nowrap>
                      <Pill tone={STATUS_TONE[report.status] ?? "neutral"}>
                        {STATUS_LABEL[report.status] ?? report.status}
                      </Pill>
                      {report.resolutionNote && (
                        <span className="mt-1 block font-meta text-eyebrow text-ink-soft">
                          {report.resolutionNote}
                        </span>
                      )}
                    </Td>
                    <Td nowrap>
                      <button className={ACTION_ROW_GHOST} onClick={() => setOpenId(report.id)}>
                        Xem sự kiện
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          <Pager page={page} lastPage={lastPage} disabled={loading} onChange={setPage} />
        </>
      )}
    </>
  );
}
