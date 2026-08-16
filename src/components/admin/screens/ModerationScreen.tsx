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

type Decision = "reject" | "flag" | "remove";

const DECISION_LABEL: Record<Decision, string> = {
  reject: "Từ chối",
  flag: "Gắn cờ",
  remove: "Gỡ",
};

const EVENT_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Bản nháp", tone: "neutral" },
  on_sale: { label: "Đang mở bán", tone: "good" },
  finished: { label: "Đã kết thúc", tone: "neutral" },
  cancelled: { label: "Đã hủy", tone: "bad" },
};

/**
 * Events waiting for a decision (UC-34).
 *
 * Approving is one press; the three refusals are not. Each of them puts a reason on the event that
 * the organizer reads, so the reason is typed into the page rather than into a `window.prompt` —
 * the prompt cannot be corrected, cannot be cancelled halfway, and gave no room to say what the
 * refusal will do.
 */
export default function ModerationScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.queue(), "queue");
  const [pending, setPending] = useState<{ id: number; decision: Decision } | null>(null);
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

  const submitDecision = () => {
    if (!pending) return;
    const { id, decision } = pending;
    const text = reason.trim();
    if ((decision === "reject" || decision === "remove") && !text) {
      setFailure(
        decision === "remove"
          ? "Gỡ vì vi phạm phải kèm lý do — thao tác này sẽ huỷ suất tương lai, void vé và hoàn tiền vào ví người mua."
          : "Từ chối phải kèm lý do — ban tổ chức sẽ đọc dòng này.",
      );
      return;
    }
    const call = {
      reject: () => adminClient.rejectEvent(id, text),
      flag: () => adminClient.flagEvent(id, text || undefined),
      remove: () => adminClient.removeEvent(id, text),
    }[decision];
    void run(call, `Đã ${DECISION_LABEL[decision].toLowerCase()} sự kiện #${id}.`);
  };

  // The shared moderation payload also retains flagged and removed events for the report and audit
  // workflows. This screen is specifically the approval inbox, so only a pending review belongs here.
  const events = (data?.events ?? []).filter((event) => event.moderation === "pending_review");

  return (
    <>
      <ScreenHead
        title="Hàng chờ sự kiện"
        meta={`${events.length} sự kiện đang chờ quyết định`}
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
            {DECISION_LABEL[pending.decision]} sự kiện #{pending.id}
          </p>
          <p className="font-meta text-body text-ink-soft">
            {pending.decision === "reject"
              ? "Lý do bắt buộc. Ban tổ chức nhận đúng dòng này và sửa theo nó."
              : pending.decision === "remove"
                ? "Lý do bắt buộc. Thao tác này sẽ huỷ suất tương lai, void vé và hoàn tiền vào ví người mua."
                : "Lý do không bắt buộc, nhưng nếu có thì được lưu vào nhật ký thao tác."}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ví dụ: ảnh bìa vi phạm bản quyền"
              className={`${FIELD} min-w-[280px] flex-1`}
            />
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

      {events.length === 0 && !loading ? (
        <EmptyState text="Không có sự kiện nào đang chờ duyệt." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[760px] text-left text-body">
            <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
              <tr>
                <Th>Sự kiện</Th>
                <Th>Ban tổ chức</Th>
                <Th>Trạng thái sự kiện</Th>
                <Th>Kiểm duyệt</Th>
                <Th>Ghi chú</Th>
                <Th>Quyết định</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
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
                  <Td nowrap>
                    <Pill tone="warn">
                      Chờ duyệt
                    </Pill>
                  </Td>
                  <Td>{event.reviewNote ?? "—"}</Td>
                  <Td nowrap>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={ACTION_PRIMARY}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => adminClient.approveEvent(event.id),
                            `Đã duyệt “${event.title}”.`,
                          )
                        }
                      >
                        Duyệt
                      </button>
                      {(["reject", "flag", "remove"] as Decision[]).map((decision) => (
                        <button
                          key={decision}
                          className={ACTION_GHOST}
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
