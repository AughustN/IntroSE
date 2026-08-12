/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SeatMap, SeatMapSeat, SeatStatus } from "@/shared/catalog/types";
import { MovieEvent, Seat } from "../types";
import { catalogClient } from "../services/catalogClient";
import { watchShowtime } from "../services/seatSocket";
import SeatCanvas from "./seatmap/SeatCanvas";
import TierLegend from "./seatmap/TierLegend";
import {
  type BookingStep,
  BookingHeader,
  BookingLayout,
  BookingSection,
  OrderSummary,
  TicketStub,
  type SummaryLine,
} from "./booking/BookingChrome";
import { formatVnd } from "../services/currency";

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
  /** A finished step on the bar. Pressing one cancels the order, like the back link. */
  onGoToStep?: (step: BookingStep) => void;
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
  onGoToStep,
  onProceedToCheckout,
}: SeatLayoutProps) {
  const [seats, setSeats] = useState<SeatMapSeat[]>([]);
  const [mapMeta, setMapMeta] = useState<
    Pick<SeatMap, "space" | "elements" | "floorPlan" | "tables" | "tierLegend">
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const heldByMe = useMemo(
    () =>
      new Set(
        heldSeats.map((seat) => seat.showtimeSeatId).filter((id): id is number => id !== undefined),
      ),
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
      setMapMeta({
        space: map.space,
        elements: map.elements,
        floorPlan: map.floorPlan,
        tables: map.tables,
        tierLegend: map.tierLegend,
      });
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

  const selectedSeatsList = heldSeats;
  const totalPrice = selectedSeatsList.reduce((sum, seat) => sum + seat.price, 0);
  const tierPrices = [...new Set(seats.map((s) => s.price))].sort((a, b) => a - b);

  const seatClasses = (seat: SeatMapSeat): string => {
    if (heldByMe.has(seat.id)) return "fill-burgundy stroke-burgundy";
    if (seat.status === "sold" || seat.status === "blocked")
      return "fill-stone-800 stroke-stone-800";
    if (seat.status === "held") return "fill-stone-700/60 stroke-stone-700";
    return "fill-transparent stroke-beige-kem/40 hover:stroke-burgundy";
  };

  /** What a screen reader announces. Section, row, seat, status, price — enough to choose a seat
   *  without seeing the map (FR-039a). */
  const statusTitle = (seat: SeatMapSeat): string => {
    const price = formatVnd(seat.price);
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

  const summaryLines: SummaryLine[] = selectedSeatsList.map((seat) => ({
    key: String(seat.showtimeSeatId ?? seat.id),
    label: `Ghế ${seat.id}`,
    detail: seat.row ? `Hàng ${seat.row}` : undefined,
    amount: seat.price,
    onRemove: busy ? undefined : () => onToggleSeat(seat),
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <BookingHeader
        backLabel="Hủy đơn và quay lại"
        onBack={onBack}
        current={2}
        seated
        onGoToStep={onGoToStep}
      />

      <TicketStub event={event} date={selectedDate} time={selectedTime} />

      {loadError && (
        <p className="border border-burgundy/50 px-4 py-3 font-meta text-meta leading-5 text-burgundy-ink">
          {loadError}
        </p>
      )}

      <BookingLayout
        aside={
          <OrderSummary
            event={event}
            date={selectedDate}
            time={selectedTime}
            venue={event.venueName || event.location}
            lines={summaryLines}
            total={totalPrice}
            holdMs={remainingMs}
            emptyLabel="Chưa chọn ghế nào"
            ctaLabel="Tiếp tục thanh toán"
            onCta={onProceedToCheckout}
            ctaDisabled={selectedSeatsList.length === 0 || remainingMs <= 0 || busy}
            note="Ghế được giữ ngay khi bấm chọn. Đồng hồ chạy từ ghế đầu tiên và không cộng thêm khi chọn thêm ghế; hết giờ, ghế trả lại cho người khác."
          />
        }
      >
        <BookingSection
          step="02"
          title="Chọn ghế"
          hint="Bấm vào ghế trên sơ đồ để giữ chỗ. Bấm lần nữa để bỏ."
        >
          {/*
            The screen marker, then the map, then the legend — the order every cinema draws it in,
            because it is the order the eye needs: which way am I facing, what is here, what do the
            colours mean.
          */}
          <div className="border border-beige-kem/30 p-5 sm:p-8">
            <div className="mx-auto mb-10 w-full max-w-lg text-center">
              <p className="label-eyebrow mb-2 text-ink-soft">Sân khấu</p>
              <div className="h-1 rounded-[100%] bg-gradient-to-t from-beige-kem/45 to-beige-kem/10" />
            </div>

            {loading ? (
              <p className="py-12 text-center font-meta text-meta text-ink-soft">
                Đang tải sơ đồ ghế…
              </p>
            ) : seats.length === 0 ? (
              <p className="py-12 text-center font-meta text-meta text-ink-soft">
                Suất diễn này chưa có sơ đồ ghế.
              </p>
            ) : (
              <SeatCanvas
                seats={seats}
                elements={mapMeta.elements}
                floorPlan={mapMeta.floorPlan}
                space={mapMeta.space}
                tables={mapMeta.tables}
                interactive={!busy}
                seatClass={seatClasses}
                // Colour means PRICE on the buyer's map and nothing else (FR-067); status still
                // outranks it, which `seatFillStyle`'s available-only rule enforces.
                seatFill={(seat) =>
                  seat.status === "available" && !heldByMe.has(seat.id)
                    ? mapMeta.tierLegend?.find((t) => t.tierId === seat.tierId)?.color
                    : undefined
                }
                seatLabel={statusTitle}
                onSeatActivate={toggleSeatSelection}
              />
            )}

            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-beige-kem/25 pt-6 font-meta text-meta text-beige-kem/80 sm:grid-cols-4">
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 border-2 border-beige-kem/60" />
                Còn trống
              </span>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 bg-burgundy" />
                Bạn đang giữ
              </span>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 bg-stone-700/60" />
                Người khác giữ
              </span>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 bg-stone-800" />
                Đã bán / không bán
              </span>
            </div>

            {mapMeta.tierLegend && mapMeta.tierLegend.length > 0 ? (
              <div className="mt-4">
                <TierLegend legend={mapMeta.tierLegend} />
              </div>
            ) : (
              tierPrices.length > 0 && (
                <p className="mt-4 font-meta text-meta text-ink-soft">
                  Giá theo hạng ghế: {tierPrices.map(formatVnd).join(" · ")}
                </p>
              )
            )}
          </div>
        </BookingSection>
      </BookingLayout>
    </div>
  );
}
