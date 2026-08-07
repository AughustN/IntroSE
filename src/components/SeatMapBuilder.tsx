/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { ManageShowtime, layoutApi, organizerApi } from "../services/catalogClient";
import LayoutEditor from "./seatmap/LayoutEditor";
import ShowtimeMapPanel from "./seatmap/ShowtimeMapPanel";
import Select from "./Select";

const input =
  "h-10 w-full rounded-lg border-2 border-beige-kem bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const btn =
  "rounded-lg bg-burgundy px-3 py-2 text-xs font-black text-white transition hover:brightness-95";
const ghost =
  "rounded-lg border-2 border-beige-kem px-3 py-2 text-xs font-bold text-beige-kem/80 transition";

export default function SeatMapBuilder({
  eventId,
  onClose,
}: {
  eventId: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ManageShowtime[]>([]);
  const [map, setMap] = useState<Record<string, number>>({}); // `${showtimeId}:${sectionId}` → tierId
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // add-section / add-seats forms per venue
  const [secName, setSecName] = useState("");
  const [seatSection, setSeatSection] = useState<number | "">("");
  const [seatRow, setSeatRow] = useState("A");
  const [seatCount, setSeatCount] = useState("10");
  // Which layout the free-hand editor is open on. The Section/Row/Count form above stays as the fast
  // first step; the canvas is where it gets refined by hand (FR-010).
  const [editing, setEditing] = useState<number | null>(null);

  /** Open the venue's layout on the canvas, creating one if the venue has none yet. */
  const openEditor = (venueId: number) =>
    run(async () => {
      const { layouts } = await layoutApi.list(venueId);
      const target = layouts[0] ?? (await layoutApi.create(venueId, "Sơ đồ mặc định"));
      setEditing(target.id);
    }, "Đang mở trình vẽ sơ đồ.");

  const reload = () =>
    organizerApi
      .showtimesManage(eventId)
      .then(setRows)
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    reload();
  }, [eventId]);

  const run = async (fn: () => Promise<void>, ok: string) => {
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

  const generate = (st: ManageShowtime) => {
    const withSeats = st.sections.filter((s) => s.seatCount > 0);
    const sectionTiers = withSeats.map((s) => ({
      sectionId: s.id,
      ticketTierId: map[`${st.id}:${s.id}`],
    }));
    if (sectionTiers.some((m) => !m.ticketTierId)) {
      setErr("Mỗi khu vực có ghế phải chọn một hạng vé.");
      return;
    }
    run(async () => {
      await organizerApi.generateSeatMap(st.id, sectionTiers);
    }, "Đã tạo sơ đồ ghế.");
  };

  if (editing !== null) {
    return (
      <LayoutEditor
        layoutId={editing}
        onClose={() => {
          setEditing(null);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 text-beige-kem">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl font-black">Sơ đồ ghế</h2>
          <button onClick={onClose} className={ghost}>
            Đóng
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
        {rows.length === 0 && (
          <p className="text-sm text-beige-kem/60">
            Chưa có suất chiếu. Thêm suất chiếu trước ở màn "Quản lý sự kiện".
          </p>
        )}

        {rows.map((st) => (
          <div key={st.id} className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold">
                {new Date(st.startsAt).toLocaleString("vi-VN")} · {st.venueName}
              </span>
              <div className="flex items-center gap-2">
                {st.hasSeatMap && (
                  <span className="rounded-lg border-2 border-beige-kem bg-la-co px-2 py-0.5 font-mono text-[10px] text-on-tint">
                    Đã có sơ đồ ghế
                  </span>
                )}
                <button className={ghost} onClick={() => openEditor(st.venueId)}>
                  Vẽ sơ đồ
                </button>
              </div>
            </div>

            {st.hasSeatMap && (
              <ShowtimeMapPanel showtimeId={st.id} tiers={st.tiers} onDone={() => void reload()} />
            )}

            {!st.hasSeatMap && (
              <>
                {/* manage sections + seats for this venue */}
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
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
                          await organizerApi.createSection(st.venueId, secName);
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
                      options={st.sections.map((s) => ({ value: String(s.id), label: s.name }))}
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
                          await organizerApi.addSeats(st.venueId, {
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

                {/* section → tier mapping */}
                {st.sections.filter((s) => s.seatCount > 0).length === 0 ? (
                  <p className="text-xs text-beige-kem/50">
                    Thêm khu vực + ghế, rồi gán hạng vé cho từng khu để tạo sơ đồ.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {st.sections
                      .filter((s) => s.seatCount > 0)
                      .map((s) => (
                        <div key={s.id} className="flex items-center gap-3">
                          <span className="w-40 text-sm">
                            {s.name}{" "}
                            <span className="font-mono text-[10px] text-beige-kem/40">
                              ({s.seatCount} ghế)
                            </span>
                          </span>
                          <Select
                            triggerClassName={input}
                            placeholder="Chọn hạng vé"
                            value={String(map[`${st.id}:${s.id}`] ?? "")}
                            onChange={(v) =>
                              setMap((m) => ({ ...m, [`${st.id}:${s.id}`]: Number(v) }))
                            }
                            options={st.tiers.map((t) => ({
                              value: String(t.id),
                              label: `${t.label} — ${t.price.toLocaleString("vi-VN")}đ`,
                            }))}
                          />
                        </div>
                      ))}
                    <button className={`${btn} mt-2`} onClick={() => generate(st)}>
                      Tạo sơ đồ ghế
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
