/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { isMaterialEdit } from "@/shared/catalog/material-edit";
import { MyEvent, MyVenue, organizerApi, studioApi } from "../../services/catalogClient";
import { useEventCategories } from "../../hooks/useEventCategories";
import AiListingPanel from "./AiListingPanel";
import ShowtimeList from "./ShowtimeList";
import { Refusal } from "./states";

const input =
  "h-10 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const label = "mb-1 block font-mono text-[11px] text-beige-kem/70";
const btn =
  " bg-burgundy px-4 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost = " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80";

/**
 * Level 2 of the console: one event.
 *
 * The confirmation before a material edit (FR-042) is the piece worth reading. It fires on
 * `isMaterialEdit` from the SHARED module — the same function the server's moderation guard uses — so
 * the warning an organizer sees and the decision the server makes cannot drift apart (R-9). Deriving
 * the rule locally would be a small copy, which is exactly what makes it dangerous.
 */
export default function EventEditor({
  event,
  venues,
  onBack,
  onRefresh,
  onOpenSeatMap,
}: {
  event: MyEvent;
  venues: MyVenue[];
  onBack: () => void;
  onRefresh: () => void;
  /** Hand off to feature 005's designer — seat geometry is not this feature's business. */
  onOpenSeatMap: (eventId: number) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState("");
  const [categoryCode, setCategoryCode] = useState(event.category);
  const [isHighDemand, setIsHighDemand] = useState(event.isHighDemand ?? false);
  const categories = useEventCategories();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** An approved, on-sale event is the only one a save can pull out of the public catalog. */
  const isLive = event.moderation === "approved" && event.status === "on_sale";

  /**
   * Submitting for review, and withdrawing.
   *
   * The console shipped without either: the server route, the API client method and even the hint
   * "Thêm suất chiếu để có thể gửi duyệt" all existed, but nothing called them — so an organizer
   * could build a whole event and had no way to put it in front of an admin, which left every event
   * stranded in draft forever.
   *
   * Publishing is a REQUEST, not a state change the organizer controls: it moves the event to
   * pending review, and an admin decides. The button says so, because "Phát hành" would promise
   * something this action cannot deliver.
   */
  const onSale = event.status === "on_sale";

  const submitForReview = async () => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      await organizerApi.publish(event.id);
      setNotice("Đã gửi duyệt. Sự kiện sẽ hiển thị sau khi admin duyệt.");
      onRefresh();
    } catch (e) {
      // The server refuses with `needs_showtime_and_tier` when there is nothing sellable yet; its
      // message already names the missing piece, so it is shown rather than replaced.
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      await organizerApi.unpublish(event.id);
      setNotice("Đã ngừng bán. Sự kiện không còn hiển thị công khai.");
      onRefresh();
    } catch (e) {
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changedFields = () => {
    const fields: string[] = [];
    if (title !== event.title) fields.push("event.title");
    if (description.trim()) fields.push("event.description");
    if (categoryCode !== event.category) fields.push("event.category");
    if (isHighDemand !== (event.isHighDemand ?? false)) fields.push("event.isHighDemand");
    return fields;
  };

  const save = async () => {
    const fields = changedFields();
    if (fields.length === 0) return;

    // FR-042: tell the organizer BEFORE the event leaves the catalog, not after they notice.
    if (isLive && isMaterialEdit(fields)) {
      const ok = window.confirm(
        "Lưu thay đổi này sẽ đưa sự kiện về trạng thái chờ duyệt lại và tạm ẩn khỏi trang công khai " +
          "cho đến khi quản trị viên duyệt lại.\n\nVé đã bán và vé đang giữ không bị ảnh hưởng.\n\nTiếp tục?",
      );
      if (!ok) return;
    }

    setBusy(true);
    setRefusal(null);
    setNotice(null);
    try {
      const res = await studioApi.updateEvent(event.id, {
        title: title !== event.title ? title : undefined,
        description: description.trim() ? description.trim() : undefined,
        categoryCode: categoryCode !== event.category ? categoryCode : undefined,
        isHighDemand: isHighDemand !== (event.isHighDemand ?? false) ? isHighDemand : undefined,
      });
      setNotice(
        res.returnedToReview
          ? "Đã lưu. Sự kiện đang chờ duyệt lại và tạm ẩn khỏi trang công khai."
          : "Đã lưu thay đổi.",
      );
      setDescription("");
      onRefresh();
    } catch (e) {
      // The organizer's typing is deliberately NOT cleared on a refusal (FR-041).
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={ghost}>
          ← Danh sách sự kiện
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {event.eventType === "seated" && (
            <button onClick={() => onOpenSeatMap(event.id)} className={ghost}>
              Sơ đồ ghế
            </button>
          )}
          {onSale ? (
            <button onClick={withdraw} disabled={busy} className={ghost}>
              Ngừng bán
            </button>
          ) : (
            <button onClick={submitForReview} disabled={busy} className={btn}>
              Gửi duyệt
            </button>
          )}
          {isLive ? (
            <span className="font-mono text-[10px] text-la-co">Đang hiển thị công khai</span>
          ) : (
            onSale && (
              <span className="font-mono text-[10px] text-cam-dat">Đang chờ admin duyệt</span>
            )
          )}
        </div>
      </div>

      <div className="border-2 border-beige-kem bg-surface-2 p-5">
        <h3 className="mb-3 font-display text-lg font-bold">{event.title}</h3>

        <label className="block">
          <span className={label}>Tiêu đề</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>

        <label className="mt-3 block">
          <span className={label}>Mô tả (để trống nếu không đổi)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`${input} h-auto py-2`}
          />
        </label>

        <label className="mt-3 block">
          <span className={label}>Danh mục</span>
          <select
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value)}
            className={input}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code} className="bg-xanh-pho">
                {c.labelVi}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isHighDemand}
            onChange={(e) => setIsHighDemand(e.target.checked)}
            className="h-4 w-4 rounded border-beige-kem/60 accent-burgundy"
          />
          <span className="font-mono text-xs text-beige-kem">
            🛡️ Phòng Chờ Vé Hot - Bảo Vệ Chống Bot
          </span>
        </label>

        {isLive && changedFields().length > 0 && isMaterialEdit(changedFields()) && (
          <p className="mt-3 font-mono text-[11px] text-cam-dat">
            Thay đổi này cần duyệt lại: sự kiện sẽ tạm ẩn khỏi trang công khai cho đến khi được
            duyệt.
          </p>
        )}

        <button
          onClick={save}
          disabled={busy || changedFields().length === 0}
          className={`${btn} mt-4`}
        >
          Lưu thay đổi
        </button>

        {notice && <p className="mt-3 font-mono text-[11px] text-la-co">{notice}</p>}
        <Refusal message={refusal} />
      </div>

      {/* Never on a critical path: the whole editor above works with this panel broken (FR-029). */}
      <AiListingPanel
        eventId={isLive ? undefined : event.id}
        onAccept={(field, value) => (field === "title" ? setTitle(value) : setDescription(value))}
      />

      <div className="border-2 border-beige-kem bg-surface-2 p-5">
        <h3 className="mb-3 font-display text-base font-bold">Suất chiếu</h3>
        <ShowtimeList eventId={event.id} venues={venues} onChanged={() => onRefresh()} />
      </div>
    </div>
  );
}
