/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import type { SeatMap, Showtime } from "@/shared/catalog/types";
import { catalogClient } from "../services/catalogClient";

const ghost = "rounded-xl border border-beige-kem/15 px-3 py-2 text-xs font-bold text-beige-kem/80 transition hover:border-cam-dat";

const seatColor: Record<string, string> = {
  available: "border-la-co/60 text-la-co",
  held: "border-cam-dat/60 text-cam-dat",
  sold: "border-beige-kem/15 text-beige-kem/30",
  blocked: "border-beige-kem/15 text-beige-kem/30",
};

export default function SeatMapView({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [showtimeId, setShowtimeId] = useState<number | null>(null);
  const [map, setMap] = useState<SeatMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    catalogClient
      .getShowtimes(eventId)
      .then((st) => {
        setShowtimes(st);
        if (st[0]) setShowtimeId(st[0].id);
      })
      .catch((e) => setErr((e as Error).message));
  }, [eventId]);

  useEffect(() => {
    if (showtimeId === null) return;
    setMap(null);
    catalogClient.getSeatMap(showtimeId).then(setMap).catch((e) => setErr((e as Error).message));
  }, [showtimeId]);

  // group seated seats by row
  const rows = useMemo(() => {
    if (map?.eventType !== "seated" || !map.seats) return [];
    const byRow = new Map<string, typeof map.seats>();
    for (const s of map.seats) {
      const list = byRow.get(s.row) ?? [];
      list.push(s);
      byRow.set(s.row, list);
    }
    return [...byRow.entries()].map(([row, seats]) => ({ row, seats: seats.sort((a, b) => a.number - b.number) }));
  }, [map]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho/95 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 text-beige-kem">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-black">Sơ đồ ghế / vé</h2>
          <button onClick={onClose} className={ghost}>Đóng</button>
        </div>
        {err && <div className="rounded-xl border border-burgundy/40 bg-burgundy/10 p-3 text-xs">{err}</div>}

        {showtimes.length > 1 && (
          <select
            value={showtimeId ?? ""}
            onChange={(e) => setShowtimeId(Number(e.target.value))}
            className="h-11 w-full rounded-xl border border-beige-kem/20 bg-white/[0.035] px-4 text-sm text-beige-kem outline-none focus:border-cam-dat"
          >
            {showtimes.map((s) => (
              <option key={s.id} value={s.id} className="bg-xanh-pho">
                {new Date(s.startsAt).toLocaleString("vi-VN")} · {s.venue.name}
              </option>
            ))}
          </select>
        )}

        {!map && !err && <p className="text-sm text-beige-kem/60">Đang tải…</p>}

        {map?.eventType === "seated" && (
          <div className="rounded-2xl border border-beige-kem/10 bg-white/[0.02] p-5">
            <div className="mb-4 rounded-lg bg-white/[0.04] py-1 text-center font-mono text-[10px] uppercase tracking-widest text-beige-kem/50">Sân khấu</div>
            <div className="space-y-2">
              {rows.map(({ row, seats }) => (
                <div key={row} className="flex items-center justify-center gap-1.5">
                  <span className="w-6 text-right font-mono text-[10px] text-beige-kem/40">{row}</span>
                  {seats.map((s) => (
                    <span
                      key={s.id}
                      title={`${s.row}${s.number} · ${s.tier} · ${s.price.toLocaleString("vi-VN")}đ · ${s.status}`}
                      className={`grid h-7 w-7 place-items-center rounded-md border text-[10px] font-bold ${seatColor[s.status] ?? ""}`}
                    >
                      {s.number}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10px] text-beige-kem/50">
              <span className="text-la-co">■ Còn trống</span>
              <span className="text-cam-dat">■ Đang giữ</span>
              <span className="text-beige-kem/30">■ Đã bán</span>
            </div>
          </div>
        )}

        {map?.eventType === "general_admission" && (
          <div className="space-y-2">
            {map.tiers?.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-beige-kem/10 bg-white/[0.02] p-4">
                <span className="font-bold">{t.label}</span>
                <span className="font-mono text-sm">
                  {t.price.toLocaleString("vi-VN")}đ · {t.remaining === null ? "còn vé" : t.remaining > 0 ? `còn ${t.remaining}` : "Hết vé"}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="font-mono text-[11px] text-beige-kem/45">Đăng nhập để chọn ghế và đặt vé (sắp có).</p>
      </div>
    </div>
  );
}
