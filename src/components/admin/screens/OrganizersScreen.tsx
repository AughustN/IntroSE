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
import OrganizerPreview from "./OrganizerPreview";

const TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  approved: "good",
  pending: "neutral",
  rejected: "bad",
  suspended: "warn",
};

/**
 * The status vocabulary, in Vietnamese, in one place.
 *
 * The pill used to print the raw column value, so the filter would have offered "Chờ duyệt" while
 * the row beside it said `pending` — two names for one state, on the same screen.
 */
const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  suspended: "Đã đình chỉ",
};

/** The same page size the report queue uses, so the console pages at one rhythm. */
const PAGE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

/**
 * Who may sell tickets (UC-33).
 *
 * Suspension is separated from rejection on purpose, and the page says which is which: rejecting is
 * an answer to an application, suspending stops an organizer who is already trading — the second
 * one takes their live events down with it.
 */
export default function OrganizersScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.queue(), "queue");
  const [pending, setPending] = useState<{ id: number; action: "reject" | "suspend" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Typed, then applied — the same two-state filter the report queue uses. Local, because `queue()`
  // already returns every profile in one call.
  const [draft, setDraft] = useState({ q: "", status: "" });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(0);
  /** Which profile is open as a full page, if any. Null means the queue itself. */
  const [previewId, setPreviewId] = useState<number | null>(null);

  if (previewId !== null) {
    return (
      <OrganizerPreview
        organizerId={previewId}
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

  const all = data?.organizers ?? [];
  const needle = applied.q.trim().toLowerCase();
  const organizers = all.filter((organizer) => {
    if (applied.status && organizer.status !== applied.status) return false;
    if (!needle) return true;
    return (
      organizer.displayName.toLowerCase().includes(needle) ||
      (organizer.description ?? "").toLowerCase().includes(needle)
    );
  });

  /*
   * Clamped rather than trusted: deciding the last profile on the last page shortens the list under
   * a page number still pointing past the end, and an unclamped slice would answer with an empty
   * table and no way back.
   */
  const lastPage = Math.max(0, Math.ceil(organizers.length / PAGE) - 1);
  const safePage = Math.min(page, lastPage);
  const rows = organizers.slice(safePage * PAGE, safePage * PAGE + PAGE);

  return (
    <>
      <ScreenHead
        title="Ban tổ chức"
        meta={
          data
            ? `${organizers.length} hồ sơ khớp bộ lọc · ${all.length} trong hàng chờ`
            : "Hồ sơ ban tổ chức"
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
          <span className="label-eyebrow block text-ink-soft">Tên ban tổ chức</span>
          <input
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="Công ty Giải trí…"
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

      {pending && (
        <div className={`${PANEL} space-y-3`}>
          <p className="label-eyebrow text-ink-soft">
            {pending.action === "reject" ? "Từ chối hồ sơ" : "Đình chỉ ban tổ chức"} #{pending.id}
          </p>
          <p className="font-meta text-meta text-ink-soft">
            {pending.action === "reject"
              ? "Hồ sơ bị từ chối; người nộp có thể sửa và nộp lại."
              : "Đình chỉ chặn quyền bán vé ngay lập tức, kể cả với sự kiện đang mở bán."}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Lý do (bắt buộc)"
              className={`${FIELD} min-w-[280px] flex-1`}
            />
            <button
              className={ACTION_PRIMARY}
              disabled={busy}
              onClick={() => {
                const text = reason.trim();
                if (!text) {
                  setFailure("Cần một lý do — hồ sơ này sẽ đọc được nó.");
                  return;
                }
                void run(
                  () =>
                    pending.action === "reject"
                      ? adminClient.rejectOrganizer(pending.id, text)
                      : adminClient.suspendOrganizer(pending.id, text),
                  pending.action === "reject" ? "Đã từ chối hồ sơ." : "Đã đình chỉ ban tổ chức.",
                );
              }}
            >
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

      {organizers.length === 0 && !loading ? (
        <EmptyState
          text={
            all.length === 0
              ? "Không có hồ sơ ban tổ chức nào đang chờ."
              : "Không có hồ sơ nào khớp bộ lọc."
          }
        />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[720px] text-left text-meta">
            <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
              <tr>
                <Th>Tên hiển thị</Th>
                <Th>Trạng thái</Th>
                <Th>Ghi chú</Th>
                <Th>Nộp lúc</Th>
                <Th>Quyết định</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((organizer) => (
                <tr key={organizer.id} className="border-b border-beige-kem/15">
                  <Td>
                    <button
                      type="button"
                      className={`${ROW_LINK} font-bold text-beige-kem`}
                      onClick={() => setPreviewId(organizer.id)}
                      title="Mở hồ sơ đầy đủ"
                    >
                      {organizer.displayName}
                    </button>
                    {organizer.description && (
                      <span className="block font-meta text-eyebrow text-ink-soft">
                        {organizer.description}
                      </span>
                    )}
                  </Td>
                  <Td nowrap>
                    <div className="flex flex-col items-start gap-1">
                      <Pill tone={TONE[organizer.status] ?? "neutral"}>
                        {STATUS_LABEL[organizer.status] ?? organizer.status}
                      </Pill>
                      {organizer.latestAppeal?.status === "pending" && (
                        <Pill tone="warn">Có khiếu nại</Pill>
                      )}
                    </div>
                  </Td>
                  <Td>{organizer.reviewNote ?? "—"}</Td>
                  <Td nowrap>{organizer.appliedAt.slice(0, 10)}</Td>
                  <Td nowrap>
                    <div className="flex flex-wrap gap-2">
                      {organizer.status === "pending" && (
                        <>
                          <button
                            className={ACTION_ROW_PRIMARY}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => adminClient.approveOrganizer(organizer.id),
                                `Đã duyệt “${organizer.displayName}”.`,
                              )
                            }
                          >
                            Duyệt
                          </button>
                          <button
                            className={ACTION_ROW_GHOST}
                            disabled={busy}
                            onClick={() => setPending({ id: organizer.id, action: "reject" })}
                          >
                            Từ chối
                          </button>
                        </>
                      )}
                      {organizer.status === "suspended" && (
                        <button
                          className={ACTION_ROW_PRIMARY}
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => adminClient.unsuspendOrganizer(organizer.id),
                              `Đã mở lại “${organizer.displayName}”.`,
                            )
                          }
                        >
                          Mở lại
                        </button>
                      )}
                      {organizer.status === "approved" && (
                        <button
                          className={ACTION_ROW_GHOST}
                          disabled={busy}
                          onClick={() => setPending({ id: organizer.id, action: "suspend" })}
                        >
                          Đình chỉ
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {organizers.length > 0 && (
        <Pager page={safePage} lastPage={lastPage} disabled={loading} onChange={setPage} />
      )}
    </>
  );
}
