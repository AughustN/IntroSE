/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  ACTION_PRIMARY,
  ACTION_ROW_GHOST,
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

type Decision = "flag" | "remove" | "approve";

const DECISION_LABEL: Record<Decision, string> = {
  flag: "Gắn cờ",
  remove: "Gỡ",
  approve: "Duyệt lại",
};

/*
 * Which actions a row may actually take, from what it currently is.
 *
 * The moderation state machine allows `approved → flagged`, `flagged → approved` and either →
 * `removed`; `removed` is terminal. This table is that machine, so the screen cannot offer a button
 * whose only possible answer is 409. It used to show "Gắn cờ" on already-flagged rows, which always
 * failed with "Trạng thái đã thay đổi" — and offered no way to un-flag, which was the real gap.
 */
const ROW_DECISIONS: Record<string, Decision[]> = {
  approved: ["flag", "remove"],
  flagged: ["approve", "remove"],
  removed: [],
};

const EVENT_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Bản nháp", tone: "neutral" },
  on_sale: { label: "Đang mở bán", tone: "good" },
  finished: { label: "Đã kết thúc", tone: "neutral" },
  cancelled: { label: "Đã hủy", tone: "bad" },
};

const MODERATION_LABEL: Record<string, string> = {
  approved: "Đã duyệt",
  flagged: "Đã gắn cờ",
  removed: "Đã gỡ",
};

const MODERATION_TONE: Record<string, "good" | "warn" | "bad"> = {
  approved: "good",
  flagged: "warn",
  removed: "bad",
};

/** The same page size the report queue uses, so the console pages at one rhythm. */
const PAGE = 25;

const MODERATION_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "approved", label: "Đã duyệt" },
  { value: "flagged", label: "Đã gắn cờ" },
  { value: "removed", label: "Đã gỡ" },
] as const;

/**
 * Everything that has been approved, in one place (UC-34).
 *
 * The inbox next door is for deciding; this page is for watching — flagging or taking down a live
 * event, never approving again. Flagged and removed rows stay listed: they once carried an
 * approval, and a takedown that vanished from the screen would be one nobody could undo in their
 * head. Reads the same moderation payload as the inbox.
 */
