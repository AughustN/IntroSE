/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_MAX_TIERS_PER_SHOWTIME } from "@/shared/catalog/limits";
import { ManageShowtime, MyVenue, organizerApi, studioApi } from "../../services/catalogClient";
import DateTimeField from "../DateTimeField";
import TierPanel from "./TierPanel";
import { Empty, ErrorRetry, Loading, Refusal } from "./states";

const input =
  "h-10 min-w-0 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
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
  preferredVenueId,
  onChanged,
}: {
  eventId: number;
  venues: MyVenue[];
  /**
   * The event's ONE venue, when the caller knows it — the create wizard always does, because the
   * venue was collected on page two of the form and created WITH the draft.
   *
   * Omitted, it is derived from the event's existing showtimes. Either way this is now a
   * system-wide rule: showtimes are never ASKED which venue they belong to, because the event
   * already answered (FR-040's "one word per concept" applied to places).
   */
  preferredVenueId?: number;
  onChanged: (returnedToReview: boolean) => void;
}) {
  const [showtimes, setShowtimes] = useState<ManageShowtime[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openTiers, setOpenTiers] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<Record<number, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [maxTiers, setMaxTiers] = useState(DEFAULT_MAX_TIERS_PER_SHOWTIME);

  // Creating a showtime (feature 002's endpoint). A showtime starts with at least one tier, because
  // publishing requires at least one upcoming showtime with at least one tier.
  const [adding, setAdding] = useState(false);
  // This is the site's own calendar value (`YYYY-MM-DDTHH:mm`), not a browser-drawn datetime input.
  // The custom field commits only on "Xong", so the form never submits a half-typed year or date.
  const [addDate, setAddDate] = useState("");
  /** Optimistic display while a changed showtime date is being confirmed and the list reloads. */
  const [pendingDates, setPendingDates] = useState<Record<number, string>>({});
  const [addTiers, setAddTiers] = useState<{ label: string; price: string }[]>([
    { label: "Thường", price: "100000" },
  ]);
  const [addError, setAddError] = useState<string | null>(null);

  /** The event's venue, in priority order: told → established by an existing showtime → sole option. */
  const lockedVenueId = preferredVenueId ?? showtimes?.[0]?.venueId ?? null;
  const lockedVenueName =
    venues.find((v) => v.id === lockedVenueId)?.name ?? showtimes?.[0]?.venueName ?? null;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [rows, limits] = await Promise.all([
        organizerApi.showtimesManage(eventId),
        organizerApi.limits(),
      ]);
      setMaxTiers(limits.maxTiersPerShowtime);
      setShowtimes(rows);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    showtimeId: number,
    fn: () => Promise<{ returnedToReview: boolean }>,
  ): Promise<boolean> => {
    setBusy(true);
    setRefusal((r) => ({ ...r, [showtimeId]: null }));
    try {
      const res = await fn();
      onChanged(res.returnedToReview);
      await load();
      return true;
    } catch (e) {
      // Rendered against the showtime that caused it, message as-is (FR-041).
      setRefusal((r) => ({ ...r, [showtimeId]: (e as Error).message }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createShowtime = async () => {
    setAddError(null);
    // The venue is not a question this form asks — the event answered it at creation (see
    // `lockedVenueId`). Only a date and priced tiers remain to check.
    if (!addDate) {
      setAddError("Chọn ngày giờ.");
      return;
    }
    // The server refuses a past showtime (`showtime_in_past`); checking HERE puts the refusal on
    // the form that made the mistake instead of a toast after the round trip (ORG-07, client half).
    if (new Date(addDate).getTime() <= Date.now()) {
      setAddError("Ngày và giờ diễn phải ở tương lai.");
      return;
    }
    if (!lockedVenueId) {
      setAddError("Sự kiện chưa có địa điểm.");
      return;
    }
    const tiers = addTiers.map((t) => ({ label: t.label.trim(), price: Number(t.price) }));
    if (tiers.length < 1 || tiers.length > maxTiers) {
      setAddError(`Mỗi suất cần từ 1 đến ${maxTiers} hạng vé.`);
      return;
    }
    if (tiers.some((t) => !t.label || !Number.isInteger(t.price) || t.price < 0)) {
      setAddError("Mỗi hạng vé cần tên và giá là số nguyên đồng không âm.");
      return;
    }
    setBusy(true);
    try {
      const result = await organizerApi.addShowtime(eventId, {
        venueId: Number(lockedVenueId),
        startsAt: new Date(addDate).toISOString(),
        tiers,
      });
      // Clear the committed custom-field value so the next new-showtime form starts blank.
      setAdding(false);
      setAddDate("");
      setAddTiers([{ label: "Thường", price: "100000" }]);
      onChanged(result.returnedToReview);
      await load();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addForm = (
    <div className="min-w-0 border-2 border-dashed border-beige-kem/40 p-3">
      {!adding ? (
        <button onClick={() => setAdding(true)} className={btn}>
          + Thêm suất chiếu
        </button>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-[11px] text-beige-kem/60">
            Suất chiếu mới (1–{maxTiers} hạng vé)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {/* The venue, stated rather than asked: the event already has exactly one (FR-040). */}
            <div className="min-w-0">
              <span className="mb-1 block font-mono text-[11px] text-ink-soft">Địa điểm</span>
              <p className="flex min-h-10 items-center gap-1.5 border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem">
                {lockedVenueName ?? "—"}
              </p>
            </div>
            <div className="min-w-0">
              <span className="mb-1 block font-mono text-[11px] text-beige-kem/60">
                Ngày và giờ diễn
              </span>
              <DateTimeField
                value={addDate}
                onChange={setAddDate}
                ariaLabel="Ngày và giờ diễn"
                className={input}
              />
            </div>
          </div>

          {addTiers.map((t, i) => (
            <div
              key={i}
              className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <label htmlFor={`showtime-tier-${i}-label`} className="sr-only">
                  Tên hạng vé {i + 1}
                </label>
                <input
                  id={`showtime-tier-${i}-label`}
                  type="text"
                  value={t.label}
                  onChange={(e) =>
                    setAddTiers((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                    )
                  }
                  placeholder="Tên hạng (VIP, Thường…)"
                  className={input}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`showtime-tier-${i}-price`} className="sr-only">
                  Giá hạng vé {i + 1}
                </label>
                <input
                  id={`showtime-tier-${i}-price`}
                  type="text"
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
              </div>
              <button
                type="button"
                onClick={() => setAddTiers((rows) => rows.filter((_, j) => j !== i))}
                disabled={addTiers.length <= 1}
                className={`${ghost} w-full sm:w-auto`}
              >
                Xoá
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setAddTiers((rows) =>
                  rows.length >= maxTiers ? rows : [...rows, { label: "", price: "" }],
                )
              }
              disabled={busy || addTiers.length >= maxTiers}
              className={ghost}
            >
              + Hạng vé ({addTiers.length}/{maxTiers})
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

  if (loadError && showtimes === null) return <ErrorRetry message={loadError} onRetry={load} />;
  if (showtimes === null) return <Loading label="Đang tải suất chiếu…" />;
  if (showtimes.length === 0) {
    return (
      <div className="space-y-3">
        {loadError && <ErrorRetry message={loadError} onRetry={load} />}
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
      {loadError && (
        <ErrorRetry message={`Chưa cập nhật được suất chiếu: ${loadError}`} onRetry={load} />
      )}
      {/*
        One boundary around the whole list, hairlines between rows — not a border-2 box per
        showtime. Several of those stacked read as a wall of rectangles before an organizer gets
        to the dates inside them; a single frame with `divide-y` still separates the rows without
        multiplying the outline.
      */}
      {showtimes.length > 0 && (
        <div className="divide-y divide-beige-kem/20 border border-beige-kem/25">
          {showtimes.map((st) => {
            const committed = st.tiers.reduce((n, t) => n + t.sold + t.held, 0);
            const historical =
              Date.parse(st.startsAt) <= Date.now() ||
              st.status === "cancelled" ||
              st.status === "finished";
            const locked = committed > 0 || historical;
            return (
              <div key={st.id} className="p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <span className="sr-only">Ngày và giờ suất chiếu</span>
                    <DateTimeField
                      value={pendingDates[st.id] ?? toLocalInput(st.startsAt)}
                      disabled={locked || busy}
                      ariaLabel="Ngày và giờ suất chiếu"
                      className={input}
                      onChange={(nextValue) => {
                        const next = new Date(nextValue);
                        const current = new Date(st.startsAt);
                        if (
                          Number.isNaN(next.getTime()) ||
                          next.toISOString() === current.toISOString()
                        ) {
                          return;
                        }
                        // Same rule as the server's `starts_at_in_past`, answered on the field
                        // instead of by a round trip that leaves the row flagged red (ORG-07).
                        if (next.getTime() <= Date.now()) {
                          setRefusal((r) => ({
                            ...r,
                            [st.id]: "Ngày và giờ diễn phải ở tương lai.",
                          }));
                          return;
                        }
                        setPendingDates((dates) => ({ ...dates, [st.id]: nextValue }));
                        void run(st.id, () =>
                          studioApi.updateShowtime(st.id, { startsAt: next.toISOString() }),
                        ).then(() =>
                          setPendingDates((dates) => {
                            const { [st.id]: _finished, ...rest } = dates;
                            return rest;
                          }),
                        );
                      }}
                    />
                  </div>
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
                  {historical
                    ? " · Suất đã diễn hoặc đã đóng — chỉ xem, không chỉnh sửa"
                    : committed > 0 && " · Đã có vé bán hoặc đang giữ — không thể xoá suất"}
                  {!locked && st.hasSeatMap && " · Đã có sơ đồ ghế — sửa qua trình thiết kế sơ đồ"}
                </p>

                <Refusal message={refusal[st.id] ?? null} />

                {openTiers === st.id && (
                  <div className="mt-3 border-t border-beige-kem/25 pt-3">
                    <fieldset disabled={historical} className="min-w-0">
                      <TierPanel
                        showtimeId={st.id}
                        onChanged={(review) => {
                          onChanged(review);
                          void load();
                        }}
                      />
                    </fieldset>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {addForm}
    </div>
  );
}
