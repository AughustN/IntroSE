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
import { useAsync } from "../useAsync";
import { EventPreviewScreen } from "./EventPreview";

/**
 * What the queue says about a row, in the same words the list screen next door uses (Principle VI).
 *
 * This column shows the MODERATION state, not `events.status`. It used to show the latter, and the
 * premise behind that — "what varies is whether the thing waiting is a draft or already scheduled
 * to sell" — was never true of this screen: `eventQueue` selects
 * `moderation_status = 'pending_review' AND status = 'on_sale'` (admin.repo.ts:182), so `draft`,
 * `finished` and `cancelled` can never reach it. Every row therefore read "Đang mở bán", which is a
 * claim the event has not earned: an event waiting on this queue is NOT publicly on sale, because
 * `visibility.ts` requires `moderation_status = 'approved'` before the catalog will show it. The
 * column stated the opposite of the fact the reader is here to act on.
 *
 * `approved`, `flagged` and `removed` are listed for completeness — the payload type allows them and
 * the list screen renders them — but only `pending_review` can appear here.
 */
const MODERATION_STATUS: Record<
  string,
  { label: string; tone: "good" | "warn" | "bad" | "neutral" }
> = {
  pending_review: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Đã duyệt", tone: "good" },
  flagged: { label: "Đã gắn cờ", tone: "warn" },
  removed: { label: "Đã gỡ", tone: "bad" },
};

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
  //
  // Search only. The status dropdown that sat beside it filtered `events.status`, which the server
  // has already pinned to `on_sale` for every row here, so three of its four options could only ever
  // return nothing; and with the column now showing moderation state — one value, by definition —
  // there is nothing left for it to narrow.
  const [draft, setDraft] = useState({ q: "" });
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
                <Th>Trạng thái kiểm duyệt</Th>
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
                    <Pill tone={MODERATION_STATUS[event.moderation]?.tone ?? "neutral"}>
                      {MODERATION_STATUS[event.moderation]?.label ?? event.moderation}
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
