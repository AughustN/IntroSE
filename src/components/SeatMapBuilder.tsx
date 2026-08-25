/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import type { LayoutSummary } from "../../shared/catalog/seatmap";
import { ManageShowtime, layoutApi, organizerApi, studioApi } from "../services/catalogClient";
import { Empty, ErrorRetry, Loading } from "./organizer/states";
import ChartEditor from "./seatmap/ChartEditor";
import ShowtimeMapPanel from "./seatmap/ShowtimeMapPanel";
import Select from "./Select";

const input =
  "h-10 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-body text-beige-kem outline-none focus:border-burgundy";
const btn =
  "bg-burgundy px-3 py-2 text-eyebrow font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost =
  "border-2 border-beige-kem px-3 py-2 text-eyebrow font-bold text-beige-kem/80 transition disabled:opacity-40";

/**
 * Seat maps for one event.
 *
 * The screen is organised around the two steps that actually exist, because the old flat list hid
 * them behind two near-synonymous buttons ("Vẽ sơ đồ" / "Tạo sơ đồ ghế") and left organizers with a
 * drawn layout and nothing on sale, wondering which one they had already done:
 *
 *   1. DESIGN a chart — belongs to the VENUE, shared by every showtime there, and sells nothing.
 *   2. APPLY it to a showtime — snapshots the drawing into bookable, priced seats for that one date.
 *
 * So the design step is presented once per venue (not once per showtime, which implied it was
 * per-date), and every showtime states plainly how many seats are actually on sale.
 */
