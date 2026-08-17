/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { AdminCategory } from "@shared/admin/types.js";
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
 * The catalogue's categories (UC-35).
 *
 * Renaming happens in the row rather than in a `window.prompt`, which is what it used to use: a
 * prompt cannot show the code the label belongs to, and the code is the thing that must not be
 * confused with the label — the label is what a reader sees, the code is what every event row
 * points at.
 */
export default function CategoriesScreen() {
  const { data, error, loading, reload } = useAsync(() => adminClient.categories(), "categories");
  const [vi, setVi] = useState("");
  const [en, setEn] = useState("");
  const [editing, setEditing] = useState<{ id: number; vi: string; en: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setNotice(done);
      reload();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  };

  const categories = data ?? [];

  return (
    <>
      <ScreenHead title="Danh mục" meta={`${categories.length} danh mục đang dùng`} />

      {error && <Notice tone="error">{error}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <div className={`${PANEL} space-y-3`}>
        <p className="label-eyebrow text-ink-soft">Tạo danh mục mới</p>
        <div className="flex flex-wrap gap-3">
          <input
            value={vi}
            onChange={(event) => setVi(event.target.value)}
            placeholder="Tên tiếng Việt *"
            className={`${FIELD} min-w-[180px] flex-1`}
          />
          <input
            value={en}
            onChange={(event) => setEn(event.target.value)}
            placeholder="Tên tiếng Anh (tuỳ chọn)"
            className={`${FIELD} min-w-[180px] flex-1`}
          />
          <button
            className={ACTION_PRIMARY}
            disabled={busy || !vi.trim()}
            onClick={() =>
              void run(async () => {
                await adminClient.createCategory({
                  labelVi: vi.trim(),
                  labelEn: en.trim() || null,
                });
                setVi("");
                setEn("");
              }, "Đã tạo danh mục.")
            }
          >
            Tạo
          </button>
        </div>
      </div>

      {categories.length === 0 && !loading ? (
        <EmptyState text="Chưa có danh mục nào." />
      ) : (
        <div className="space-y-3">
          {categories.map((category: AdminCategory) =>
            editing?.id === category.id ? (
              <div key={category.id} className={`${PANEL} flex flex-wrap items-center gap-3`}>
                <input
                  autoFocus
                  value={editing.vi}
                  onChange={(event) => setEditing({ ...editing, vi: event.target.value })}
                  className={`${FIELD} min-w-[160px] flex-1`}
                />
                <input
                  value={editing.en}
                  onChange={(event) => setEditing({ ...editing, en: event.target.value })}
                  placeholder="Tên tiếng Anh"
                  className={`${FIELD} min-w-[160px] flex-1`}
                />
                <button
                  className={ACTION_PRIMARY}
                  disabled={busy || !editing.vi.trim()}
                  onClick={() =>
                    void run(async () => {
                      await adminClient.renameCategory(category.id, {
                        labelVi: editing.vi.trim(),
                        labelEn: editing.en.trim() || null,
                      });
                      setEditing(null);
                    }, "Đã đổi tên danh mục.")
                  }
                >
                  Lưu
                </button>
                <button className={ACTION_GHOST} onClick={() => setEditing(null)}>
                  Huỷ
                </button>
              </div>
            ) : (
              <div
                key={category.id}
                className={`${PANEL} flex flex-wrap items-center justify-between gap-3`}
              >
                <div>
                  <p className="font-bold text-beige-kem">
                    {category.labelVi}
                    {category.labelEn && (
                      <span className="ml-2 font-meta text-eyebrow text-ink-soft">
                        ({category.labelEn})
                      </span>
                    )}
                  </p>
                  <p className="font-meta text-eyebrow text-ink-soft">{category.code}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={ACTION_GHOST}
                    onClick={() =>
                      setEditing({
                        id: category.id,
                        vi: category.labelVi,
                        en: category.labelEn ?? "",
                      })
                    }
                  >
                    Đổi tên
                  </button>
                  <button
                    className={ACTION_GHOST}
                    disabled={busy}
                    onClick={() => {
                      // Deleting is refused by the server while events still point at the category,
                      // so this warns rather than promises.
                      if (!window.confirm(`Xoá danh mục “${category.labelVi}”?`)) return;
                      void run(() => adminClient.deleteCategory(category.id), "Đã xoá danh mục.");
                    }}
                  >
                    Xoá
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
