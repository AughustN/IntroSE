/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { FeaturedEvent, FeaturedEventInput } from "@shared/admin/types.js";
import { adminClient } from "../../../services/adminClient";
import {
  ACTION_GHOST,
  ACTION_PRIMARY,
  EmptyState,
  FIELD,
  Notice,
  PANEL,
  ScreenHead,
} from "../adminUi";
import { useAsync } from "../useAsync";

/**
 * What the home page leads with (UC-35).
 *
 * The order is edited as a draft and saved in one press, because the endpoint replaces the whole
 * list: saving each nudge separately would publish half-orders to the home page while an admin was
 * still deciding.
 */
export default function FeaturedScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.featured(), "featured");
  const [draft, setDraft] = useState<FeaturedEventInput[]>([]);
  const [newId, setNewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The saved list seeds the draft once it arrives, and again after each save — the server decides
  // the final ordering, so what comes back is what the next edit starts from.
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(data.map((row) => ({ eventId: row.eventId, displayOrder: row.displayOrder })));
  }, [data]);

  const titleOf = (eventId: number) =>
    (data ?? []).find((row: FeaturedEvent) => row.eventId === eventId)?.title ??
    `Sự kiện #${eventId}`;

  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next.map((row, position) => ({ ...row, displayOrder: position })));
  };

  const dirty =
    data !== null &&
    JSON.stringify(draft) !==
      JSON.stringify(data.map((row) => ({ eventId: row.eventId, displayOrder: row.displayOrder })));

  return (
    <>
      <ScreenHead
        title="Trang chủ nổi bật"
        meta={`${draft.length} sự kiện trên băng đầu trang chủ`}
        actions={
          <button
            className={ACTION_PRIMARY}
            disabled={busy || !dirty}
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              try {
                await adminClient.replaceFeatured(draft);
                setNotice("Đã cập nhật sự kiện nổi bật.");
                reload();
              } catch (cause) {
                setFailure(cause instanceof Error ? cause.message : "Không lưu được.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang lưu…" : dirty ? "Lưu thứ tự" : "Đã lưu"}
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {notice && !dirty && <Notice tone="ok">{notice}</Notice>}

      <div className={`${PANEL} flex flex-wrap items-end gap-3`}>
        <label className="space-y-1">
          <span className="label-eyebrow block text-ink-soft">Thêm theo mã sự kiện</span>
          <input
            type="number"
            value={newId}
            onChange={(event) => setNewId(event.target.value)}
            placeholder="Event ID"
            className={`${FIELD} w-40`}
          />
        </label>
        <button
          className={ACTION_GHOST}
          onClick={() => {
            const id = Number(newId);
            if (!Number.isInteger(id) || id < 1) return;
            if (draft.some((row) => row.eventId === id)) {
              setFailure("Sự kiện này đã có trong danh sách.");
              return;
            }
            setDraft([...draft, { eventId: id, displayOrder: draft.length }]);
            setNewId("");
            setFailure(null);
          }}
        >
          Thêm
        </button>
      </div>

      {draft.length === 0 && !loading ? (
        <EmptyState text="Chưa có sự kiện nổi bật nào." />
      ) : (
        <div className="space-y-2">
          {draft.map((row, index) => (
            <div
              key={row.eventId}
              className={`${PANEL} flex items-center justify-between gap-3 py-3`}
            >
              <div className="flex items-center gap-3">
                <span className="label-eyebrow tabular-nums text-ink-soft">#{index + 1}</span>
                <span className="text-beige-kem">{titleOf(row.eventId)}</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Đưa lên trên"
                  className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === draft.length - 1}
                  aria-label="Đưa xuống dưới"
                  className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:opacity-30"
                >
                  ▼
                </button>
                <button
                  onClick={() =>
                    setDraft(
                      draft
                        .filter((item) => item.eventId !== row.eventId)
                        .map((item, position) => ({ ...item, displayOrder: position })),
                    )
                  }
                  aria-label="Bỏ khỏi danh sách"
                  className="label-eyebrow px-2 py-1 text-burgundy-ink transition hover:text-beige-kem"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
