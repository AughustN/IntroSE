/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useState } from "react";
import Select from "./Select";
import { EVENT_CATEGORIES, MyEvent, MyVenue, organizerApi } from "../services/catalogClient";
import { aiClient, type ListingSuggestion } from "../services/aiClient";
import SeatMapBuilder from "./SeatMapBuilder";

const input =
  "h-11 w-full rounded-xl border-2 border-beige-kem bg-surface-2 px-4 text-sm text-beige-kem outline-none focus:border-burgundy";
const label = "mb-1.5 block font-mono text-xs text-beige-kem/70";
const card = "rounded-2xl border-2 border-beige-kem bg-surface-2 p-5";
const btn =
  "rounded-xl bg-burgundy px-4 py-2.5 text-sm font-black text-white transition hover:brightness-95 disabled:opacity-60";
const ghost =
  "rounded-xl border-2 border-beige-kem px-3 py-2 text-xs font-bold text-beige-kem/80 transition";

const badge = (m: string) => {
  const map: Record<string, string> = {
    pending_review: "text-on-tint border-beige-kem bg-cam-dat",
    approved: "text-on-tint border-beige-kem bg-la-co",
    removed: "text-beige-kem/60 border-beige-kem/25 bg-surface-2",
    flagged: "text-on-tint border-beige-kem bg-cam-dat",
  };
  const text: Record<string, string> = {
    pending_review: "Chờ duyệt",
    approved: "Đã duyệt",
    removed: "Đã gỡ/từ chối",
    flagged: "Bị gắn cờ",
  };
  return (
    <span className={`rounded-lg border px-2 py-0.5 font-mono text-[12px] ${map[m] ?? ""}`}>
      {text[m] ?? m}
    </span>
  );
};

