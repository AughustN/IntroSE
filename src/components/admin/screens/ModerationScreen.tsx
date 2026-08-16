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
  Notice,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import { useAsync } from "../useAsync";

const EVENT_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Bản nháp", tone: "neutral" },
  on_sale: { label: "Đang mở bán", tone: "good" },
  finished: { label: "Đã kết thúc", tone: "neutral" },
  cancelled: { label: "Đã hủy", tone: "bad" },
};

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

  const queue = (data?.events ?? []).filter((event) => event.moderation === "pending_review");

  return (
    <>
      <ScreenHead
        title="Hàng chờ sự kiện"
        meta={`${queue.length} sự kiện đang chờ quyết định`}
        actions={
          <button onClick={reload} className={ACTION_GHOST} disabled={loading}>
            {loading ? "Đang tải…" : "Tải lại"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {queue.length === 0 && !loading ? (
        <EmptyState text="Không có sự kiện nào đang chờ duyệt." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[760px] text-left text-body">
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
              {queue.map((event) => (
                <tr key={event.id} className="border-b border-beige-kem/15">
                  <Td>
                    <span className="font-bold text-beige-kem">{event.title}</span>
                    <span className="block font-meta text-meta text-ink-soft">/{event.slug}</span>
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
                      className={ACTION_PRIMARY}
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
    </>
  );
}
