/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import type { SeatMap } from "@/shared/catalog/types";
import { catalogClient } from "../services/catalogClient";

const seatColor: Record<string, string> = {
  available: "border-la-co/60 text-ink-soft",
  held: "border-cam-dat/60 text-ink-soft",
  sold: "border-beige-kem/25 text-beige-kem/30",
  blocked: "border-beige-kem/25 text-beige-kem/30",
};

/**
 * Read-only seat availability for one showtime, straight from the catalog API.
 *
 * Seated events only: a general-admission showtime has no seats, and its remaining quantity is
 * shown on the ticket-tier cards instead. Selecting or holding a seat is the seat-holds feature —
 * this panel never mutates anything.
 */
export default function SeatMapView({ showtimeId }: { showtimeId: number }) {
  const [map, setMap] = useState<SeatMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setMap(null);
    setErr(null);
    catalogClient
      .getSeatMap(showtimeId)
      .then((res) => !stale && setMap(res))
      .catch((e) => !stale && setErr((e as Error).message));
    return () => {
      stale = true;
    };
  }, [showtimeId]);

  const rows = useMemo(() => {
    if (map?.eventType !== "seated" || !map.seats) return [];
    const byRow = new Map<string, typeof map.seats>();
    for (const s of map.seats) {
      const list = byRow.get(s.row) ?? [];
      list.push(s);
      byRow.set(s.row, list);
    }
    return [...byRow.entries()].map(([row, seats]) => ({
      row,
      seats: seats.sort((a, b) => a.number - b.number),
    }));
  }, [map]);

  if (err) {
    return (
      <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs text-on-tint">
        {err}
      </div>
    );
  }

  if (!map) return <p className="text-sm text-beige-kem/60">Đang tải sơ đồ ghế…</p>;
  if (map.eventType !== "seated") return null;

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-5">
      <div className="mb-4 rounded-lg bg-surface-2 py-1 text-center font-mono text-[10px] uppercase tracking-widest text-beige-kem/50">
        Sân khấu
      </div>
      <div className="space-y-2 overflow-x-auto">
        {rows.map(({ row, seats }) => (
          <div key={row} className="flex items-center justify-center gap-1.5">
            <span className="w-6 shrink-0 text-right font-mono text-[10px] text-beige-kem/40">{row}</span>
            {seats.map((s) => (
              <span
                key={s.id}
                title={`${s.row}${s.number} · ${s.tier} · ${s.price.toLocaleString("vi-VN")}đ · ${s.status}`}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border text-[10px] font-bold ${seatColor[s.status] ?? ""}`}
              >
                {s.number}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10px] text-beige-kem/50">
        <span className="text-ink-soft">■ Còn trống</span>
        <span className="text-ink-soft">■ Đang giữ</span>
        <span className="text-beige-kem/30">■ Đã bán</span>
      </div>
    </div>
  );
}
