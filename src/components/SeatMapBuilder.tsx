/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import type { LayoutSummary } from "../../shared/catalog/seatmap";
import { ManageShowtime, layoutApi, organizerApi } from "../services/catalogClient";
import { Empty, ErrorRetry, Loading } from "./organizer/states";
import ChartEditor from "./seatmap/ChartEditor";
import ShowtimeMapPanel from "./seatmap/ShowtimeMapPanel";
import Select from "./Select";

/* Shared form styles for the seat-map builder controls. */
const inputBase =
  "h-10 rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-body text-beige-kem outline-none focus:border-burgundy";
const input = `${inputBase} w-full`;
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
  /*
   * WHICH chart each showtime is being applied from, when its venue has more than one.
   *
   * Apply used to send `st.layoutId`, a value the SERVER chose: the chart the showtime had already
   * generated from, or — for one that had not — the venue's oldest chart, filtered by nothing. So an
   * organizer could open chart B in the editor, publish it, come back, and bind chart A, with the
   * price classes on screen belonging to A while they believed they were applying B. The choice is
   * the organizer's now, and `assignableLayouts` is the set the server will actually accept.
   */
  const [chosenLayout, setChosenLayout] = useState<Record<number, number>>({});
  /**
   * The chart this showtime will actually be bound to — as an OBJECT, not an id (0035 finding 3).
   *
   * Everything the panel shows for an unbound showtime hangs off this: the readiness copy, the picker
   * value, and the price classes to fill in. Reading `st.categories` and `st.layoutStatus` beside a
   * picker that changed only an id is what let chart B be submitted with chart A's class ids.
   *
   * A stale selection — a chart archived or unpublished in another tab since this list loaded — falls
   * back rather than sticking, because `chosenLayout` is keyed by showtime and nothing else clears it.
   */
  const layoutFor = (st: ManageShowtime): ManageShowtime["assignableLayouts"][number] | null => {
    const pick = st.assignableLayouts.find((l) => l.id === chosenLayout[st.id]);
    return (
      pick ??
      st.assignableLayouts.find((l) => l.id === st.layoutId) ??
      st.assignableLayouts[0] ??
      null
    );
  };
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

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      if (ok) setNotice(ok);
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
      const { layouts: allLayouts } = await layoutApi.list(venueId);
      const layouts = allLayouts.filter(
        (layout) => layout.status !== "archived" && !layout.isTemplate,
      );
      if (layouts.length === 0) {
        let name = "Sơ đồ mặc định";
        for (let suffix = 2; allLayouts.some((layout) => layout.name === name); suffix++)
          name = `Sơ đồ mặc định ${suffix}`;
        setEditing({ layoutId: (await layoutApi.create(venueId, name)).id, venueId });
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
    const chart = layoutFor(st);
    if (chart === null) {
      setErr("Địa điểm này chưa có sơ đồ nào đã phát hành để áp dụng.");
      return;
    }
    // `hasInventory`, not `seatCount`: a capacity ZONE holds inventory with no seat rows, so the
    // seat count reads zero while the apply gate still demands a price for it — the console showed
    // the chart ready and the server refused `category_without_tier`. One predicate, the server's.
    //
    // From the CHOSEN chart, not from `st.categories`: those two differ the moment the picker is used.
    const stocked = chart.categories.filter((c) => c.hasInventory);
    const mappings = stocked.map((c) => ({ categoryId: c.id, tierId: map[`${st.id}:${c.id}`] }));
    if (mappings.some((m) => !m.tierId)) {
      setErr("Mỗi hạng ghế có vé phải chọn một mức giá.");
      return;
    }
    // Refused here as well as on the server: a tier holds ONE class, so two classes pointing at the
    // same tier silently kept whichever was written last.
    const tierIds = mappings.map((m) => m.tierId);
    if (new Set(tierIds).size !== tierIds.length) {
      setErr("Mỗi mức giá chỉ được chọn cho một hạng ghế.");
      return;
    }
    void run(async () => {
      const { returnedToReview, seats, zoneCapacity } = await organizerApi.applyChart(st.id, {
        layoutId: chart.id,
        mappings: mappings as { categoryId: number; tierId: number }[],
      });
      // The moderation answer the tier writes produce, said out loud instead of discarded.
      // What was actually generated, in the units it was generated in.
      const made =
        [seats > 0 ? `${seats} ghế` : null, zoneCapacity > 0 ? `${zoneCapacity} chỗ đứng` : null]
          .filter(Boolean)
          .join(" + ") || "sơ đồ";
      setNotice(
        returnedToReview
          ? `Đã áp dụng ${made}. Vì đổi hạng ghế của vé, sự kiện quay lại chờ duyệt trước khi bán tiếp.`
          : `Đã áp dụng ${made}. Vé chỉ mở bán khi sự kiện được duyệt và đang đăng bán.`,
      );
    });
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
                        {/* `bookableSeats` counts the map's SELLABLE seats — every status except
                            `blocked`, and only on tiers still live (an archived tier is history, not
                            inventory). It names the SIZE of what this showtime sells, not what is still
                            buyable this moment; zones are shown beside it, not added into it. */}
                        {!st.hasSeatMap
                          ? "Chưa áp dụng sơ đồ"
                          : [
                              st.bookableSeats > 0 ? `${st.bookableSeats} ghế` : null,
                              st.zoneCapacity > 0 ? `${st.zoneCapacity} chỗ đứng` : null,
                            ]
                              .filter(Boolean)
                              .join(" + ") || "Đã áp dụng sơ đồ"}
                      </span>
                    </div>

                    {st.hasSeatMap ? (
                      <ShowtimeMapPanel
                        showtimeId={st.id}
                        tiers={st.tiers}
                        onDone={() => void reload()}
                      />
                    ) : /* Readiness is now the CHOSEN chart's own (0035 finding 3): `assignableLayouts` only ever
           contains published charts, so an empty list IS "nothing ready", and a draft sitting at the
           top of the venue no longer hides a published chart beside it. */
                    st.assignableLayouts.length === 0 ? (
                      <p className="text-eyebrow text-ink-soft">
                        {st.layoutStatus === null
                          ? "Chưa có ghế để áp dụng — hoàn tất bước 1 trước."
                          : "Sơ đồ đang là bản nháp. Mở trình thiết kế và bấm “Phát hành” trước khi áp dụng cho suất diễn."}
                      </p>
                    ) : (layoutFor(st)?.categories.filter((c) => c.hasInventory).length ?? 0) ===
                      0 ? (
                      <p className="text-eyebrow text-ink-soft">
                        Sơ đồ này chưa có ghế hay khu sức chứa nào để áp dụng.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {/* Only when there is a real choice — one chart needs no picker. */}
                        {st.assignableLayouts.length > 1 && (
                          <label className="block">
                            <span className="mb-1 block font-meta text-eyebrow text-beige-kem/70">
                              Áp dụng sơ đồ
                            </span>
                            <Select
                              triggerClassName={input}
                              placeholder="Chọn sơ đồ"
                              value={String(layoutFor(st)?.id ?? "")}
                              onChange={(v) =>
                                setChosenLayout((m) => ({ ...m, [st.id]: Number(v) }))
                              }
                              options={st.assignableLayouts.map((l) => ({
                                value: String(l.id),
                                label: `${l.name} · ${l.seatCount} ghế`,
                              }))}
                            />
                          </label>
                        )}
                        <p className="font-meta text-meta text-ink-soft">
                          Đặt giá cho từng hạng vé, rồi áp dụng:
                        </p>
                        {(layoutFor(st)?.categories ?? [])
                          .filter((c) => c.hasInventory)
                          .map((c) => (
                            <div key={c.id} className="flex items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0 rounded border-2"
                                style={{ borderColor: c.color, backgroundColor: `${c.color}59` }}
                              />
                              <span className="w-36 shrink-0 text-body">
                                {c.name}{" "}
                                {/* A capacity ZONE has inventory and no seat rows, so "0 ghế" was
                                    a lie about the one class that most needed explaining. */}
                                <span className="font-meta text-meta text-beige-kem/40">
                                  ({c.seatCount > 0 ? `${c.seatCount} ghế` : "khu sức chứa"})
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
