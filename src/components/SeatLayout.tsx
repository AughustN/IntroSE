/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SeatMap, SeatMapSeat, SeatStatus } from "@/shared/catalog/types";
import { MovieEvent, Seat } from "../types";
import { catalogClient } from "../services/catalogClient";
import { formatHoldClock } from "../services/holdSession";
import { watchShowtime } from "../services/seatSocket";
import SeatCanvas from "./seatmap/SeatCanvas";

interface SeatLayoutProps {
  event: MovieEvent;
  showtimeId: number | null;
  selectedDate: string;
  selectedTime: string;
  /**
   * The seats currently held, owned by `App` so they outlive this screen. Stepping forward to
   * checkout and back must return the same selection — holding state here is what lost it.
   */
  heldSeats: Seat[];
  /** Milliseconds left on the hold, counted from the server's absolute expiry. */
  remainingMs: number;
  /** Placing/releasing the hold is a server round trip, so clicks are disabled while one is open. */
  busy: boolean;
  onToggleSeat: (seat: Seat) => void;
  onBack: () => void;
  onProceedToCheckout: () => void;
}

export default function SeatLayout({
  event,
  showtimeId,
  selectedDate,
  selectedTime,
  heldSeats,
  remainingMs,
  busy,
  onToggleSeat,
  onBack,
  onProceedToCheckout,
}: SeatLayoutProps) {
  const [seats, setSeats] = useState<SeatMapSeat[]>([]);
  const [mapMeta, setMapMeta] = useState<Pick<SeatMap, "space" | "elements" | "floorPlan">>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const heldByMe = useMemo(
    () => new Set(heldSeats.map((seat) => seat.showtimeSeatId).filter((id): id is number => id !== undefined)),
    [heldSeats],
  );

  // The authoritative map, read from the database (002's read endpoint). The socket only patches it.
  const loadMap = useCallback(async () => {
    if (showtimeId === null) return;
    try {
      const map: SeatMap = await catalogClient.getSeatMap(showtimeId);
      setSeats(map.seats ?? []);
      // The static half of the map — coordinate space, decoration, background. It changes only when
      // the organizer edits the map, never on a hold, so it is kept apart from the seat statuses
      // that `seat:update` refreshes (feature 005, FR-041).
      setMapMeta({ space: map.space, elements: map.elements, floorPlan: map.floorPlan });
      setLoadError(null);
    } catch {
      setLoadError("Không tải được sơ đồ ghế. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }, [showtimeId]);

  useEffect(() => {
    setLoading(true);
    void loadMap();
  }, [loadMap]);

  // Live updates from everyone else's holds and from the expiry sweep (FR-021). Advisory: a missed
  // one only leaves a stale pixel — the server still refuses a stale click (FR-023).
  useEffect(() => {
    if (showtimeId === null) return;
    const stop = watchShowtime(showtimeId, (update) => {
      if (!update.seats?.length) return;
      setSeats((current) =>
        current.map((seat) => {
          const changed = update.seats!.find((s) => s.showtimeSeatId === seat.id);
          return changed ? { ...seat, status: changed.status } : seat;
        }),
      );
    });
    // Re-read the whole map on reconnect rather than trusting a patch stream we may have missed.
    const onOnline = () => void loadMap();
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      window.removeEventListener("online", onOnline);
    };
  }, [showtimeId, loadMap]);

  // When the buyer's own hold ends (countdown ran out, or they cancelled), re-read the map. The
  // seats are free on the server the instant the window passes, but the release broadcast only
  // arrives with the sweep up to a minute later — without this, their own lapsed seats would sit
  // greyed out and unclickable in the meantime.
  const heldCount = heldSeats.length;
  const previousHeldCount = useRef(heldCount);
  useEffect(() => {
    if (previousHeldCount.current > 0 && heldCount === 0) void loadMap();
    previousHeldCount.current = heldCount;
  }, [heldCount, loadMap]);

  // Seats arrive already ordered section → row → number, which is both the draw order and the tab
  // order (feature 005, FR-039a). The old row-grouping is gone: geometry decides placement now.

  const toggleSeatSelection = (seat: SeatMapSeat) => {
    const mine = heldByMe.has(seat.id);
    if (!mine && seat.status !== "available") return; // taken by someone else, or sold/blocked
    onToggleSeat({
      id: `${seat.row}${seat.number}`,
      row: seat.row,
      number: seat.number,
      type: "single",
      price: seat.price,
      isBooked: false,
      showtimeSeatId: seat.id,
    });
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(price);

  const selectedSeatsList = heldSeats;
  const totalPrice = selectedSeatsList.reduce((sum, seat) => sum + seat.price, 0);
  const holdTimeLabel = formatHoldClock(remainingMs);
  const tierPrices = [...new Set(seats.map((s) => s.price))].sort((a, b) => a - b);

  const seatClasses = (seat: SeatMapSeat): string => {
    if (heldByMe.has(seat.id)) return "fill-burgundy stroke-burgundy";
    if (seat.status === "sold" || seat.status === "blocked") return "fill-stone-800 stroke-stone-800";
    if (seat.status === "held") return "fill-stone-700/60 stroke-stone-700";
    return "fill-transparent stroke-beige-kem/40 hover:stroke-burgundy";
  };

  /** What a screen reader announces. Section, row, seat, status, price — enough to choose a seat
   *  without seeing the map (FR-039a). */
  const statusTitle = (seat: SeatMapSeat): string => {
    const price = formatPrice(seat.price);
    const where = `${seat.section ? `${seat.section}, ` : ""}hàng ${seat.row}, ghế ${seat.number}`;
    if (heldByMe.has(seat.id)) return `${where} — bạn đang giữ (${price})`;
    const label: Record<SeatStatus, string> = {
      available: "còn trống",
      held: "người khác đang giữ",
      sold: "đã bán",
      blocked: "không mở bán",
    };
    return `${where} — ${label[seat.status]} (${price})`;
  };

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
      {/* Header and indicator step */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-beige-kem/25 pb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-ink-soft hover:text-beige-kem transition font-mono"
        >
          QUAY LẠI CHI TIẾT SỰ KIỆN
        </button>

        <div className="flex items-center gap-2 sm:gap-4 font-mono text-xs text-ink-soft">
          <span>01. CHỌN SUẤT</span>
          <span className="h-0.5 w-6 bg-beige-kem" />
          <span className="rounded-full bg-bubblegum px-2.5 py-1 font-bold text-on-tint">
            02. CHỌN GHẾ
          </span>
          <span className="h-0.5 w-6 bg-beige-kem" />
          <span>03. THANH TOÁN VÀ NHẬN VÉ</span>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border-2 border-beige-kem bg-bubblegum px-4 py-3 font-mono text-[11px] leading-5 text-on-tint">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column: the real seat map for this showtime */}
        <div className="lg:col-span-8 bg-xanh-pho border-2 border-beige-kem rounded-2xl p-6 sm:p-10 flex flex-col items-center">
          <div className="relative w-full max-w-lg mb-12 text-center">
            <h4 className="text-[10px] font-mono tracking-widest text-ink-soft uppercase mb-2">SÂN KHẤU</h4>
            <div className="relative h-4 bg-gradient-to-t from-beige-kem/40 to-transparent border-t-2 border-beige-kem/75 rounded-[100%] filter blur-[1px]" />
            <div className="absolute inset-x-0 -bottom-8 h-20 bg-gradient-to-b from-beige-kem/10 to-transparent pointer-events-none" />
          </div>

          {/* The map, drawn from coordinates through the shared canvas — the same surface the event
              page's preview uses, with zoom and pan (feature 005, FR-038/FR-039). The hold path
              below is untouched: geometry changed where a seat is drawn, not how it is held. */}
          <div className="w-full pb-4">
            {loading ? (
              <p className="py-10 text-center font-mono text-xs text-beige-kem/50">Đang tải sơ đồ ghế…</p>
            ) : seats.length === 0 ? (
              <p className="py-10 text-center font-mono text-xs text-beige-kem/50">
                Suất diễn này chưa có sơ đồ ghế.
              </p>
            ) : (
              <SeatCanvas
                seats={seats}
                elements={mapMeta.elements}
                floorPlan={mapMeta.floorPlan}
                space={mapMeta.space}
                interactive={!busy}
                seatClass={seatClasses}
                seatLabel={statusTitle}
                onSeatActivate={toggleSeatSelection}
              />
            )}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-beige-kem/25 w-full max-w-lg font-mono text-xs text-beige-kem/70">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-transparent border-2 border-beige-kem rounded" />
              <span>Còn trống{tierPrices.length ? ` (${tierPrices.map(formatPrice).join(" / ")})` : ""}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-burgundy rounded" />
              <span>Bạn đang giữ</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-stone-700/60 border border-stone-700 rounded" />
              <span>Người khác giữ</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-stone-800 border border-stone-800 rounded" />
              <span>Đã bán / Không bán</span>
            </div>
          </div>
        </div>

        {/* Right column: the live selection */}
        <div className="lg:col-span-4 bg-xanh-pho border-2 border-beige-kem rounded-2xl p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="font-display font-bold text-lg text-beige-kem">Thông tin suất</h3>
            <p className="text-xs text-ink-soft font-mono uppercase tracking-wider">{event.genre.join(" | ")}</p>
          </div>

          <div className="rounded-xl border-2 border-beige-kem bg-cam-dat p-4 font-mono text-xs text-on-tint/75">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center font-bold text-ink-soft">Giữ ghế tạm thời</span>
              <span className="text-base font-black text-beige-kem">
                {selectedSeatsList.length ? holdTimeLabel : "--:--"}
              </span>
            </div>
            <p className="mt-2 leading-5">
              Ghế được giữ ngay khi bạn bấm chọn, và chỉ mình bạn giữ. Đồng hồ chạy từ ghế đầu tiên và
              giữ nguyên trong suốt quy trình (chọn suất → chọn ghế → thanh toán); thêm hoặc bớt ghế
              không cộng thêm thời gian. Hết giờ, ghế tự trả lại cho người khác.
            </p>
          </div>

          <div className="space-y-3 pt-4 border-t border-beige-kem/25 text-sm">
            <div className="flex justify-between font-mono">
              <span className="text-beige-kem/60">Tên tác phẩm:</span>
              <span className="font-bold text-beige-kem shrink-0 max-w-[180px] text-right truncate">{event.title}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-beige-kem/60">Suất:</span>
              <span className="font-bold text-beige-kem text-right">
                {selectedTime} • {selectedDate}
              </span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-beige-kem/60">Địa điểm:</span>
              <span className="font-bold text-beige-kem text-right max-w-[200px] truncate" title={event.location}>
                {event.venueName || event.location}
              </span>
            </div>
          </div>

          {/* Selected seat list */}
          <div className="space-y-3 pt-4 border-t border-beige-kem/25">
            <h4 className="font-display text-sm font-semibold text-beige-kem">Ghế ngồi đã chọn:</h4>

            {selectedSeatsList.length === 0 ? (
              <div className="py-6 text-center text-xs text-beige-kem/40 border border-dashed border-beige-kem/25 rounded-lg">
                Vui lòng chọn ghế trên sơ đồ
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {selectedSeatsList.map((seat) => (
                  <div
                    key={seat.showtimeSeatId ?? seat.id}
                    className="flex justify-between items-center bg-xanh-pho px-3 py-2 border-2 border-beige-kem rounded-lg text-xs font-mono"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-surface-2" />
                      <span className="font-bold text-beige-kem">GHẾ {seat.id}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-bold text-beige-kem">{formatPrice(seat.price)}</span>
                      <button
                        onClick={() => onToggleSeat(seat)}
                        disabled={busy}
                        className="font-mono text-[10px] uppercase text-stone-500 transition hover:text-burgundy disabled:opacity-40 cursor-pointer"
                        title="Bỏ giữ ghế này"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-beige-kem/25 flex flex-col gap-1.5">
            <div className="flex justify-between items-baseline font-mono">
              <span className="text-xs text-beige-kem/60 uppercase">Tổng tiền phải trả:</span>
              <span className="text-2xl font-black text-burgundy font-display">{formatPrice(totalPrice)}</span>
            </div>
            <p className="text-[10px] text-right font-mono text-ink-soft tracking-wide">
              Đã bao gồm thuế giá trị gia tăng và phụ thu
            </p>
          </div>

          <button
            onClick={onProceedToCheckout}
            disabled={selectedSeatsList.length === 0 || remainingMs <= 0 || busy}
            className="w-full py-3.5 bg-burgundy hover:brightness-95 disabled:bg-surface-2 disabled:text-white/60 text-white hover:text-white font-bold rounded-xl transition shadow-hard hover:shadow-burgundy/30 cursor-pointer text-center text-sm"
          >
            TIẾP TỤC: ĐIỀN THÔNG TIN THÀNH VIÊN
          </button>
        </div>
      </div>
    </div>
  );
}