export default function OrganizerPanel({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [venues, setVenues] = useState<MyVenue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // create-event form
  const [title, setTitle] = useState("");
  const [categoryCode, setCategoryCode] = useState("music");
  const [eventType, setEventType] = useState<"general_admission" | "seated">("general_admission");
  const [description, setDescription] = useState("");
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<ListingSuggestion | null>(null);
  const [seatMapEventId, setSeatMapEventId] = useState<number | null>(null);

  // create-venue form
  const [vName, setVName] = useState("");
  const [vCity, setVCity] = useState("Hà Nội");
  const [vAddr, setVAddr] = useState("");

  // add-showtime (inline per event). A showtime carries 1–4 ticket tiers (server caps at 4).
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  const [stVenue, setStVenue] = useState<number | "">("");
  const [stDate, setStDate] = useState("");
  const [stTiers, setStTiers] = useState<{ label: string; price: string }[]>([
    { label: "Thường", price: "100000" },
  ]);

  const MAX_TIERS = 4;
  const setTierField = (index: number, field: "label" | "price", value: string) =>
    setStTiers((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  const addTierRow = () =>
    setStTiers((rows) => (rows.length >= MAX_TIERS ? rows : [...rows, { label: "", price: "" }]));
  const removeTierRow = (index: number) =>
    setStTiers((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));

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
      await organizerApi.createEvent({ title, categoryCode, description, eventType });
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
    const tiers = stTiers.map((t) => ({ label: t.label.trim(), price: Number(t.price) }));
    if (tiers.some((t) => !t.label || !Number.isFinite(t.price) || t.price < 0)) {
      setErr("Mỗi hạng vé cần tên và giá hợp lệ.");
      return;
    }
    if (tiers.length > MAX_TIERS) {
      setErr(`Mỗi suất chỉ có tối đa ${MAX_TIERS} hạng vé.`);
      return;
    }
    wrap(async () => {
      await organizerApi.addShowtime(eventId, {
        venueId: Number(stVenue),
        startsAt: new Date(stDate).toISOString(),
        tiers,
      });
      setOpenEvent(null);
      setStTiers([{ label: "Thường", price: "100000" }]);
    }, "Đã thêm suất chiếu + hạng vé.");
  };

  const askListingAssistant = async () => {
    if (!aiBrief.trim()) return;
    setAiBusy(true);
    setErr(null);
    try {
      const result = await aiClient.eventAssistant({ brief: aiBrief.trim(), category: categoryCode, eventType });
      setAiSuggestion(result.suggestion);
      if (result.message) setNotice(result.message);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Không thể tạo gợi ý AI.");
    } finally {
      setAiBusy(false);
    }
  };

  const applyListingSuggestion = () => {
    if (!aiSuggestion) return;
    setTitle(aiSuggestion.title);
    setDescription(aiSuggestion.description);
    if (aiSuggestion.ticketPriceSuggestions.length) {
      setStTiers(aiSuggestion.ticketPriceSuggestions.slice(0, MAX_TIERS).map((tier) => ({ label: tier.name, price: String(tier.price) })));
    }
    setNotice("Đã áp dụng gợi ý AI. Hãy kiểm tra và chỉnh sửa trước khi tạo sự kiện.");
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 text-beige-kem">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-black">Quản lý sự kiện</h1>
        <button onClick={onBack} className={ghost}>
          ← Về trang chủ
        </button>
      </div>
      {notice && (
        <div className="rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs text-on-tint">
          {notice}
        </div>
      )}
      {err && (
        <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs">{err}</div>
      )}

      <form onSubmit={createEvent} className={card}>
        <h2 className="mb-3 font-display text-xl font-bold">Tạo sự kiện</h2>
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
          <div className="block">
            <span className={label}>Danh mục</span>
            <Select
              triggerClassName={input}
              value={categoryCode}
              onChange={setCategoryCode}
              options={EVENT_CATEGORIES.map((c) => ({ value: c.code, label: c.label }))}
            />
          </div>
          <div className="block">
            <span className={label}>Loại sự kiện</span>
            <Select
              triggerClassName={input}
              value={eventType}
              onChange={(v) => setEventType(v as "general_admission" | "seated")}
              options={[
                { value: "general_admission", label: "Vé tự do (GA)" },
                { value: "seated", label: "Có ghế ngồi" },
              ]}
            />
          </div>
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
        <div className="mt-3 border border-beige-kem/30 p-3">
          <label className="block">
            <span className={label}>Trợ lý AI: mô tả ý tưởng</span>
            <textarea value={aiBrief} onChange={(event) => setAiBrief(event.target.value)} maxLength={3000} rows={2} placeholder="Ví dụ: đêm EDM ngoài trời cho sinh viên, 500 người, tối thứ 7" className={`${input} h-auto py-2.5`} />
          </label>
          <button type="button" onClick={() => void askListingAssistant()} disabled={aiBusy || !aiBrief.trim()} className={`${ghost} mt-2 disabled:opacity-60`}>{aiBusy ? "Đang tạo gợi ý" : "Tạo gợi ý AI"}</button>
          {aiSuggestion && <div className="mt-3 border-t border-beige-kem/25 pt-3 text-sm">
            <p className="font-bold">{aiSuggestion.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-beige-kem/75">{aiSuggestion.description}</p>
            <p className="mt-2 text-xs text-beige-kem/65">{aiSuggestion.tags.join(" · ")}</p>
            <button type="button" onClick={applyListingSuggestion} className={`${btn} mt-3`}>Áp dụng vào form</button>
          </div>}
        </div>
        <button type="submit" className={`${btn} mt-4`}>
          Tạo bản nháp
        </button>
      </form>

      <form onSubmit={createVenue} className={card}>
        <h2 className="mb-3 font-display text-xl font-bold">Địa điểm của tôi</h2>
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
        {venues.length > 0 && (
          <p className="mt-3 font-mono text-[13px] text-beige-kem/50">
            {venues.map((v) => `${v.name} (${v.city})`).join(" · ")}
          </p>
        )}
      </form>

      <div className={card}>
        <h2 className="mb-3 font-display text-xl font-bold">Sự kiện của tôi ({events.length})</h2>
        <div className="space-y-3">
          {events.length === 0 && <p className="text-sm text-beige-kem/60">Chưa có sự kiện nào.</p>}
          {events.map((ev) => (
            <div key={ev.id} className="rounded-xl border-2 border-beige-kem p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold">{ev.title}</span>
                  <span className="ml-2 font-mono text-[12px] text-beige-kem/40">{ev.status}</span>
                  <span className="ml-2">{badge(ev.moderation)}</span>
                  {ev.reviewNote && (
                    <span className="ml-2 text-[13px] text-burgundy-ink">({ev.reviewNote})</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    className={ghost}
                    onClick={() => setOpenEvent(openEvent === ev.id ? null : ev.id)}
                  >
                    Thêm suất
                  </button>
                  {ev.eventType === "seated" && (
                    <button className={ghost} onClick={() => setSeatMapEventId(ev.id)}>
                      Sơ đồ ghế
                    </button>
                  )}
                  <button
                    className={btn}
                    onClick={() =>
                      wrap(() => organizerApi.publish(ev.id).then(() => {}), "Đã gửi duyệt.")
                    }
                  >
                    Gửi duyệt
                  </button>
                </div>
              </div>
              {openEvent === ev.id && (
                <div className="mt-3 space-y-3 border-t border-beige-kem/25 pt-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      triggerClassName={input}
                      placeholder="Chọn địa điểm"
                      value={String(stVenue)}
                      onChange={(v) => setStVenue(Number(v) || "")}
                      options={venues.map((v) => ({ value: String(v.id), label: v.name }))}
                    />
                    <input
                      type="datetime-local"
                      value={stDate}
                      onChange={(e) => setStDate(e.target.value)}
                      className={input}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={label}>
                        Hạng vé ({stTiers.length}/{MAX_TIERS})
                      </span>
                      <button
                        type="button"
                        onClick={addTierRow}
                        disabled={stTiers.length >= MAX_TIERS}
                        className={`${ghost} disabled:opacity-40`}
                      >
                        + Thêm hạng
                      </button>
                    </div>
                    {stTiers.map((tier, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          value={tier.label}
                          onChange={(e) => setTierField(i, "label", e.target.value)}
                          placeholder="Tên hạng (VIP, Thường…)"
                          className={input}
                        />
                        <input
                          value={tier.price}
                          onChange={(e) => setTierField(i, "price", e.target.value)}
                          inputMode="numeric"
                          placeholder="Giá (đ)"
                          className={input}
                        />
                        <button
                          type="button"
                          onClick={() => removeTierRow(i)}
                          disabled={stTiers.length <= 1}
                          aria-label="Xóa hạng vé"
                          className={`${ghost} disabled:opacity-40`}
                        >
                          Xóa
                        </button>
                      </div>
                    ))}
                  </div>

                  <button className={btn} onClick={() => addShowtime(ev.id)}>
                    Thêm suất
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 font-mono text-[13px] text-beige-kem/45">
          Sự kiện chỉ hiển thị công khai sau khi admin duyệt.
        </p>
      </div>

      {seatMapEventId && (
        <SeatMapBuilder
          eventId={seatMapEventId}
          onClose={() => {
            setSeatMapEventId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
