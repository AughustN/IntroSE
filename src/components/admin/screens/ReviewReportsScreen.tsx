/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ReviewReportRow } from "@shared/admin/types.js";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  ACTION_PRIMARY,
  EmptyState,
  FIELD,
  Notice,
  PANEL,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import Select from "../../Select";
import { useAsync } from "../useAsync";

const PAGE = 25;

const STATUS_OPTIONS = [
  { value: "open", label: "Chưa xử lý" },
  { value: "done", label: "Đã xong" },
  { value: "", label: "Tất cả" },
] as const;

/**
 * Reported comments, and what was done about them (UC-39 → UC-34).
 *
 * The reports themselves have existed since the reviews feature shipped: a reader presses "Báo cáo"
 * under a comment and a row lands in `content_reports`. Until now the console could only *dismiss*
 * one — upholding a report meant finding the comment on the event page and hiding it there, which
 * left the report open for ever and the audit trail with a hole in it.
 *
 * Two states, because two is what a moderator actually distinguishes: it is waiting, or it is done.
 * The database keeps three closed spellings (`dismissed`, `flagged`, `resolved`); which one it was
 * is shown per row, but nobody has to filter by them.
 *
 * Search is by **event title**, not by the words of the comment: a moderator arrives here from a
 * complaint about an event, and remembers the show — not the sentence.
 */
export default function ReviewReportsScreen() {
  const [draft, setDraft] = useState<{ q: string; status: "" | "open" | "done" }>({
    q: "",
    status: "open",
  });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useAsync(
    () =>
      adminClient.reviewReports({
        q: applied.q || undefined,
        status: applied.status || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    JSON.stringify({ applied, page }),
  );

  const [pending, setPending] = useState<{ id: number; remove: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  const submit = async () => {
    if (!pending) return;
    const text = reason.trim();
    // Removing a comment is a decision somebody may be asked about later, so it carries a written
    // reason into the audit log. Keeping it does not need one.
    if (pending.remove && !text) {
      setFailure("Cần lý do khi xoá bình luận — dòng này được ghi vào nhật ký thao tác.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (pending.remove) await adminClient.resolveReport(pending.id, "remove", text);
      else await adminClient.dismissReport(pending.id, text || undefined);
      setNotice(
        pending.remove
          ? `Đã xoá bình luận và đóng tố cáo #${pending.id}.`
          : `Đã giữ bình luận và đóng tố cáo #${pending.id}.`,
      );
      setPending(null);
      setReason("");
      reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Không xử lý được tố cáo này.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHead
        title="Kiểm duyệt bình luận"
        meta={
          data
            ? `${total} tố cáo khớp bộ lọc · ${data.openCount} chưa xử lý`
            : "Tố cáo bình luận từ trang sự kiện"
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
            onChange={(value) => setDraft({ ...draft, status: value as "" | "open" | "done" })}
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
            {pending.remove ? "Xoá bình luận" : "Giữ bình luận"} · tố cáo #{pending.id}
          </p>
          <p className="font-meta text-body text-ink-soft">
            {pending.remove
              ? "Bình luận được ẩn khỏi trang sự kiện. Không xoá hẳn khỏi cơ sở dữ liệu — tố cáo và nhật ký vẫn phải trỏ được vào nội dung để đối chiếu về sau."
              : "Bình luận giữ nguyên trên trang. Tố cáo đóng lại và không hiện trong hàng chờ nữa."}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={pending.remove ? "Lý do xoá (bắt buộc)" : "Ghi chú (không bắt buộc)"}
              className={`${FIELD} min-w-[280px] flex-1`}
            />
            <button className={ACTION_PRIMARY} onClick={submit} disabled={busy}>
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

      {rows.length === 0 && !loading ? (
        <EmptyState
          text={
            applied.status === "done"
              ? "Chưa có tố cáo bình luận nào được xử lý."
              : "Không có tố cáo bình luận nào đang chờ."
          }
        />
      ) : (
        <>
          <TableScroll>
            <table className="w-full min-w-[900px] text-left text-body">
              <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
                <tr>
                  <Th>Bình luận</Th>
                  <Th>Sự kiện</Th>
                  <Th>Người báo &amp; lý do</Th>
                  <Th>Trạng thái</Th>
                  <Th>Xử lý</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((report: ReviewReportRow) => (
                  <ReportRow
                    key={report.id}
                    report={report}
                    busy={busy}
                    onDecide={(remove) => {
                      setPending({ id: report.id, remove });
                      setReason("");
                      setFailure(null);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </TableScroll>

          <div className="flex items-center justify-between gap-4">
            <span className="font-meta text-body text-ink-soft">
              Trang {page + 1} / {lastPage + 1}
            </span>
            <div className="flex gap-2">
              <button
                className={ACTION_GHOST}
                disabled={page === 0 || loading}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Trước
              </button>
              <button
                className={ACTION_GHOST}
                disabled={page >= lastPage || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Sau
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** One report, with the comment itself in the row — judging it should not need a second screen. */
function ReportRow({
  report,
  busy,
  onDecide,
}: {
  report: ReviewReportRow;
  busy: boolean;
  onDecide: (remove: boolean) => void;
}) {
  const open = report.status === "open";
  return (
    <tr className="border-b border-beige-kem/15">
      <Td>
        <span className="block text-beige-kem">
          {report.reviewBody ? `“${report.reviewBody}”` : "(chỉ chấm sao, không có lời)"}
        </span>
        <span className="mt-1 block font-meta text-meta text-ink-soft">
          {report.authorName ?? "Tài khoản đã xoá"} · {report.reviewRating}★ ·{" "}
          {report.reviewCreatedAt.slice(0, 10)}
          {report.reviewStatus === "removed" && " · đã ẩn"}
        </span>
      </Td>
      <Td>{report.eventTitle}</Td>
      <Td>
        <span className="block text-beige-kem">{report.reason}</span>
        <span className="mt-1 block font-meta text-meta text-ink-soft">
          {report.reporterEmail} · {report.createdAt.slice(0, 10)}
        </span>
      </Td>
      <Td nowrap>
        <Pill tone={open ? "warn" : "neutral"}>{open ? "Chưa xử lý" : "Đã xong"}</Pill>
        {!open && (
          <span className="mt-1 block font-meta text-meta text-ink-soft">
            {report.reviewStatus === "removed" ? "Đã xoá bình luận" : "Giữ bình luận"}
            {report.resolutionNote ? ` · ${report.resolutionNote}` : ""}
          </span>
        )}
      </Td>
      <Td nowrap>
        {open ? (
          <div className="flex flex-wrap gap-2">
            <button className={ACTION_PRIMARY} disabled={busy} onClick={() => onDecide(true)}>
              Xoá bình luận
            </button>
            <button className={ACTION_GHOST} disabled={busy} onClick={() => onDecide(false)}>
              Giữ lại
            </button>
          </div>
        ) : (
          <span className="font-meta text-meta text-ink-soft">
            {report.resolvedAt ? report.resolvedAt.slice(0, 10) : "—"}
          </span>
        )}
      </Td>
    </tr>
  );
}
