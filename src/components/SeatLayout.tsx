/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SeatMap, SeatMapSeat, SeatStatus } from "@/shared/catalog/types";
import { MovieEvent, Seat } from "../types";
import { catalogClient } from "../services/catalogClient";
import { watchShowtime } from "../services/seatSocket";
import { NEUTRAL_TIER_COLOR } from "@/shared/catalog/tier-palette";
import SeatCanvas, { type CanvasBlock, type SeatCanvasHandle } from "./seatmap/SeatCanvas";
import { bestSeats } from "./seatmap/bestAvailable";
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
  /**
   * Hold the chosen contiguous run in one round trip — the "chọn giúp tôi" path (FR-072). A single
   * hold call for the whole run is what keeps the offer atomic; see `handleHoldBestSeats` in App.
   */
  onHoldBestSeats: (seats: Seat[]) => void;
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
  onHoldBestSeats,
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
  /**
   * Jump-to-section (FR-071, Eventbrite/Humanitix parity). The canvas imperatively zooms when a chip
   * is pressed; the chip itself is a scroll anchor, not a filter, so every section stays selectable
   * and no seat ever disappears from view (which a filter would do, and which a map must not).
   */
  const canvas = useRef<SeatCanvasHandle>(null);
  /**
   * One chip per section, in the section→row→number order the seats arrive in (FR-039a), stable per
   * render. Section colours never reach the buyer (FR-064: colour means price only), so the chips are
   * neutrally tinted and named.
   */
  const sections = useMemo(
    () => [...new Set(seats.map((s) => s.section).filter((s): s is string => !!s))],
    [seats],
  );
  const blocks = useMemo<CanvasBlock[]>(
    // Neutral hull colour: on the buyer's map colour is PRICE and nothing else (FR-064), so a
    // section outline names a group but claims no hue of its own.
    () => sections.map((name) => ({ id: name, name, color: NEUTRAL_TIER_COLOR })),
    [sections],
  );

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

  const pick = (seat: SeatMapSeat) =>
    onToggleSeat({
      id: `${seat.row}${seat.number}`,
      row: seat.row,
      number: seat.number,
      type: "single",
      price: seat.price,
      isBooked: false,
      showtimeSeatId: seat.id,
    });

  /**
   * The number of seats to ask the picker for. The server caps a hold at `max_tickets_per_buyer`
   * (default 8) and refuses anything over it, but the picker should not aim past that cap — a
   * "chọn giúp tôi" that returns "cap_exceeded" would be the answer nobody asked for. 8 matches
   * the default; the exact cap lives on the server, and it enforces it anyway.
   */
  const BEST_SEAT_CAP = 8;
  /** What the buyer asked the picker for; a stepper the buyer controls (FR-072). */
  const [bestCount, setBestCount] = useState(2);
  const [bestError, setBestError] = useState<string | null>(null);

  /**
   * "Chọn giúp tôi" — pick the contiguous run nearest the stage and hold it in one call.
   *
   * Everything a buyer could do wrong scanning the map is done right here: contiguous seats, closest
   * to the focal point, centred on the row, and not the buyer's own held seats. The hold is one
   * round trip — the whole run at once — so it either all lands or none of it does (see
   * `handleHoldBestSeats` in App).
   */
  const chooseBestAvailable = () => {
    const heldIds = new Set(
      heldSeats.map((s) => s.showtimeSeatId).filter((id): id is number => id !== undefined),
    );
    const result = bestSeats(seats, mapMeta.elements, bestCount, heldIds);
    if (result.seats.length === 0) {
      setBestError(
        result.reason === "none_available"
          ? "Suất này hiện không còn ghế trống."
          : `Không tìm được ${bestCount} ghế trống liền nhau. Giảm số ghế hoặc chọn ghế khác nhé.`,
      );
      return;
    }
    setBestError(null);
    onHoldBestSeats(
      result.seats.map((s) => ({
        id: `${s.row}${s.number}`,
        row: s.row,
        number: s.number,
        type: "single" as const,
        price: s.price,
        isBooked: false,
        showtimeSeatId: s.id,
      })),
    );
  };

  /**
   * Picking a seat — or, at a table sold whole, picking the whole table.
   *
   * `whole_table` is expressed HERE, as a selection rule, rather than as a different kind of
   * inventory: the hold that follows still takes N ordinary seat rows, so feature 003's concurrency
   * guarantees are untouched. A table is only offered if every seat at it is free, because a table
   * "sold as a whole" that arrives with two seats missing is not the thing that was advertised.
   */
  const toggleSeatSelection = (seat: SeatMapSeat) => {
    const mine = heldByMe.has(seat.id);
    if (!mine && seat.status !== "available") return; // taken by someone else, or sold/blocked

    if (seat.tableBookingMode === "whole_table" && seat.tableId != null) {
      const table = seats.filter((s) => s.tableId === seat.tableId);
      const free = table.every((s) => s.status === "available" || heldByMe.has(s.id));
      if (!free) return;
      // Whichever way this click resolves, the whole table follows it.
      const wantSelected = !mine;
      for (const s of table) {
        if (heldByMe.has(s.id) !== wantSelected) pick(s);
      }
      return;
    }
    pick(seat);
  };

  const selectedSeatsList = heldSeats;
  const totalPrice = selectedSeatsList.reduce((sum, seat) => sum + seat.price, 0);
  const tierPrices = [...new Set(seats.map((s) => s.price))].sort((a, b) => a - b);

  const seatClasses = (seat: SeatMapSeat): string => {
    if (heldByMe.has(seat.id)) return "fill-burgundy stroke-burgundy";
    // Sold and blocked used to share one dark fill, and a buyer could not tell a finished seat from
    // one the organizer pulled — so a sold-out chart looked the same as a half-retracted one. They
    // are now two pictures: solid dark for sold, a light outline with diagonal stripes unavailable
    // anywhere on the map but unmistakably distinct (FR-070, Eventive parity).
    if (seat.status === "sold") return "fill-stone-800 stroke-stone-800";
    if (seat.status === "blocked") return "fill-stone-800/30 stroke-stone-600";
    if (seat.status === "held") return "fill-stone-700/60 stroke-stone-700";
    return "fill-transparent stroke-beige-kem/40 hover:stroke-burgundy";
  };

  /** What a screen reader announces. Section, row, seat, status, price — enough to choose a seat
   *  without seeing the map (FR-039a). */
  const statusTitle = (seat: SeatMapSeat): string => {
    const price = formatVnd(seat.price);
    // The two facts a screen-reader user cannot get from the picture: that this seat is accessible,
    // and that choosing it takes the whole table with it.
    const notes = [
      seat.isAccessible ? "ghế cho người dùng xe lăn" : null,
      seat.tableBookingMode === "whole_table" ? "bán trọn bàn" : null,
    ].filter(Boolean);
    const suffix = notes.length > 0 ? `, ${notes.join(", ")}` : "";
    const where = `${seat.section ? `${seat.section}, ` : ""}hàng ${seat.row}, ghế ${seat.number}${suffix}`;
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
            {loading ? (
              <p className="py-12 text-center font-meta text-meta text-ink-soft">
                Đang tải sơ đồ ghế…
              </p>
            ) : seats.length === 0 ? (
              <p className="py-12 text-center font-meta text-meta text-ink-soft">
                Suất diễn này chưa có sơ đồ ghế.
              </p>
            ) : (
              <>
                {/* Jump-to-section chips (FR-071). Only when the map actually has sections — a
                    general-admission chart has one unnamed area and nothing to jump between.
                    Each chip zooms the canvas onto its section; "Toàn bộ" returns to the fit view. */}
                {sections.length > 1 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => canvas.current?.zoomToVenue()}
                      className="rounded-full border-2 border-beige-kem/60 px-3 py-1 font-meta text-meta text-beige-kem/80 transition hover:border-burgundy hover:text-beige-kem"
                    >
                      Toàn bộ
                    </button>
                    {sections.map((name) => (
                      <button
                        key={name}
                        onClick={() => canvas.current?.zoomToBlock(name)}
                        className="rounded-full border-2 border-beige-kem/60 px-3 py-1 font-meta text-meta text-beige-kem/80 transition hover:border-burgundy hover:text-beige-kem"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}

                {/* "Chọn giúp tôi" (FR-072). A count stepper plus one button that holds the best
                    contiguous run nearest the stage — the buyer doesn't scan the map, the picker
                    does. Errors from the picker (none left, no run of that length) are shown
                    inline, not as a toast the buyer can miss. */}
                <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-beige-kem/25 pb-4">
                  <label className="flex items-center gap-2 font-meta text-meta text-beige-kem/80">
                    <span>Số ghế</span>
                    <button
                      onClick={() => setBestCount((n) => Math.max(1, n - 1))}
                      disabled={busy || bestCount <= 1}
                      className="h-8 w-8 rounded border-2 border-beige-kem/60 font-bold text-beige-kem transition hover:border-burgundy disabled:opacity-40"
                      aria-label="Giảm số ghế"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-bold text-beige-kem">{bestCount}</span>
                    <button
                      onClick={() => setBestCount((n) => Math.min(BEST_SEAT_CAP, n + 1))}
                      disabled={busy || bestCount >= BEST_SEAT_CAP}
                      className="h-8 w-8 rounded border-2 border-beige-kem/60 font-bold text-beige-kem transition hover:border-burgundy disabled:opacity-40"
                      aria-label="Tăng số ghế"
                    >
                      +
                    </button>
                  </label>
                  <button
                    onClick={chooseBestAvailable}
                    disabled={busy || loading}
                    className="rounded bg-burgundy px-5 py-2 font-meta text-sm font-black text-white transition hover:brightness-95 disabled:opacity-50"
                  >
                    Chọn giúp tôi
                  </button>
                  {bestError && (
                    <p className="w-full font-meta text-meta text-cam-dat">{bestError}</p>
                  )}
                </div>

                <SeatCanvas
                  ref={canvas}
                  seats={seats}
                  elements={mapMeta.elements}
                  floorPlan={mapMeta.floorPlan}
                  space={mapMeta.space}
                  tables={mapMeta.tables}
                  blocks={blocks}
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
              </>
            )}

            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-beige-kem/25 pt-6 font-meta text-meta text-beige-kem/80 sm:grid-cols-5">
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
                Đã bán
              </span>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 border-2 border-stone-600 bg-stone-800/30" />
                Không mở bán
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
