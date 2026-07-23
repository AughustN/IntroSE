/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { ManageShowtime, organizerApi } from "../services/catalogClient";

const input = "h-10 w-full rounded-lg border border-beige-kem/20 bg-white/[0.035] px-3 text-sm text-beige-kem outline-none focus:border-cam-dat";
const btn = "rounded-lg bg-burgundy px-3 py-2 text-xs font-black text-beige-kem transition hover:bg-burgundy/90";
const ghost = "rounded-lg border border-beige-kem/15 px-3 py-2 text-xs font-bold text-beige-kem/80 transition hover:border-cam-dat";

export default function SeatMapBuilder({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const [rows, setRows] = useState<ManageShowtime[]>([]);
  const [map, setMap] = useState<Record<string, number>>({}); // `${showtimeId}:${sectionId}` → tierId
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // add-section / add-seats forms per venue
  const [secName, setSecName] = useState("");
  const [seatSection, setSeatSection] = useState<number | "">("");
  const [seatRow, setSeatRow] = useState("A");
  const [seatCount, setSeatCount] = useState("10");

  const reload = () => organizerApi.showtimesManage(eventId).then(setRows).catch((e) => setErr((e as Error).message));
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
    const sectionTiers = withSeats.map((s) => ({ sectionId: s.id, ticketTierId: map[`${st.id}:${s.id}`] }));
    if (sectionTiers.some((m) => !m.ticketTierId)) {
      setErr("Mỗi khu vực có ghế phải chọn một hạng vé.");
      return;
    }
    run(async () => {
      await organizerApi.generateSeatMap(st.id, sectionTiers);
    }, "Đã tạo sơ đồ ghế.");
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho/95 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 text-beige-kem">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-black">Sơ đồ ghế</h2>
          <button onClick={onClose} className={ghost}>Đóng</button>
        </div>
        {notice && <div className="rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-xs text-la-co">{notice}</div>}
        {err && <div className="rounded-xl border border-burgundy/40 bg-burgundy/10 p-3 text-xs">{err}</div>}
        {rows.length === 0 && <p className="text-sm text-beige-kem/60">Chưa có suất chiếu. Thêm suất chiếu trước ở màn "Quản lý sự kiện".</p>}

        {rows.map((st) => (
          <div key={st.id} className="rounded-2xl border border-beige-kem/10 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold">{new Date(st.startsAt).toLocaleString("vi-VN")} · {st.venueName}</span>
              {st.hasSeatMap && <span className="rounded-lg border border-la-co/40 bg-la-co/10 px-2 py-0.5 font-mono text-[10px] text-la-co">Đã có sơ đồ ghế</span>}
            </div>

            {!st.hasSeatMap && (
              <>
                {/* manage sections + seats for this venue */}
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
                  <div className="flex gap-2">
                    <input value={secName} onChange={(e) => setSecName(e.target.value)} placeholder="Tên khu vực (VD Khu A)" className={input} />
                    <button className={ghost} onClick={() => secName && run(async () => { await organizerApi.createSection(st.venueId, secName); setSecName(""); }, "Đã thêm khu vực.")}>Thêm khu</button>
                  </div>
                  <div className="flex gap-2">
                    <select value={seatSection} onChange={(e) => setSeatSection(Number(e.target.value) || "")} className={input}>
                      <option value="" className="bg-xanh-pho">Khu vực</option>
                      {st.sections.map((s) => <option key={s.id} value={s.id} className="bg-xanh-pho">{s.name}</option>)}
                    </select>
                    <input value={seatRow} onChange={(e) => setSeatRow(e.target.value)} placeholder="Hàng" className={`${input} w-16`} />
                    <input value={seatCount} onChange={(e) => setSeatCount(e.target.value)} placeholder="SL" className={`${input} w-16`} />
                    <button className={ghost} onClick={() => seatSection && run(async () => { await organizerApi.addSeats(st.venueId, { sectionId: Number(seatSection), rowLabel: seatRow, count: Number(seatCount) }); }, "Đã thêm ghế.")}>Thêm ghế</button>
                  </div>
                </div>

                {/* section → tier mapping */}
                {st.sections.filter((s) => s.seatCount > 0).length === 0 ? (
                  <p className="text-xs text-beige-kem/50">Thêm khu vực + ghế, rồi gán hạng vé cho từng khu để tạo sơ đồ.</p>
                ) : (
                  <div className="space-y-2">
                    {st.sections.filter((s) => s.seatCount > 0).map((s) => (
                      <div key={s.id} className="flex items-center gap-3">
                        <span className="w-40 text-sm">{s.name} <span className="font-mono text-[10px] text-beige-kem/40">({s.seatCount} ghế)</span></span>
                        <select
                          value={map[`${st.id}:${s.id}`] ?? ""}
                          onChange={(e) => setMap((m) => ({ ...m, [`${st.id}:${s.id}`]: Number(e.target.value) }))}
                          className={input}
                        >
                          <option value="" className="bg-xanh-pho">Chọn hạng vé</option>
                          {st.tiers.map((t) => <option key={t.id} value={t.id} className="bg-xanh-pho">{t.label} — {t.price.toLocaleString("vi-VN")}đ</option>)}
                        </select>
                      </div>
                    ))}
                    <button className={`${btn} mt-2`} onClick={() => generate(st)}>Tạo sơ đồ ghế</button>
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
