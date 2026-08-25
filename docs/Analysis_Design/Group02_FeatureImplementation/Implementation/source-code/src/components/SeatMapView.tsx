/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { SeatMap, SeatMapSeat } from "@/shared/catalog/types";
import { catalogClient } from "../services/catalogClient";
import SeatCanvas from "./seatmap/SeatCanvas";

const seatColor: Record<string, string> = {
  available: "fill-transparent stroke-la-co/70",
  held: "fill-transparent stroke-cam-dat/70",
  sold: "fill-beige-kem/10 stroke-beige-kem/25",
  blocked: "fill-beige-kem/10 stroke-beige-kem/25",
};

const statusText: Record<string, string> = {
  available: "còn trống",
  held: "đang giữ",
  sold: "đã bán",
  blocked: "không bán",
};

/**
 * Read-only seat availability for one showtime, straight from the catalog API.
 *
 * Renders from the layout's COORDINATES (feature 005) through the shared SeatCanvas — the same
 * surface the seat-selection screen uses, so the two can never disagree about where a seat is. The
 * old row-grouped flex layout is gone: every venue used to look identical regardless of its shape.
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

  if (err) {
    return (
      <div className="rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs text-on-tint">
        {err}
      </div>
    );
  }

  if (!map) return <p className="text-sm text-beige-kem/60">Đang tải sơ đồ ghế…</p>;
  if (map.eventType !== "seated") return null;

  const seats = map.seats ?? [];
  const label = (s: SeatMapSeat) =>
    `${s.section ? `${s.section}, ` : ""}hàng ${s.row}, ghế ${s.number} — ${s.tier} · ${s.price.toLocaleString("vi-VN")}đ · ${statusText[s.status] ?? s.status}`;

  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-5">
      <SeatCanvas
        seats={seats}
        elements={map.elements}
        floorPlan={map.floorPlan}
        space={map.space}
        seatClass={(s) => seatColor[s.status] ?? ""}
        seatLabel={label}
      />
      <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10px] text-beige-kem/50">
        <span className="text-ink-soft">■ Còn trống</span>
        <span className="text-ink-soft">■ Đang giữ</span>
        <span className="text-beige-kem/30">■ Đã bán</span>
      </div>
    </div>
  );
}
