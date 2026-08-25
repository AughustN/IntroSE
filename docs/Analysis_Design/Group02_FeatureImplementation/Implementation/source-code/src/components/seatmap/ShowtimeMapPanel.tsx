/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ApplyPreview } from "@/shared/catalog/seatmap";
import { layoutApi } from "../../services/catalogClient";

/**
 * The inventory-aware actions on a showtime that already has a generated map (FR-027a, FR-033, FR-034).
 *
 * Re-apply is deliberately two steps: the organizer sees exactly what would change and what would be
 * refused, and nothing runs until they confirm. The preview is advisory — the server re-checks inside
 * the transaction, so a sale or hold landing in between refuses the whole apply rather than being
 * overwritten.
 */

const btn = "rounded-lg border-2 border-beige-kem px-2.5 py-1.5 text-xs font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";
const primary = "rounded-lg bg-burgundy px-3 py-1.5 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-40";

const KIND_LABEL: Record<string, string> = {
  add: "Thêm",
  move: "Dời chỗ",
  relabel: "Đổi nhãn",
  retier: "Đổi hạng vé",
  remove: "Xoá",
};

export default function ShowtimeMapPanel({
  showtimeId,
  tiers,
  onDone,
}: {
  showtimeId: number;
  tiers: { id: number; label: string; price: number }[];
  onDone?: () => void;
}) {
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [tierId, setTierId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Refusals arrive as a structured list on the 409 body, so we can name the seats (FR-029). */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ids = () =>
    selectionText
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

  return (
    <div className="space-y-3 rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">Sơ đồ của suất chiếu</h3>

      {error && <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs text-on-tint">{error}</div>}
      {notice && <div className="rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">{notice}</div>}

      {/* --- Re-apply, previewed (FR-027a) --- */}
      <div className="flex flex-wrap gap-2">
        <button
          className={btn}
          disabled={busy}
          onClick={() => run(async () => setPreview(await layoutApi.reapplyPreview(showtimeId)))}
        >
          Xem trước áp dụng lại
        </button>
        <button
          className={primary}
          disabled={busy || !preview?.wouldSucceed}
          onClick={() =>
            run(async () => {
              await layoutApi.reapply(showtimeId);
              setPreview(null);
              setNotice("Đã áp dụng lại bố cục cho suất chiếu này.");
              onDone?.();
            })
          }
        >
          Xác nhận áp dụng
        </button>
      </div>

      {preview && (
        <div className="rounded-xl border-2 border-beige-kem/40 p-3">
          <p className="font-mono text-[11px] text-beige-kem/60">
            {preview.changes.length} thay đổi · {preview.refusals.length} bị từ chối
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-beige-kem/80">
            {preview.changes.map((c, i) => (
              <li key={`c${i}`}>
                <span className="font-bold">{KIND_LABEL[c.kind] ?? c.kind}</span> — {c.seatLabel}
              </li>
            ))}
            {preview.refusals.map((r, i) => (
              <li key={`r${i}`} className="text-on-tint">
                ✕ {r.message}
              </li>
            ))}
          </ul>
          {!preview.wouldSucceed && (
            <p className="mt-2 text-[11px] text-beige-kem/60">
              Không thể áp dụng khi còn ghế bị từ chối — sơ đồ sẽ được giữ nguyên.
            </p>
          )}
        </div>
      )}

      {/* --- Block / unblock and marquee tier assignment (FR-033, FR-034) --- */}
      <label className="block font-mono text-[10px] text-beige-kem/60">
        Mã ghế đã chọn (cách nhau bằng dấu phẩy)
        <input
          value={selectionText}
          onChange={(e) => setSelectionText(e.target.value)}
          placeholder="VD 1201, 1202, 1203"
          className="mt-1 h-9 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-xs text-beige-kem outline-none focus:border-burgundy"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={busy || ids().length === 0}
          onClick={() => run(async () => { await layoutApi.blockSeats(showtimeId, ids(), true); setNotice("Đã khoá ghế."); onDone?.(); })}>
          Khoá ghế
        </button>
        <button className={btn} disabled={busy || ids().length === 0}
          onClick={() => run(async () => { await layoutApi.blockSeats(showtimeId, ids(), false); setNotice("Đã mở khoá ghế."); onDone?.(); })}>
          Mở khoá
        </button>

        <select
          value={tierId}
          onChange={(e) => setTierId(Number(e.target.value) || "")}
          className="h-9 rounded-lg border-2 border-beige-kem bg-surface-2 px-2 text-xs text-beige-kem outline-none"
        >
          <option value="" className="bg-xanh-pho">Hạng vé</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id} className="bg-xanh-pho">
              {t.label} — {t.price.toLocaleString("vi-VN")}đ
            </option>
          ))}
        </select>
        <button className={btn} disabled={busy || ids().length === 0 || tierId === ""}
          onClick={() => run(async () => { await layoutApi.assignTier(showtimeId, ids(), Number(tierId)); setNotice("Đã gán hạng vé."); onDone?.(); })}>
          Gán hạng vé
        </button>
      </div>

      <p className="text-[10px] leading-4 text-beige-kem/45">
        Ghế đã bán chỉ đổi được vị trí hiển thị; ghế đang được khách giữ thì không đổi được gì cho tới
        khi lượt giữ hết hạn. Mọi thay đổi bị từ chối sẽ giữ nguyên toàn bộ sơ đồ.
      </p>
    </div>
  );
}
