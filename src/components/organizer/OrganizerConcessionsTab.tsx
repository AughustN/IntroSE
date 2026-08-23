/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { Popcorn } from "lucide-react";
import type { ConcessionItem } from "@/shared/types/fnb";
import { organizerApi } from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";

const input =
  "h-10 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const label = "mb-1 block font-mono text-[11px] text-beige-kem/70";
const btn =
  " bg-burgundy px-4 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost = " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

/**
 * What an organizer types a price into. Digits only — the đồng signs are decoration the
 * component adds back on every keystroke, so `15.000đ` and `15000` both land as 15000.
 */
function parseVnd(text: string): number {
  return Number(text.replace(/\D/g, "")) || 0;
}

/**
 * One event's snack menu (014 US2), managed inside its editor page.
 *
 * The rules the UI keeps are exactly the server's, restated where they bite:
 * edits touch only future purchases; stopping hides the item from buyers at once but keeps it
 * listed here so it can come back; and delete is offered only to ask the server — which refuses
 * with `concession_in_use` the moment any cart or order has touched the item, and this screen
 * relays that refusal instead of pretending the row went away.
 */
export default function OrganizerConcessionsTab({ eventId }: { eventId: number }) {
  const [items, setItems] = useState<ConcessionItem[] | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    organizerApi
      .concessions(eventId)
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems(null));
    return () => {
      alive = false;
    };
  }, [eventId]);

  useEffect(() => load(), [load]);

  const openCreate = () => {
    setEditingId(0); // 0 = creating; a real id = editing that row
    setFormLabel("");
    setFormDescription("");
    setFormPrice("");
    setRefusal(null);
  };

  const openEdit = (item: ConcessionItem) => {
    setEditingId(item.id);
    setFormLabel(item.label);
    setFormDescription(item.description ?? "");
    setFormPrice(String(item.priceAmount));
    setRefusal(null);
  };

  const closeForm = () => setEditingId(null);

  const submit = async () => {
    if (!formLabel.trim()) return;
    setBusy(true);
    setRefusal(null);
    try {
      const body = {
        label: formLabel.trim(),
        description: formDescription.trim() || null,
        priceAmount: parseVnd(formPrice),
      };
      if (editingId === 0) await organizerApi.createConcession(eventId, body);
      else await organizerApi.updateConcession(eventId, editingId!, body);
      closeForm();
      load();
    } catch (e) {
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleState = async (item: ConcessionItem) => {
    setBusy(true);
    setRefusal(null);
    try {
      await organizerApi.setConcessionState(
        eventId,
        item.id,
        item.state === "listed" ? "stopped" : "listed",
      );
      load();
    } catch (e) {
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: ConcessionItem) => {
    if (
      !window.confirm(
        `Xoá vĩnh viễn món “${item.label}”? Chỉ xoá được khi chưa có ai đặt món này.`,
      )
    )
      return;
    setBusy(true);
    setRefusal(null);
    try {
      await organizerApi.removeConcession(eventId, item.id);
      load();
    } catch (e) {
      // The server's refusal already names the way out (ngừng bán) — show it verbatim.
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const formOpen = editingId !== null;

  return (
    <div className="border-2 border-beige-kem bg-surface-2 p-5">
      <div className="mb-3 flex items-center gap-3">
        <Popcorn aria-hidden="true" className="h-5 w-5 text-beige-kem" />
        <h3 className="font-display text-base font-bold">Bắp nước & đồ uống</h3>
        <button onClick={openCreate} disabled={formOpen} className={`${ghost} ml-auto`}>
          + Thêm món
        </button>
      </div>
      <p className="mb-4 font-mono text-[11px] leading-5 text-beige-kem/60">
        Menu áp dụng cho mọi suất của sự kiện. Sửa giá chỉ ảnh hưởng lượt mua sau; món đã nằm trong
        giỏ hoặc đơn hàng không thể xoá — hãy dùng “Ngừng bán”.
      </p>

      {items === null ? (
        <p className="font-mono text-[11px] text-beige-kem/50">Không tải được menu.</p>
      ) : items.length === 0 && !formOpen ? (
        <p className="font-mono text-[11px] text-beige-kem/50">
          Chưa có món nào. Thêm bắp nước để bán kèm vé tại trang thanh toán.
        </p>
      ) : (
        <ul className="divide-y divide-beige-kem/20">
          {(items ?? []).map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-40 flex-1">
                <p className="font-mono text-sm text-beige-kem">{item.label}</p>
                {item.description && (
                  <p className="font-mono text-[11px] text-beige-kem/60">{item.description}</p>
                )}
              </div>
              <span className="font-mono text-sm tabular-nums text-beige-kem">
                {formatVnd(item.priceAmount)}
              </span>
              <span
                className={`font-mono text-[10px] ${
                  item.state === "listed" ? "text-la-co" : "text-cam-dat"
                }`}
              >
                {item.state === "listed" ? "Đang bán" : "Ngừng bán"}
              </span>
              <div className="flex gap-2">
                <button onClick={() => openEdit(item)} disabled={busy} className={ghost}>
                  Sửa
                </button>
                <button onClick={() => toggleState(item)} disabled={busy} className={ghost}>
                  {item.state === "listed" ? "Ngừng bán" : "Bán lại"}
                </button>
                <button
                  onClick={() => remove(item)}
                  disabled={busy}
                  className={`${ghost} border-burgundy text-burgundy`}
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <div className="mt-4 space-y-3 border-2 border-beige-kem/40 p-4">
          <label className="block">
            <span className={label}>Tên món</span>
            <input
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              maxLength={120}
              placeholder="Bắp rang bơ"
              className={input}
            />
          </label>
          <label className="block">
            <span className={label}>Mô tả ngắn (không bắt buộc)</span>
            <input
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              maxLength={300}
              placeholder="Hộp vừa, vị bơ"
              className={input}
            />
          </label>
          <label className="block">
            <span className={label}>Giá (đồng)</span>
            <input
              value={formatVnd(parseVnd(formPrice))}
              onChange={(e) => setFormPrice(e.target.value)}
              inputMode="numeric"
              placeholder="50.000đ"
              className={input}
            />
          </label>
          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={busy || !formLabel.trim()}
              className={btn}
            >
              {editingId === 0 ? "Thêm món" : "Lưu thay đổi"}
            </button>
            <button onClick={closeForm} disabled={busy} className={ghost}>
              Huỷ
            </button>
          </div>
          <p className="font-mono text-[10px] text-beige-kem/50">
            Giá phải là số nguyên đồng, không âm.
          </p>
        </div>
      )}

      {refusal && <p className="mt-3 font-mono text-[11px] text-burgundy">{refusal}</p>}
    </div>
  );
}