export default function EventListScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.queue(), "event-list");
  const [pending, setPending] = useState<{ id: number; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /*
   * Search and filter, in the two-state shape the report queue uses: what is typed, and what is
   * being shown. Nothing narrows until "Tìm" is pressed, so a half-typed event name never blanks
   * the table under the reader's hands.
   *
   * The filtering itself is local, which is where this screen genuinely differs from that one:
   * `adminClient.queue()` answers with the whole moderated list in one call, so there is no page to
   * fetch and no reason to make the server re-run the same read. The controls are identical; only
   * what happens on submit is cheaper.
   */
  const [draft, setDraft] = useState({ q: "", moderation: "" });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(0);
  /** Which event is open as a full page, if any. Null means the list itself. */
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

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setNotice(done);
      setPending(null);
      setReason("");
      reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = () => {
    if (!pending) return;
    const { id, decision } = pending;
    const text = reason.trim();
    if (decision === "remove" && !text) {
      setFailure(
        "Gỡ vì vi phạm phải kèm lý do — thao tác này sẽ huỷ suất tương lai, void vé và hoàn tiền vào ví người mua.",
      );
      return;
    }
    const call = {
      flag: () => adminClient.flagEvent(id, text || undefined),
      remove: () => adminClient.removeEvent(id, text),
      // Re-approving carries no reason: there is nobody being refused, and the note field on the
      // event still holds whatever was written when it was flagged.
      approve: () => adminClient.approveEvent(id),
    }[decision];
    void run(call, `Đã ${DECISION_LABEL[decision].toLowerCase()} sự kiện #${id}.`);
  };

  const all = data?.approvedEvents ?? [];
  // The name as it appears, the slug as it appears in a URL somebody pasted, and the organizer —
  // the three things an admin arrives already knowing when they come looking for one event.
  const needle = applied.q.trim().toLowerCase();
  const approved = all.filter((event) => {
    if (applied.moderation && event.moderation !== applied.moderation) return false;
    if (!needle) return true;
    return (
      event.title.toLowerCase().includes(needle) ||
      event.slug.toLowerCase().includes(needle) ||
      event.organizer.toLowerCase().includes(needle)
    );
  });

  /*
   * Clamped rather than trusted: taking down the last row on the last page shortens the list under a
   * page number still pointing past the end, and an unclamped slice would answer with an empty table
   * and no way back.
   */
  const lastPage = Math.max(0, Math.ceil(approved.length / PAGE) - 1);
  const safePage = Math.min(page, lastPage);
  const rows = approved.slice(safePage * PAGE, safePage * PAGE + PAGE);

  return (
    <>
      <ScreenHead
        title="Danh sách sự kiện"
        meta={
          data
            ? `${approved.length} sự kiện khớp bộ lọc · ${all.length} đã qua kiểm duyệt`
            : "Sự kiện đã qua kiểm duyệt"
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
            label="Kiểm duyệt"
            value={draft.moderation}
            options={MODERATION_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            onChange={(value) => setDraft({ ...draft, moderation: value })}
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

      {pending && (
        <div className={`${PANEL} space-y-3`}>
          <p className="label-eyebrow text-ink-soft">
            {DECISION_LABEL[pending.decision]} sự kiện #{pending.id}
          </p>
          <p className="font-meta text-meta text-ink-soft">
            {pending.decision === "remove"
              ? "Lý do bắt buộc. Thao tác này sẽ huỷ suất tương lai, void vé và hoàn tiền vào ví người mua."
              : pending.decision === "approve"
                ? "Gỡ cờ và cho sự kiện hiển thị lại trên trang công khai. Vé được bán tiếp."
                : "Lý do không bắt buộc, nhưng nếu có thì được lưu vào nhật ký thao tác."}
          </p>
          <div className="flex flex-wrap gap-2">
            {pending.decision !== "approve" && (
              <input
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ví dụ: ảnh bìa vi phạm bản quyền"
                className={`${FIELD} min-w-[280px] flex-1`}
              />
            )}
            <button className={ACTION_PRIMARY} onClick={submitDecision} disabled={busy}>
              {busy ? "Đang gửi…" : "Xác nhận"}
            </button>
            <button
              className={ACTION_GHOST}
              onClick={() => {
                setPending(null);
                setReason("");
                setFailure(null);
              }}
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {approved.length === 0 && !loading ? (
        <EmptyState text="Chưa có sự kiện nào khớp bộ lọc." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[760px] text-left text-meta">
            <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
              <tr>
                <Th>Sự kiện</Th>
                <Th>Ban tổ chức</Th>
                <Th>Trạng thái sự kiện</Th>
                <Th>Kiểm duyệt</Th>
                <Th>Ghi chú</Th>
                <Th>Thao tác</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr key={event.id} className="border-b border-beige-kem/15">
                  <Td>
                    <button
                      type="button"
                      className={`${ROW_LINK} max-w-[220px] font-bold text-beige-kem`}
                      onClick={() => setPreviewId(event.id)}
                      title="Mở trang xem trước"
                    >
                      {event.title}
                    </button>
                    <span className="block max-w-[220px] truncate font-meta text-eyebrow text-ink-soft">
                      /{event.slug}
                    </span>
                  </Td>
                  <Td>{event.organizer}</Td>
                  <Td nowrap>
                    <Pill tone={EVENT_STATUS[event.status]?.tone ?? "neutral"}>
                      {EVENT_STATUS[event.status]?.label ?? event.status}
                    </Pill>
                  </Td>
                  <Td nowrap>
                    <Pill tone={MODERATION_TONE[event.moderation] ?? "neutral"}>
                      {MODERATION_LABEL[event.moderation] ?? event.moderation}
                    </Pill>
                  </Td>
                  <Td>
                    <span className="block max-w-[180px]">{event.reviewNote ?? "—"}</span>
                  </Td>
                  <Td nowrap>
                    <div className="flex flex-wrap gap-2">
                      {(ROW_DECISIONS[event.moderation] ?? []).map((decision) => (
                        <button
                          key={decision}
                          className={ACTION_ROW_GHOST}
                          disabled={busy}
                          onClick={() => {
                            setPending({ id: event.id, decision });
                            setReason("");
                            setFailure(null);
                          }}
                        >
                          {DECISION_LABEL[decision]}
                        </button>
                      ))}
                      {(ROW_DECISIONS[event.moderation] ?? []).length === 0 && (
                        <span className="font-meta text-eyebrow text-ink-soft">—</span>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {approved.length > 0 && (
        <Pager page={safePage} lastPage={lastPage} disabled={loading} onChange={setPage} />
      )}
    </>
  );
}
