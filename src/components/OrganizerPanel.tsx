/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pathToRoute, screenToPath } from "../routes";
import { organizerApi } from "../services/catalogClient";
import { useEventCategories } from "../hooks/useEventCategories";
import OrganizerConsole from "./organizer/OrganizerConsole";
import { Refusal } from "./organizer/states";
import SeatMapBuilder from "./SeatMapBuilder";

const input =
  "h-11 w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 text-sm text-beige-kem outline-none focus:border-burgundy";
const label = "mb-1.5 block font-mono text-xs text-beige-kem/70";
const card = "rounded-2xl border-2 border-beige-kem bg-surface-2 p-5";
const btn =
  "rounded-xl bg-burgundy px-4 py-2.5 text-sm font-black text-white transition hover:brightness-95 disabled:opacity-60";
const ghost =
  "rounded-xl border-2 border-beige-kem px-3 py-2 text-xs font-bold text-beige-kem/80 transition";

/**
 * The organizer console entry point (feature 006).
 *
 * What used to be one flat screen is now four levels, handled by `organizer/OrganizerConsole`. This
 * component keeps only what sits *outside* those levels: creating an event, creating a venue, and the
 * hand-off to feature 005's seat-map builder.
 */
export default function OrganizerPanel({ onBack }: { onBack: () => void }) {
  // Which event is open lives in the URL, not in state, so level 2 is linkable, bookmarkable and
  // survives Back — the same rule the rest of the app follows (feature 006, FR-039).
  const location = useLocation();
  const navigate = useNavigate();
  const selectedEventId = pathToRoute(location.pathname)?.organizerEventId ?? null;
  const setSelectedEventId = (eventId: number | null) =>
    navigate(screenToPath("organizer", { organizerEventId: eventId }));

  const [reloadKey, setReloadKey] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [seatMapEventId, setSeatMapEventId] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [categoryCode, setCategoryCode] = useState("music");
  const categories = useEventCategories();
  const [eventType, setEventType] = useState<"general_admission" | "seated">("general_admission");
  const [description, setDescription] = useState("");

  const [vName, setVName] = useState("");
  const [vCity, setVCity] = useState("Hà Nội");
  const [vAddr, setVAddr] = useState("");

  const refresh = () => setReloadKey((k) => k + 1);

  const wrap = async (fn: () => Promise<void>, ok: string) => {
    setErr(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const createEvent = (e: FormEvent) => {
    e.preventDefault();
    void wrap(async () => {
      await organizerApi.createEvent({ title, categoryCode, description, eventType });
      setTitle("");
      setDescription("");
      setShowCreate(false);
    }, "Đã tạo sự kiện (bản nháp).");
  };

  const createVenue = (e: FormEvent) => {
    e.preventDefault();
    void wrap(async () => {
      await organizerApi.createVenue({ name: vName, city: vCity, rawAddress: vAddr });
      setVName("");
      setVAddr("");
    }, "Đã tạo địa điểm.");
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 text-beige-kem">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-black">Quản lý sự kiện</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate((v) => !v)} className={ghost}>
            {showCreate ? "Đóng" : "+ Sự kiện mới"}
          </button>
          <button onClick={onBack} className={ghost}>
            ← Về trang chủ
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">
          {notice}
        </div>
      )}
      <Refusal message={err} />

      {showCreate && (
        <form onSubmit={createEvent} className={card}>
          <h2 className="mb-3 font-display text-lg font-bold">Tạo sự kiện</h2>
          <label className="block">
            <span className={label}>Tiêu đề</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className={input}
            />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
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
            <label className="block">
              <span className={label}>Loại sự kiện</span>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as "general_admission" | "seated")}
                className={input}
              >
                <option value="general_admission" className="bg-xanh-pho">
                  Vé tự do (GA)
                </option>
                <option value="seated" className="bg-xanh-pho">
                  Có ghế ngồi
                </option>
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className={label}>Mô tả</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              className={`${input} h-auto py-2.5`}
            />
          </label>
          <button type="submit" className={`${btn} mt-4`}>
            Tạo bản nháp
          </button>
        </form>
      )}

      <div className={card}>
        <OrganizerConsole
          selectedEventId={selectedEventId}
          onSelectEvent={setSelectedEventId}
          onCreateRequested={() => setShowCreate(true)}
          onOpenSeatMap={setSeatMapEventId}
          reloadKey={reloadKey}
        />
      </div>

      {selectedEventId === null && (
        <form onSubmit={createVenue} className={card}>
          <h2 className="mb-3 font-display text-lg font-bold">Địa điểm của tôi</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={vName}
              onChange={(e) => setVName(e.target.value)}
              placeholder="Tên địa điểm"
              required
              className={input}
            />
            <input
              value={vCity}
              onChange={(e) => setVCity(e.target.value)}
              placeholder="Thành phố"
              required
              className={input}
            />
            <input
              value={vAddr}
              onChange={(e) => setVAddr(e.target.value)}
              placeholder="Địa chỉ"
              required
              className={input}
            />
          </div>
          <button type="submit" className={`${btn} mt-4`}>
            Thêm địa điểm
          </button>
        </form>
      )}

      <p className="font-mono text-[11px] text-beige-kem/45">
        Sự kiện chỉ hiển thị công khai sau khi admin duyệt.
      </p>

      {seatMapEventId && (
        <SeatMapBuilder
          eventId={seatMapEventId}
          onClose={() => {
            setSeatMapEventId(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
