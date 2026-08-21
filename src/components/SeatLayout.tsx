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
    Pick<SeatMap, "space" | "elements" | "floorPlan" | "tables" | "tierLegend" | "orphanRule">
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
        orphanRule: map.orphanRule,
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
  const [bestNotice, setBestNotice] = useState<string | null>(null);
  /** Spotlight the wheelchair-accessible seats. Dims the rest; never removes them. */
  const [accessibleOnly, setAccessibleOnly] = useState(false);

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
    const result = bestSeats(seats, mapMeta.elements, bestCount, heldIds, mapMeta.orphanRule);
    if (result.seats.length === 0) {
      setBestNotice(
        result.reason === "none_available"
          ? "Suất này hiện không còn ghế trống."
          : `Suất này chỉ còn dưới ${bestCount} ghế trống. Giảm số ghế nhé.`,
      );
      return;
    }
    // Seats that are NOT together must say so before they are held. Saying nothing is how a buyer
    // ends up with four seats in four different rows and only finds out at the venue.
    setBestNotice(
      result.match === "scattered"
        ? `Không còn ${bestCount} ghế liền nhau — đây là ${bestCount} ghế trống gần sân khấu nhất, không ngồi cạnh nhau.`
        : null,
    );
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

    // Picking up a wheelchair seat must say what it carries: this one is reserved for a wheelchair
    // user, and the seat beside them is meant for a companion. The notice is informational, not a
    // gate — the buyer may still hold it alone, reuses the same inline channel the picker uses, and
    // repeats on every pick rather than sitting around and going stale.
    if (!mine && seat.isAccessible) {
      setBestNotice("Ghế này dành cho người dùng xe lăn và kèm một ghế cho người đi cùng.");
    } else if (!mine) {
      // Only clear the notice when moving AWAY from an accessible seat: a "scattered" warning from
      // "Chọn giúp tôi" stays until the buyer acts, rather than being wiped by any click.
      setBestNotice(null);
    }

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

  /**
   * A seat's state, drawn so it survives being reduced to greyscale.
   *
   * These three used to be `stone-800`, `stone-800/30` and `stone-700/60` — the same grey at three
   * opacities, which at seat size is no distinction at all, and none whatever for a colourblind
   * buyer. A comment here even promised diagonal stripes that were never built. Now each state has
   * a different FORM, and the colour is only reinforcement:
   *
   *   sold      — solid, filled in, finished
   *   held      — hatched, temporarily somebody else's
   *   blocked   — hollow with a dashed edge, never offered for sale at all
   *   selected  — solid burgundy, the one colour this app reserves for the buyer's own commitment
   */
  const seatClasses = (seat: SeatMapSeat): string => {
    // The filter pushes everything else back rather than removing it, so the accessible seats read
    // against the shape of the real room instead of floating in an empty one.
    const dimmed = accessibleOnly && !seat.isAccessible ? " opacity-25" : "";
    // Selected and sold were the last pair separated by hue alone: both solid, one burgundy and one
    // dark grey. The other three states got their own forms and these two did not, which left the
    // distinction a buyer needs most — "mine" versus "gone" — resting on colour discrimination. The
    // ring is a LUMINANCE difference, so it survives greyscale, colourblindness and a phone in
    // sunlight: the buyer's own seat is a dark fill inside a light halo, sold is dark throughout.
    if (heldByMe.has(seat.id)) return `fill-burgundy stroke-beige-kem${dimmed}`;
    if (seat.status === "sold") return `fill-stone-800 stroke-stone-900${dimmed}`;
    if (seat.status === "held") return `stroke-stone-500 [fill:url(#seat-hatch)]${dimmed}`;
    if (seat.status === "blocked")
      return `fill-transparent stroke-stone-500 [stroke-dasharray:18]${dimmed}`;
    return `fill-transparent stroke-beige-kem/40 hover:stroke-burgundy${dimmed}`;
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
                  {/*
                    Accessible-seat filter. Offered only when the chart actually has some, because a
                    toggle that finds nothing is worse than no toggle.

                    It DIMS rather than hides, the same decision the section chips make: a buyer who
                    turns it on is comparing accessible seats against the room, and a map that
                    deletes most of itself has stopped being a map. Everything stays selectable.
                  */}
                  {seats.some((s) => s.isAccessible) && (
                    <label className="flex items-center gap-2 font-meta text-meta text-beige-kem/80">
                      <input
                        type="checkbox"
                        checked={accessibleOnly}
                        onChange={(e) => setAccessibleOnly(e.target.checked)}
                        className="h-4 w-4 accent-burgundy"
                      />
                      Chỉ hiện ghế cho người dùng xe lăn
                    </label>
                  )}
                  {bestNotice && (
                    <p className="w-full font-meta text-meta text-cam-dat">{bestNotice}</p>
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
                <span className="h-4 w-4 shrink-0 border-2 border-beige-kem bg-burgundy" />
                Bạn đang giữ
              </span>
              {/* Each swatch is drawn the way the seat itself is drawn. A key whose squares are all
                  the same shape in different greys explains nothing — these have to carry the same
                  three FORMS the map uses, or the legend is decoration. */}
              <span className="flex items-center gap-2">
                <span
                  className="h-4 w-4 shrink-0 border border-stone-500"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgb(120 113 108) 0 3px, transparent 3px 6px)",
                  }}
                />
                Người khác giữ
              </span>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 bg-stone-800" />
                Đã bán
              </span>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 border-2 border-dashed border-stone-500" />
                Không mở bán
              </span>
              {/* The canvas has always drawn a dashed ring around an accessible seat, and nothing on
                  screen said so — a symbol with no key is a symbol a buyer has to guess at. Shown
                  only when the chart actually has such seats, so the key never explains a mark that
                  is not on the map. */}
              {seats.some((s) => s.isAccessible) && (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 shrink-0 border-2 border-dashed border-beige-kem/80" />
                  Ghế cho người dùng xe lăn
                </span>
              )}
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
