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
  Notice,
  PANEL,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import { useAsync } from "../useAsync";

const TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  approved: "good",
  pending: "neutral",
  rejected: "bad",
  suspended: "warn",
};

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

  const organizers = data?.organizers ?? [];

  return (
    <>
      <ScreenHead
        title="Ban tổ chức"
        meta={`${organizers.length} hồ sơ trong hàng chờ`}
        actions={
          <button onClick={reload} className={ACTION_GHOST} disabled={loading}>
            {loading ? "Đang tải…" : "Tải lại"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {pending && (
        <div className={`${PANEL} space-y-3`}>
          <p className="label-eyebrow text-ink-soft">
            {pending.action === "reject" ? "Từ chối hồ sơ" : "Đình chỉ ban tổ chức"} #{pending.id}
          </p>
          <p className="font-meta text-body text-ink-soft">
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
        <EmptyState text="Không có hồ sơ ban tổ chức nào đang chờ." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[720px] text-left text-body">
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
              {organizers.map((organizer) => (
                <tr key={organizer.id} className="border-b border-beige-kem/15">
                  <Td>
                    <span className="font-bold text-beige-kem">{organizer.displayName}</span>
                    {organizer.description && (
                      <span className="block font-meta text-meta text-ink-soft">
                        {organizer.description}
                      </span>
                    )}
                  </Td>
                  <Td nowrap>
                    <Pill tone={TONE[organizer.status] ?? "neutral"}>{organizer.status}</Pill>
                  </Td>
                  <Td>{organizer.reviewNote ?? "—"}</Td>
                  <Td nowrap>{organizer.appliedAt.slice(0, 10)}</Td>
                  <Td nowrap>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={ACTION_PRIMARY}
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
                        className={ACTION_GHOST}
                        disabled={busy}
                        onClick={() => setPending({ id: organizer.id, action: "reject" })}
                      >
                        Từ chối
                      </button>
                      <button
                        className={ACTION_GHOST}
                        disabled={busy}
                        onClick={() => setPending({ id: organizer.id, action: "suspend" })}
                      >
                        Đình chỉ
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
