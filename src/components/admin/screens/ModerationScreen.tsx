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
import Select from "../../Select";
import { useAsync } from "../useAsync";

type Decision = "flag" | "remove";

const DECISION_LABEL: Record<Decision, string> = {
  flag: "Gắn cờ",
  remove: "Gỡ",
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

const MODERATION_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "approved", label: "Đã duyệt" },
  { value: "flagged", label: "Đã gắn cờ" },
  { value: "removed", label: "Đã gỡ" },
] as const;

/**
 * Two lists, two jobs (UC-34).
 *
 * The queue is the approval inbox and nothing else — a decision is a single press. What has been
 * approved lives below it: there the work is watching and taking down (flag, remove), never
 * approving again. Both read the one moderation payload, so a reload after any decision keeps the
 * two lists consistent with each other.
 */
export default function ModerationScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.queue(), "queue");
  const [pending, setPending] = useState<{ id: number; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [moderationFilter, setModerationFilter] = useState<string>("");

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
    }[decision];
    void run(call, `Đã ${DECISION_LABEL[decision].toLowerCase()} sự kiện #${id}.`);
  };

  const queue = (data?.events ?? []).filter((event) => event.moderation === "pending_review");
  const approved = (data?.approvedEvents ?? []).filter(
    (event) => !moderationFilter || event.moderation === moderationFilter,
  );

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

      {pending && (
        <div className={`${PANEL} space-y-3`}>
          <p className="label-eyebrow text-ink-soft">
            {DECISION_LABEL[pending.decision]} sự kiện #{pending.id}
          </p>
          <p className="font-meta text-body text-ink-soft">
            {pending.decision === "remove"
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
                      onClick={() =>
                        void run(
                          () => adminClient.approveEvent(event.id),
                          `Đã duyệt “${event.title}”.`,
                        )
                      }
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

      <ScreenHead
        title="Danh sách sự kiện"
        meta={`${approved.length} sự kiện đã qua kiểm duyệt`}
        actions={
          <div className="w-44">
            <Select
              label="Kiểm duyệt"
              value={moderationFilter}
              options={MODERATION_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={setModerationFilter}
              triggerClassName={`${FIELD} w-full justify-between`}
            />
          </div>
        }
      />

      {approved.length === 0 && !loading ? (
        <EmptyState text="Chưa có sự kiện nào khớp bộ lọc." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[820px] text-left text-body">
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
              {approved.map((event) => (
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
                    <Pill tone={MODERATION_TONE[event.moderation] ?? "neutral"}>
                      {MODERATION_LABEL[event.moderation] ?? event.moderation}
                    </Pill>
                  </Td>
                  <Td>{event.reviewNote ?? "—"}</Td>
                  <Td nowrap>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={ACTION_GHOST}
                        disabled={busy}
                        onClick={() => {
                          setPending({ id: event.id, decision: "flag" });
                          setReason("");
                          setFailure(null);
                        }}
                      >
                        Gắn cờ
                      </button>
                      <button
                        className={ACTION_GHOST}
                        disabled={busy}
                        onClick={() => {
                          setPending({ id: event.id, decision: "remove" });
                          setReason("");
                          setFailure(null);
                        }}
                      >
                        Gỡ
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