export default function SeatMapBuilder({
  eventId,
  onClose,
}: {
  eventId: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ManageShowtime[] | null>(null);
  const [map, setMap] = useState<Record<string, number>>({}); // `${showtimeId}:${categoryId}` → tierId
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The chart on the canvas, and the VENUE it was opened from.
   *
   * The venue rides along because the editor now shows the event's tier labels beside the chart's
   * price classes, and tiers hang off showtimes — which are grouped by venue. A bare layout id
   * cannot get back to them: one event may run at several venues with different tiers at each, so
   * "the tiers of this event" is the wrong question and "the tiers of this venue's showtimes" is
   * the right one.
   */
  const [editing, setEditing] = useState<{ layoutId: number; venueId: number } | null>(null);
  /** Which venue has its quick-tools drawer open. Per venue, so two venues cannot share one form. */
  const [tools, setTools] = useState<number | null>(null);
  /** A venue with several charts asks which one to open before the editor mounts. */
  const [choosing, setChoosing] = useState<{
    venueId: number;
    name: string;
    layouts: LayoutSummary[];
  } | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await organizerApi.showtimesManage(eventId));
    } catch (e) {
      setRows(null);
      setLoadError((e as Error).message);
    }
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Open the venue's chart on the canvas, creating one if the venue has none yet.
   *
   * A venue may own several charts (the library supports it), and this button used to open the
   * FIRST unconditionally — chart #2 was unreachable from here. One chart opens straight away;
   * several ask which.
   */
  const openEditor = async (venueId: number, venueName: string) => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const { layouts } = await layoutApi.list(venueId);
      if (layouts.length === 0) {
        setEditing({ layoutId: (await layoutApi.create(venueId, "Sơ đồ mặc định")).id, venueId });
      } else if (layouts.length === 1) {
        setEditing({ layoutId: layouts[0].id, venueId });
      } else {
        // Several charts: ask which one, rather than always opening the first.
        setChoosing({ venueId, name: venueName, layouts });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Price every class, then bind the chart.
   *
   * The mapping is written onto the TIERS rather than passed to the generate call, so it survives:
   * the next showtime of this chart already knows which class costs what, instead of asking again.
   * The older flow validated this same mapping and then dropped it on the floor — it never reached
   * the server at all, so a generated map came back with nothing priced.
   */
  const applyToShowtime = (st: ManageShowtime) => {
    if (st.layoutId === null) {
      setErr("Suất này chưa có sơ đồ để áp dụng.");
      return;
    }
    const withSeats = st.categories.filter((c) => c.seatCount > 0);
    const chosen = withSeats.map((c) => ({ categoryId: c.id, tierId: map[`${st.id}:${c.id}`] }));
    if (chosen.some((m) => !m.tierId)) {
      setErr("Mỗi hạng vé có ghế phải chọn một mức giá.");
      return;
    }
    void run(async () => {
      for (const { categoryId, tierId } of chosen) {
        await studioApi.updateTier(tierId, { categoryId });
      }
      await organizerApi.generateSeatMap(st.id, st.layoutId as number);
    }, "Đã áp dụng sơ đồ — ghế đã sẵn sàng để bán.");
  };

  if (editing !== null) {
    /*
     * Every live tier label sold at this venue, deduplicated.
     *
     * Across ALL of the venue's showtimes rather than one, because the chart is shared by them: a
     * class named after a tier that only the Saturday showtime has is still correctly named, and
     * warning about it would be wrong. Archived tiers are excluded for the reason every other tier
     * read excludes them — a retired class is not a price anything may be bound to.
     */
    const tierLabels = [
      ...new Set(
        (rows ?? [])
          .filter((s) => s.venueId === editing.venueId)
          .flatMap((s) => s.tiers.filter((t) => !t.archived).map((t) => t.label)),
      ),
    ];
    return (
      <ChartEditor
        layoutId={editing.layoutId}
        tierLabels={tierLabels}
        onClose={() => {
          setEditing(null);
          void reload();
        }}
      />
    );
  }

  // One card per venue, with its showtimes beneath — the design step is a property of the venue.
  const venues = new Map<number, { name: string; showtimes: ManageShowtime[] }>();
  for (const st of rows ?? []) {
    const entry = venues.get(st.venueId) ?? { name: st.venueName, showtimes: [] };
    entry.showtimes.push(st);
    venues.set(st.venueId, entry);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 text-beige-kem">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-title-m font-black">Sơ đồ ghế</h2>
          <button onClick={onClose} className={ghost}>
            Đóng
          </button>
        </div>

        <div className="rounded-2xl border-2 border-beige-kem/40 bg-surface-2 p-4">
          <p className="text-body text-beige-kem/80">Hai bước, làm theo thứ tự:</p>
          <ol className="mt-2 space-y-1 text-body text-beige-kem/70">
            <li>
              <b>1. Thiết kế sơ đồ địa điểm</b> — vẽ vị trí ghế cho <i>địa điểm</i>. Dùng chung cho
              mọi suất tại đó, và <b>chưa bán được vé</b>.
            </li>
            <li>
              <b>2. Áp dụng cho từng suất</b> — chép sơ đồ vào một suất cụ thể và gán hạng vé. Sau
              bước này ghế mới thực sự lên sàn bán.
            </li>
          </ol>
        </div>

        {notice && (
          <div className="rounded-xl border-2 border-la-co bg-la-co/20 p-3 text-eyebrow text-beige-kem">
            {notice}
          </div>
        )}
        {err && (
          <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-eyebrow">
            {err}
          </div>
        )}

        {loadError && <ErrorRetry message={loadError} onRetry={reload} />}
        {!loadError && rows === null && <Loading label="Đang tải suất chiếu…" />}
        {!loadError && rows?.length === 0 && (
          <Empty
            title="Sự kiện chưa có suất chiếu nào."
            hint='Thêm suất chiếu ở màn "Quản lý sự kiện" trước, rồi quay lại đây để dựng sơ đồ ghế.'
          />
        )}

        {[...venues.entries()].map(([venueId, venue]) => {
          const drawn = venue.showtimes[0].sections.reduce((n, s) => n + s.seatCount, 0);
          return (
            <div key={venueId} className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
              {/* ---- step 1: the venue's design ---- */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-body font-bold">{venue.name}</p>
                  <p className="font-meta text-meta text-ink-soft">
                    Đã vẽ {drawn} ghế · dùng chung cho {venue.showtimes.length} suất tại địa điểm
                    này
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={ghost}
                    onClick={() => setTools(tools === venueId ? null : venueId)}
                  >
                    Công cụ nhanh
                  </button>
                  <button
                    className={btn}
                    disabled={busy}
                    onClick={() => void openEditor(venueId, venue.name)}
                  >
                    Thiết kế sơ đồ
                  </button>
                </div>
              </div>

              {choosing?.venueId === venueId && (
                <div className="mt-3 rounded-xl border-2 border-beige-kem/50 p-3">
                  <p className="text-eyebrow text-beige-kem/70">
                    Địa điểm này có {choosing.layouts.length} sơ đồ — chọn một để mở:
                  </p>
                  <div className="mt-2 grid gap-1">
                    {choosing.layouts.map((l) => (
                      <button
                        key={l.id}
                        className={`${ghost} flex items-center justify-between text-left`}
                        disabled={busy}
                        onClick={() => {
                          setChoosing(null);
                          setEditing({ layoutId: l.id, venueId: choosing.venueId });
                        }}
                      >
                        <span>
                          {l.name}
                          {l.status !== "ready" && (
                            <span className="ml-2 font-meta text-meta text-cam-dat-ink">
                              bản nháp
                            </span>
                          )}
                        </span>
                        <span className="font-meta text-meta text-ink-soft">{l.seatCount} ghế</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {drawn === 0 && (
                <p className="mt-2 font-meta text-meta text-cam-dat-ink">
                  Địa điểm này chưa có ghế nào. Hãy thiết kế sơ đồ trước khi áp dụng cho suất.
                </p>
              )}

              {tools === venueId && (
                <QuickTools venueId={venueId} showtime={venue.showtimes[0]} run={run} />
              )}

              {/* ---- step 2: apply to each showtime ---- */}
              <div className="mt-4 space-y-3 border-t border-beige-kem/25 pt-4">
                {venue.showtimes.map((st) => (
                  <div key={st.id} className="rounded-xl border-2 border-beige-kem/50 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-body font-bold">
                        {new Date(st.startsAt).toLocaleString("vi-VN")}
                      </span>
                      <span
                        className={`border px-2 py-1 font-meta text-meta font-bold ${
                          st.hasSeatMap
                            ? "border-la-co/60 bg-la-co/20 text-beige-kem"
                            : "border-beige-kem/25 bg-beige-kem/5 text-ink-soft"
                        }`}
                      >
                        {st.hasSeatMap ? `${st.bookableSeats} ghế đang bán` : "Chưa áp dụng sơ đồ"}
                      </span>
                    </div>

                    {st.hasSeatMap ? (
                      <ShowtimeMapPanel
                        showtimeId={st.id}
                        tiers={st.tiers}
                        onDone={() => void reload()}
                      />
                    ) : st.categories.filter((c) => c.seatCount > 0).length === 0 ? (
                      <p className="text-eyebrow text-ink-soft">
                        Chưa có ghế để áp dụng — hoàn tất bước 1 trước.
                      </p>
                    ) : st.layoutStatus !== "ready" ? (
                      <p className="text-eyebrow text-ink-soft">
                        Sơ đồ đang là bản nháp. Mở trình thiết kế và bấm “Phát hành” trước khi áp
                        dụng cho suất diễn.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="font-meta text-meta text-ink-soft">
                          Đặt giá cho từng hạng vé, rồi áp dụng:
                        </p>
                        {st.categories
                          .filter((c) => c.seatCount > 0)
                          .map((c) => (
                            <div key={c.id} className="flex items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0 rounded border-2"
                                style={{ borderColor: c.color, backgroundColor: `${c.color}59` }}
                              />
                              <span className="w-36 shrink-0 text-body">
                                {c.name}{" "}
                                <span className="font-meta text-meta text-beige-kem/40">
                                  ({c.seatCount} ghế)
                                </span>
                              </span>
                              <Select
                                triggerClassName={input}
                                placeholder="Chọn mức giá"
                                value={String(map[`${st.id}:${c.id}`] ?? "")}
                                onChange={(v) =>
                                  setMap((m) => ({ ...m, [`${st.id}:${c.id}`]: Number(v) }))
                                }
                                options={st.tiers
                                  .filter((t) => !t.archived)
                                  .map((t) => ({
                                    value: String(t.id),
                                    label: `${t.label} — ${t.price.toLocaleString("vi-VN")}đ`,
                                  }))}
                              />
                            </div>
                          ))}
                        <button
                          className={`${btn} mt-1`}
                          disabled={busy}
                          onClick={() => applyToShowtime(st)}
                        >
                          Áp dụng sơ đồ cho suất này
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Section/Row/Count generator that predates the canvas (feature 002). Kept as a fast way to seed
 * a block of seats, but demoted behind a drawer: having it sit level with the canvas made it look
 * like a second, competing way to build a map.
 *
 * Its form state lives HERE, per venue — as one shared set of fields on the parent it leaked between
 * cards, so typing a row label under one venue changed what another would submit.
 */
function QuickTools({
  venueId,
  showtime,
  run,
}: {
  venueId: number;
  showtime: ManageShowtime;
  run: (fn: () => Promise<void>, ok: string) => Promise<void>;
}) {
  const [secName, setSecName] = useState("");
  const [seatSection, setSeatSection] = useState<number | "">("");
  const [seatRow, setSeatRow] = useState("A");
  const [seatCount, setSeatCount] = useState("10");

  return (
    <div className="mt-3 space-y-2 rounded-xl border-2 border-dashed border-beige-kem/40 p-3">
      <p className="font-meta text-meta text-ink-soft">
        Tạo nhanh một dãy ghế. Vị trí sẽ xếp theo lưới — tinh chỉnh bằng trình thiết kế.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex gap-2">
          <input
            value={secName}
            onChange={(e) => setSecName(e.target.value)}
            placeholder="Tên khu vực (VD Khu A)"
            className={input}
          />
          <button
            className={ghost}
            onClick={() =>
              secName &&
              run(async () => {
                await organizerApi.createSection(venueId, secName);
                setSecName("");
              }, "Đã thêm khu vực.")
            }
          >
            Thêm khu
          </button>
        </div>
        <div className="flex gap-2">
          <Select
            triggerClassName={input}
            placeholder="Khu vực"
            value={String(seatSection)}
            onChange={(v) => setSeatSection(Number(v) || "")}
            options={showtime.sections.map((s) => ({ value: String(s.id), label: s.name }))}
          />
          <input
            value={seatRow}
            onChange={(e) => setSeatRow(e.target.value)}
            placeholder="Hàng"
            className={`${input} w-16`}
          />
          <input
            value={seatCount}
            onChange={(e) => setSeatCount(e.target.value)}
            placeholder="SL"
            className={`${input} w-16`}
          />
          <button
            className={ghost}
            onClick={() =>
              seatSection &&
              run(async () => {
                await organizerApi.addSeats(venueId, {
                  sectionId: Number(seatSection),
                  rowLabel: seatRow,
                  count: Number(seatCount),
                });
              }, "Đã thêm ghế.")
            }
          >
            Thêm ghế
          </button>
        </div>
      </div>
    </div>
  );
}
