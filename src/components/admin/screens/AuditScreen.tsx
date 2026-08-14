/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  EmptyState,
  FIELD,
  Notice,
  Pill,
  ScreenHead,
  TableScroll,
  Td,
  Th,
} from "../adminUi";
import { useAsync } from "../useAsync";

const OUTCOME_TONE = { applied: "good", conflict: "warn", rejected: "bad" } as const;

/**
 * Who did what, and whether it took (SEC-09).
 *
 * The log used to sit under a tab called "Phân quyền" beside three static cards describing roles,
 * which is why nobody read it: the screen promised permission management and delivered a list of
 * past actions. It is its own screen now, and filterable — an audit trail you cannot search is a
 * file you keep, not a record you use.
 *
 * Filtering is client-side because the endpoint returns the recent window whole; when the log
 * outgrows that, the filter moves to SQL and this screen keeps its shape.
 */
export default function AuditScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.auditLogs(), "audit");
  const [needle, setNeedle] = useState("");

  const rows = (data ?? []).filter((log) => {
    if (!needle.trim()) return true;
    const text = needle.trim().toLowerCase();
    return (
      log.action.toLowerCase().includes(text) ||
      log.targetType.toLowerCase().includes(text) ||
      String(log.targetId ?? "").includes(text) ||
      String(log.actorUserId).includes(text)
    );
  });

  return (
    <>
      <ScreenHead
        title="Nhật ký thao tác"
        meta={`${rows.length} dòng${needle ? " khớp bộ lọc" : ""}`}
        actions={
          <button onClick={reload} className={ACTION_GHOST} disabled={loading}>
            {loading ? "Đang tải…" : "Tải lại"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      <input
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
        placeholder="Lọc theo hành động, đối tượng hoặc mã người thao tác"
        className={`${FIELD} w-full`}
      />

      {rows.length === 0 && !loading ? (
        <EmptyState text="Chưa có thao tác nào được ghi." />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[720px] text-left text-body">
            <thead className="label-eyebrow border-b border-beige-kem/25 text-ink-soft">
              <tr>
                <Th>Thời điểm</Th>
                <Th>Người thao tác</Th>
                <Th>Hành động</Th>
                <Th>Đối tượng</Th>
                <Th>Kết quả</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => (
                <tr key={log.id} className="border-b border-beige-kem/15">
                  <Td nowrap>{log.createdAt.slice(0, 16).replace("T", " ")}</Td>
                  <Td nowrap>#{log.actorUserId}</Td>
                  <Td>
                    <span className="font-meta">{log.action}</span>
                  </Td>
                  <Td nowrap>
                    {log.targetType} #{log.targetId ?? "—"}
                  </Td>
                  <Td nowrap>
                    <Pill tone={OUTCOME_TONE[log.outcome] ?? "neutral"}>{log.outcome}</Pill>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      <p className="font-meta text-body text-ink-soft">
        Nhật ký chỉ đọc. Quyền hạn do máy chủ thực thi; PostgreSQL chặn sửa/xoá các dòng này.
      </p>
    </>
  );
}
