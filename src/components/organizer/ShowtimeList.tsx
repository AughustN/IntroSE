/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { ManageShowtime, MyVenue, organizerApi, studioApi } from "../../services/catalogClient";
import TierPanel from "./TierPanel";
import { Empty, ErrorRetry, Loading, Refusal } from "./states";
import Select from "../Select";

const input =
  "h-10 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const btn =
  " bg-burgundy px-3 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost =
  " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80 disabled:opacity-40";

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Level 3 of the console: an event's showtimes (UC-23).
 *
 * A showtime carrying sold tickets or live holds cannot be moved or deleted, and the reason is shown
 * up front rather than only after the organizer tries — the server still refuses either way, but a
 * console that only reveals the rule on failure is a console that wastes people's time.
 */
export default function ShowtimeList({
  eventId,
  venues,
  onChanged,
}: {
  eventId: number;
  venues: MyVenue[];
  onChanged: (returnedToReview: boolean) => void;
}) {
  const [showtimes, setShowtimes] = useState<ManageShowtime[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openTiers, setOpenTiers] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<Record<number, string | null>>({});
  const [busy, setBusy] = useState(false);

  // Creating a showtime (feature 002's endpoint). A showtime is born with 1–4 tiers, because
  // publishing requires at least one upcoming showtime with at least one tier.
  const [adding, setAdding] = useState(false);
  const [addVenue, setAddVenue] = useState<number | "">("");
  const [addDate, setAddDate] = useState("");
  const [addTiers, setAddTiers] = useState<{ label: string; price: string }[]>([
    { label: "Thường", price: "100000" },
  ]);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setShowtimes(null);
    try {
      setShowtimes(await organizerApi.showtimesManage(eventId));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (showtimeId: number, fn: () => Promise<{ returnedToReview: boolean }>) => {
    setBusy(true);
    setRefusal((r) => ({ ...r, [showtimeId]: null }));
    try {
      const res = await fn();
      onChanged(res.returnedToReview);
      await load();
    } catch (e) {
      // Rendered against the showtime that caused it, message as-is (FR-041).
      setRefusal((r) => ({ ...r, [showtimeId]: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const createShowtime = async () => {
    setAddError(null);
    if (!addVenue || !addDate) {
      setAddError("Chọn địa điểm và ngày giờ.");
      return;
    }
    const tiers = addTiers.map((t) => ({ label: t.label.trim(), price: Number(t.price) }));
    if (tiers.some((t) => !t.label || !Number.isInteger(t.price) || t.price < 0)) {
      setAddError("Mỗi hạng vé cần tên và giá là số nguyên đồng không âm.");
      return;
    }
    setBusy(true);
    try {
      await organizerApi.addShowtime(eventId, {
        venueId: Number(addVenue),
        startsAt: new Date(addDate).toISOString(),
        tiers,
      });
      setAdding(false);
      setAddDate("");
      setAddTiers([{ label: "Thường", price: "100000" }]);
      onChanged(true); // a new showtime is a material edit — the event goes back for review
      await load();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addForm = (
    <div className="border-2 border-dashed border-beige-kem/40 p-3">
      {!adding ? (
        <button onClick={() => setAdding(true)} className={btn}>
          + Thêm suất chiếu
        </button>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-[11px] text-beige-kem/60">Suất chiếu mới (1–4 hạng vé)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {/*
              The shared dropdown, not a native `<select>`: the platform draws that list itself, so
              it arrived as a grey Windows menu in the middle of a cream, mono-set panel and no
              amount of styling on the element could reach it.
            */}
            <Select
              value={addVenue === "" ? "" : String(addVenue)}
              options={venues.map((v) => ({ value: String(v.id), label: v.name }))}
              placeholder="Chọn địa điểm"
              onChange={(v) => setAddVenue(Number(v) || "")}
              triggerClassName={input}
            />
            <input
              type="datetime-local"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              className={input}
            />
          </div>

          {addTiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                value={t.label}
                onChange={(e) =>
                  setAddTiers((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                  )
                }
                placeholder="Tên hạng (VIP, Thường…)"
                className={input}
              />
              <input
                value={t.price}
                onChange={(e) =>
                  setAddTiers((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)),
                  )
                }
                inputMode="numeric"
                placeholder="Giá (đ)"
                className={input}
              />
              <button
                type="button"
                onClick={() => setAddTiers((rows) => rows.filter((_, j) => j !== i))}
                disabled={addTiers.length <= 1}
                className={ghost}
              >
                Xoá
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAddTiers((rows) => [...rows, { label: "", price: "" }])}
              disabled={addTiers.length >= 4}
              className={ghost}
            >
              + Hạng vé ({addTiers.length}/4)
            </button>
            <button onClick={createShowtime} disabled={busy} className={btn}>
              Tạo suất chiếu
            </button>
            <button onClick={() => setAdding(false)} className={ghost}>
              Huỷ
            </button>
          </div>

          <Refusal message={addError} />
        </div>
      )}
    </div>
  );

  if (loadError) return <ErrorRetry message={loadError} onRetry={load} />;
  if (showtimes === null) return <Loading label="Đang tải suất chiếu…" />;
  if (showtimes.length === 0) {
    return (
      <div className="space-y-3">
        <Empty
          title="Sự kiện chưa có suất chiếu nào."
          hint="Thêm suất chiếu để có thể gửi duyệt."
        />
        {addForm}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showtimes.map((st) => {
        const committed = st.tiers.reduce((n, t) => n + t.sold + t.held, 0);
        const locked = committed > 0;
        return (
          <div key={st.id} className="border-2 border-beige-kem p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                type="datetime-local"
                defaultValue={toLocalInput(st.startsAt)}
                onBlur={(e) => {
                  const next = new Date(e.target.value);
                  if (
                    !Number.isNaN(next.getTime()) &&
                    next.toISOString() !== new Date(st.startsAt).toISOString()
                  ) {
                    void run(st.id, () =>
                      studioApi.updateShowtime(st.id, { startsAt: next.toISOString() }),
                    );
                  }
                }}
                className={input}
              />
              <Select
                value={String(st.venueId)}
                options={venues.map((v) => ({ value: String(v.id), label: v.name }))}
                disabled={locked || st.hasSeatMap}
                onChange={(v) =>
                  void run(st.id, () => studioApi.updateShowtime(st.id, { venueId: Number(v) }))
                }
                triggerClassName={input}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setOpenTiers(openTiers === st.id ? null : st.id)}
                  className={ghost}
                >
                  {openTiers === st.id ? "Ẩn hạng vé" : "Hạng vé"}
                </button>
                <button
                  onClick={() => void run(st.id, () => studioApi.deleteShowtime(st.id))}
                  disabled={busy || locked}
                  className={btn}
                >
                  Xoá suất
                </button>
              </div>
            </div>

            <p className="mt-2 font-mono text-[11px] text-beige-kem/55">
              {st.venueName}
              {locked && " · Đã có vé bán hoặc đang giữ — không thể đổi địa điểm hay xoá suất"}
              {!locked &&
                st.hasSeatMap &&
                " · Đã có sơ đồ ghế — đổi địa điểm phải qua trình thiết kế sơ đồ"}
            </p>

            <Refusal message={refusal[st.id] ?? null} />

            {openTiers === st.id && (
              <div className="mt-3 border-t border-beige-kem/25 pt-3">
                <TierPanel showtimeId={st.id} onChanged={onChanged} />
              </div>
            )}
          </div>
        );
      })}
      {addForm}
    </div>
  );
}
