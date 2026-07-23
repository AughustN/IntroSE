/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useState } from "react";
import { EVENT_CATEGORIES, MyEvent, MyVenue, organizerApi } from "../services/catalogClient";

const input =
  "h-11 w-full rounded-xl border border-beige-kem/20 bg-white/[0.035] px-4 text-sm text-beige-kem outline-none focus:border-cam-dat";
const label = "mb-1.5 block font-mono text-xs text-beige-kem/70";
const card = "rounded-2xl border border-beige-kem/10 bg-white/[0.02] p-5";
const btn = "rounded-xl bg-burgundy px-4 py-2.5 text-sm font-black text-beige-kem transition hover:bg-burgundy/90 disabled:opacity-60";
const ghost = "rounded-xl border border-beige-kem/15 px-3 py-2 text-xs font-bold text-beige-kem/80 transition hover:border-cam-dat";

const badge = (m: string) => {
  const map: Record<string, string> = {
    pending_review: "text-cam-dat border-cam-dat/40 bg-cam-dat/10",
    approved: "text-la-co border-la-co/40 bg-la-co/10",
    removed: "text-beige-kem/60 border-beige-kem/20 bg-white/[0.03]",
    flagged: "text-cam-dat border-cam-dat/40 bg-cam-dat/10",
  };
  const text: Record<string, string> = { pending_review: "Chờ duyệt", approved: "Đã duyệt", removed: "Đã gỡ/từ chối", flagged: "Bị gắn cờ" };
  return <span className={`rounded-lg border px-2 py-0.5 font-mono text-[10px] ${map[m] ?? ""}`}>{text[m] ?? m}</span>;
};

export default function OrganizerPanel({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [venues, setVenues] = useState<MyVenue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // create-event form
  const [title, setTitle] = useState("");
  const [categoryCode, setCategoryCode] = useState("music");
  const [description, setDescription] = useState("");

  // create-venue form
  const [vName, setVName] = useState("");
  const [vCity, setVCity] = useState("Hà Nội");
  const [vAddr, setVAddr] = useState("");

  // add-showtime (inline per event)
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  const [stVenue, setStVenue] = useState<number | "">("");
  const [stDate, setStDate] = useState("");
  const [stLabel, setStLabel] = useState("Thường");
  const [stPrice, setStPrice] = useState("100000");

  const reload = async () => {
    try {
      setEvents(await organizerApi.myEvents());
      setVenues(await organizerApi.myVenues());
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const wrap = async (fn: () => Promise<void>, ok: string) => {
    setErr(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const createEvent = (e: FormEvent) => {
    e.preventDefault();
    wrap(async () => {
      await organizerApi.createEvent({ title, categoryCode, description, eventType: "general_admission" });
      setTitle("");
      setDescription("");
    }, "Đã tạo sự kiện (bản nháp).");
  };
  const createVenue = (e: FormEvent) => {
    e.preventDefault();
    wrap(async () => {
      await organizerApi.createVenue({ name: vName, city: vCity, rawAddress: vAddr });
      setVName("");
      setVAddr("");
    }, "Đã tạo địa điểm.");
  };
  const addShowtime = (eventId: number) => {
    if (!stVenue || !stDate) {
      setErr("Chọn địa điểm và ngày giờ.");
      return;
    }
    wrap(async () => {
      await organizerApi.addShowtime(eventId, {
        venueId: Number(stVenue),
        startsAt: new Date(stDate).toISOString(),
        tiers: [{ label: stLabel, price: Number(stPrice) }],
      });
      setOpenEvent(null);
    }, "Đã thêm suất chiếu + hạng vé.");
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 text-beige-kem">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-black">Quản lý sự kiện</h1>
        <button onClick={onBack} className={ghost}>← Về trang chủ</button>
      </div>
      {notice && <div className="rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-xs text-la-co">{notice}</div>}
      {err && <div className="rounded-xl border border-burgundy/40 bg-burgundy/10 p-3 text-xs">{err}</div>}

      <form onSubmit={createEvent} className={card}>
        <h2 className="mb-3 font-display text-lg font-bold">Tạo sự kiện</h2>
        <label className="block">
          <span className={label}>Tiêu đề</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className={input} />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Danh mục</span>
            <select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} className={input}>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c.code} value={c.code} className="bg-xanh-pho">{c.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className={label}>Mô tả</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className={`${input} h-auto py-2.5`} />
        </label>
        <button type="submit" className={`${btn} mt-4`}>Tạo bản nháp</button>
      </form>

      <form onSubmit={createVenue} className={card}>
        <h2 className="mb-3 font-display text-lg font-bold">Địa điểm của tôi</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Tên địa điểm" required className={input} />
          <input value={vCity} onChange={(e) => setVCity(e.target.value)} placeholder="Thành phố" required className={input} />
          <input value={vAddr} onChange={(e) => setVAddr(e.target.value)} placeholder="Địa chỉ" required className={input} />
        </div>
        <button type="submit" className={`${btn} mt-4`}>Thêm địa điểm</button>
        {venues.length > 0 && (
          <p className="mt-3 font-mono text-[11px] text-beige-kem/50">{venues.map((v) => `${v.name} (${v.city})`).join(" · ")}</p>
        )}
      </form>

      <div className={card}>
        <h2 className="mb-3 font-display text-lg font-bold">Sự kiện của tôi ({events.length})</h2>
        <div className="space-y-3">
          {events.length === 0 && <p className="text-sm text-beige-kem/60">Chưa có sự kiện nào.</p>}
          {events.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-beige-kem/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold">{ev.title}</span>
                  <span className="ml-2 font-mono text-[10px] text-beige-kem/40">{ev.status}</span>
                  <span className="ml-2">{badge(ev.moderation)}</span>
                  {ev.reviewNote && <span className="ml-2 text-[11px] text-burgundy">({ev.reviewNote})</span>}
                </div>
                <div className="flex gap-2">
                  <button className={ghost} onClick={() => setOpenEvent(openEvent === ev.id ? null : ev.id)}>Thêm suất</button>
                  <button className={btn} onClick={() => wrap(() => organizerApi.publish(ev.id).then(() => {}), "Đã gửi duyệt.")}>Gửi duyệt</button>
                </div>
              </div>
              {openEvent === ev.id && (
                <div className="mt-3 grid gap-2 border-t border-beige-kem/10 pt-3 sm:grid-cols-4">
                  <select value={stVenue} onChange={(e) => setStVenue(Number(e.target.value) || "")} className={input}>
                    <option value="" className="bg-xanh-pho">Chọn địa điểm</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id} className="bg-xanh-pho">{v.name}</option>
                    ))}
                  </select>
                  <input type="datetime-local" value={stDate} onChange={(e) => setStDate(e.target.value)} className={input} />
                  <input value={stLabel} onChange={(e) => setStLabel(e.target.value)} placeholder="Hạng vé" className={input} />
                  <div className="flex gap-2">
                    <input value={stPrice} onChange={(e) => setStPrice(e.target.value)} placeholder="Giá (đ)" className={input} />
                    <button className={btn} onClick={() => addShowtime(ev.id)}>Thêm</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 font-mono text-[11px] text-beige-kem/45">Sự kiện chỉ hiển thị công khai sau khi admin duyệt.</p>
      </div>
    </div>
  );
}
