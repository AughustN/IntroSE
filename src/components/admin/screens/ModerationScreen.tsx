/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  ACTION_PRIMARY,
  ACTION_ROW_PRIMARY,
  EmptyState,
  FIELD,
  Notice,
  Pager,
  PANEL,
  Pill,
  ROW_LINK,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import Select from "../../Select";
import { useAsync } from "../useAsync";
import { EventPreviewScreen } from "./EventPreview";

const EVENT_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Bản nháp", tone: "neutral" },
  on_sale: { label: "Đang mở bán", tone: "good" },
  finished: { label: "Đã kết thúc", tone: "neutral" },
  cancelled: { label: "Đã hủy", tone: "bad" },
};

/**
 * The filter's options, and the table's labels, from one place.
 *
 * The status offered here is the EVENT's own state, not its moderation state: every row in this
 * inbox is `pending_review` by definition, so a moderation filter would have exactly one value to
 * choose. What actually varies — and what the reader wants to sort out first — is whether the thing
 * waiting for a decision is a draft or already scheduled to sell.
 */
const STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  ...Object.entries(EVENT_STATUS).map(([value, { label }]) => ({ value, label })),
];

/** The same page size the report queue uses, so the console pages at one rhythm. */
const PAGE = 25;

/**
 * The approval inbox and nothing else (UC-34). One decision per row: a single press to approve.
 *
 * Watching and taking down approved events lives next door, on the "Danh sách sự kiện" page —
 * both read the one moderation payload, so a reload after any decision keeps the two pages
 * consistent with each other.
 */
export default function ModerationScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.queue(), "queue");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Typed, then applied — the queue does not narrow under the reader's hands mid-word. Filtering is
  // local because `queue()` already answers with the whole inbox in one call.
  const [draft, setDraft] = useState({ q: "", status: "" });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(0);
  /** Which event is open as a full page, if any. Null means the queue itself. */
  const [previewId, setPreviewId] = useState<number | null>(null);

  if (previewId !== null) {
    return (
      <EventPreviewScreen
        eventId={previewId}
        onBack={() => setPreviewId(null)}
        onDecided={() => {
          setPreviewId(null);
          reload();
        }}
      />
    );
  }

  const approve = async (id: number, title: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await adminClient.approveEvent(id);
      setNotice(`Đã duyệt “${title}”.`);
      reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  };

  const waiting = (data?.events ?? []).filter((event) => event.moderation === "pending_review");
  const needle = applied.q.trim().toLowerCase();
  const queue = waiting.filter((event) => {
    if (applied.status && event.status !== applied.status) return false;
    if (!needle) return true;
    return (
      event.title.toLowerCase().includes(needle) ||
      event.slug.toLowerCase().includes(needle) ||
      event.organizer.toLowerCase().includes(needle)
    );
  });

  /*
   * Clamped rather than trusted. Approving the last row on the last page shortens the list under a
   * page number that is still pointing past the end, and an unclamped slice would answer that with
   * an empty table and no way back.
   */
  const lastPage = Math.max(0, Math.ceil(queue.length / PAGE) - 1);
  const safePage = Math.min(page, lastPage);
  const rows = queue.slice(safePage * PAGE, safePage * PAGE + PAGE);

  return (
    <>
      <ScreenHead
        title="Hàng chờ sự kiện"
        meta={
          data
            ? `${queue.length} sự kiện khớp bộ lọc · ${waiting.length} đang chờ quyết định`
            : "Sự kiện đang chờ quyết định"
        }
        actions={
          <button onClick={reload} className={ACTION_GHOST} disabled={loading}>
            {loading ? "Đang tải…" : "Tải lại"}
          </button>
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
            onChange={(value) => setDraft({ ...draft, status: value })}
            triggerClassName={`${FIELD} justify-between`}
          />
        </div>
        <button type="submit" className={ACTION_PRIMARY} disabled={loading}>
          {loading ? "Đang tìm…" : "Tìm"}
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {queue.length === 0 && !loading ? (
        <EmptyState
          text={
            waiting.length === 0
              ? "Không có sự kiện nào đang chờ duyệt."
              : "Không có sự kiện nào khớp bộ lọc."
          }
        />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[760px] text-left text-meta">
            <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
              <tr>
                <Th>Sự kiện</Th>
                <Th>Ban tổ chức</Th>
                <Th>Trạng thái sự kiện</Th>
                <Th>Ghi chú</Th>
                <Th>Quyết định</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr key={event.id} className="border-b border-beige-kem/15">
                  <Td>
                    <button
                      type="button"
                      className={`${ROW_LINK} font-bold text-beige-kem`}
                      onClick={() => setPreviewId(event.id)}
                      title="Mở trang xem trước"
                    >
                      {event.title}
                    </button>
                    <span className="block font-meta text-eyebrow text-ink-soft">
                      /{event.slug}
                    </span>
                  </Td>
                  <Td>{event.organizer}</Td>
                  <Td nowrap>
                    <Pill tone={EVENT_STATUS[event.status]?.tone ?? "neutral"}>
                      {EVENT_STATUS[event.status]?.label ?? event.status}
                    </Pill>
                  </Td>
                  <Td>{event.reviewNote ?? "—"}</Td>
                  <Td nowrap>
                    <button
                      className={ACTION_ROW_PRIMARY}
                      disabled={busy}
                      onClick={() => void approve(event.id, event.title)}
                    >
                      Duyệt
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {queue.length > 0 && (
        <Pager page={safePage} lastPage={lastPage} disabled={loading} onChange={setPage} />
      )}
    </>
  );
}
