/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import type { Showtime } from "@/shared/catalog/types";
import { MovieEvent, TicketTier } from "../types";
import { catalogClient } from "../services/catalogClient";
import { formatEventDate } from "../services/formatDate";
import { watchShowtime } from "../services/seatSocket";
import { Clock3, Tag, Ticket, Users } from "lucide-react";
import Disclosure from "./Disclosure";
import {
  BookingHeader,
  BookingLayout,
  BookingSection,
  OrderSummary,
  type SummaryDetail,
  type SummaryHighlight,
  type SummaryLine,
} from "./booking/BookingChrome";
import { formatVnd } from "../services/currency";
import { aiClient } from "../services/aiClient";

export interface TierSelection {
  tierId: string;
  label: string;
  price: number;
  quantity: number;
}

interface EventDetailProps {
  event: MovieEvent;
  /** Real showtimes for this event. Empty while the detail request is still in flight. */
  showtimes: Showtime[];
  /** Guests browse and choose freely; only the hand-off to checkout asks them to sign in. */
  isSignedIn: boolean;
  relatedEvents: MovieEvent[];
  wishlistedIds: string[];
  onBack: () => void;
  onToggleWishlist: (eventId: string) => void;
  onBookRelated: (event: MovieEvent) => void;
  /** Seated events: hand off to the seat picker. */
  onProceedToSeatSelection: (showtimeId: number | null, date: string, time: string) => void;
  /** General admission: the tickets are already held, so this is a plain step forward. */
  onProceedToCheckout: () => void;
  /**
   * What the buyer currently holds, per tier id. General admission only.
   *
   * The server's number, not this screen's. A stepper press is a hold, so the count on screen has
   * to be the count the reservation actually carries — local state would drift the moment a press
   * was refused for want of stock.
   */
  heldQuantities: Record<string, number>;
  /** A stepper press. The parent places or releases the hold and the new count comes back above. */
  onAdjustQuantity: (
    tier: { id: string; label: string },
    delta: number,
    showtimeId: number | null,
    date: string,
    time: string,
  ) => void;
  /** A hold round trip is in flight; the steppers are inert so two presses cannot race. */
  holdBusy: boolean;
  /** Milliseconds left on the general-admission hold this screen now owns. */
  holdRemainingMs: number;
}

const statusLabels = {
  available: "Còn vé",
  low: "Sắp hết vé",
  sold_out: "Hết vé",
  cancelled: "Đã hủy",
};

/**
 * One bookable slot. Built from a real showtime when the API has answered, so date and time always
 * belong to the same session — the previous two-grid layout let a visitor combine a date with a
 * time that no showtime actually offered.
 */
interface Slot {
  key: string;
  showtimeId: number | null;
  date: string;
  time: string;
  venue: string;
  soldOut: boolean;
}

const MAX_PER_TIER = 10;
const MAX_TIERS = 4;

export default function EventDetail({
  event,
  showtimes,
  isSignedIn,
  relatedEvents,
  wishlistedIds,
  onBack,
  onToggleWishlist,
  onBookRelated,
  onProceedToSeatSelection,
  onProceedToCheckout,
  heldQuantities,
  onAdjustQuantity,
  holdBusy,
  holdRemainingMs,
}: EventDetailProps) {
  const isSeated = event.eventType === "seated";

  useEffect(() => {
    if (isSignedIn) void aiClient.recordView(event.id).catch(() => {});
  }, [event.id, isSignedIn]);

  /**
   * The tiers of the selected showtime, with their real `ticket_tiers.id`.
   *
   * `event.ticketTiers` cannot be used to buy with: the event detail groups tiers by label across
   * every showtime, so it has no single row to point at and numbers them by array position instead.
   * Sending that index as `ticketTierId` reserved nothing — the first tier came out as 0, which the
   * hold API rejects outright. It is also why live "Còn N vé" never updated: the socket reports the
   * real id, which matched none of the synthetic ones.
   *
   * The summary still drives the display before a showtime is picked, since prices are what the
   * buyer is comparing at that point.
   */
  const [showtimeTiers, setShowtimeTiers] = useState<TicketTier[] | null>(null);

  // An event carries at most 4 ticket tiers (enforced server-side); slice defensively so a bad
  // payload can never break the even 1–4 column layout below.
  const tiers = useMemo(
    () => (showtimeTiers ?? event.ticketTiers).slice(0, MAX_TIERS),
    [showtimeTiers, event.ticketTiers],
  );
  const slots = useMemo<Slot[]>(() => {
    if (showtimes.length > 0) {
      return showtimes.map((s) => ({
        key: String(s.id),
        showtimeId: s.id,
        date: s.startsAt.slice(0, 10),
        time: s.startsAt.slice(11, 16),
        venue: s.venue.name,
        soldOut: s.availability !== "available",
      }));
    }
    // Fallback for the pre-API placeholder event: pair each date with each listed time.
    return event.dates.flatMap((date) =>
      event.times.map((time) => ({
        key: `${date}T${time}`,
        showtimeId: null,
        date,
        time,
        venue: event.venueName,
        soldOut: false,
      })),
    );
  }, [showtimes, event.dates, event.times, event.venueName]);

  const [selectedSlotKey, setSelectedSlotKey] = useState<string>("");

  /*
   * There is no local quantity any more.
   *
   * The steppers hold on the server as they are pressed, so the reservation is the only place the
   * number lives. Mirroring it into state here would give two answers to "how many" that disagree
   * for as long as a request is in flight, and disagree permanently when one is refused.
   */
  const quantities = heldQuantities;

  /*
   * Nothing to restore any more.
   *
   * This screen used to be handed the live hold so a buyer stepping back from checkout found their
   * showtime and quantities as they left them. Backward is a cancel now: by the time this renders,
   * the hold has been released and there is nothing to come back to. All that is left is landing on
   * a sensible showtime the first time the list arrives.
   */
  useEffect(() => {
    /*
     * Re-picks whenever the held key names nothing in the list, not only when it is empty.
     *
     * `slots` is built twice: once from `event.dates` × `event.times` while the detail request is
     * in flight, keyed `2026-08-11T21:30`, and again from the real showtimes, keyed by their
     * database id. Guarding on "is a key set at all" meant the placeholder's key survived the
     * swap and matched no real slot — the date chip lit up from its own fallback while the time
     * grid showed nothing selected and the panel read "Chưa chọn suất" over a list of one showtime.
     */
    if (slots.some((slot) => slot.key === selectedSlotKey)) return;
    const firstOpen = slots.find((slot) => !slot.soldOut) ?? slots[0];
    setSelectedSlotKey(firstOpen?.key ?? "");
  }, [slots, selectedSlotKey]);

  const selectedSlot = slots.find((s) => s.key === selectedSlotKey) ?? null;
  const eventUnavailable = event.status === "sold_out" || event.status === "cancelled";

  /**
   * Live tier availability for the selected showtime (US3): when anyone reserves or releases a
   * general-admission quantity, "Còn N vé" follows within about a second. Advisory only — the server
   * still refuses an over-reservation regardless of what this shows (FR-023).
   */
  const [liveRemaining, setLiveRemaining] = useState<Record<string, number | null>>({});

  // Load the real tiers as soon as a general-admission showtime is chosen — the quantity steppers
  // must be bound to ids the hold API accepts, not to the detail summary's positions.
  useEffect(() => {
    const showtimeId = selectedSlot?.showtimeId;
    if (isSeated || !showtimeId) {
      setShowtimeTiers(null);
      return;
    }
    let cancelled = false;
    catalogClient
      .getSeatMap(showtimeId)
      .then((map) => {
        if (cancelled) return;
        setShowtimeTiers(
          (map.tiers ?? []).map((tier) => ({
            id: String(tier.id),
            label: tier.label,
            price: tier.price,
            remaining: tier.remaining,
            // The seat map carries no copy; reuse the summary's blurb for the same tier so the
            // cards do not lose their description the moment a showtime is picked.
            description:
              event.ticketTiers.find((summary) => summary.label === tier.label)?.description ?? "",
          })),
        );
      })
      .catch(() => {
        // Keep showing the summary rather than an empty picker; the buy button stays disabled
        // because nothing can be selected without a tier the server knows.
        if (!cancelled) setShowtimeTiers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSeated, selectedSlot?.showtimeId, event.ticketTiers]);

  useEffect(() => {
    setLiveRemaining({});
    const showtimeId = selectedSlot?.showtimeId;
    if (isSeated || !showtimeId) return;
    return watchShowtime(showtimeId, (update) => {
      if (!update.tier) return;
      setLiveRemaining((current) => ({
        ...current,
        [String(update.tier!.ticketTierId)]: update.tier!.remaining,
      }));
    });
  }, [isSeated, selectedSlot?.showtimeId]);

  const selection = useMemo<TierSelection[]>(
    () =>
      tiers
        .map((tier) => ({
          tierId: tier.id,
          label: tier.label,
          price: tier.price,
          quantity: quantities[tier.id] ?? 0,
        }))
        .filter((line) => line.quantity > 0),
    [tiers, quantities],
  );

  const totalQuantity = selection.reduce((sum, line) => sum + line.quantity, 0);
  const totalPrice = selection.reduce((sum, line) => sum + line.quantity * line.price, 0);

  const bookingDisabled =
    eventUnavailable || !selectedSlot || selectedSlot.soldOut || (!isSeated && totalQuantity === 0);

  const isWishlisted = wishlistedIds.includes(event.id);

  /** What a tier has left right now: the live number if the channel has sent one, else the fetched one. */
  const remainingOf = (tier: MovieEvent["ticketTiers"][number]): number | null | undefined =>
    tier.id in liveRemaining ? liveRemaining[tier.id] : tier.remaining;

  const tierCap = (tier: MovieEvent["ticketTiers"][number]) => {
    const remaining = remainingOf(tier);
    return remaining === null || remaining === undefined
      ? MAX_PER_TIER
      : Math.min(remaining, MAX_PER_TIER);
  };

  const adjustQuantity = (tier: TicketTier, delta: number) => {
    if (!selectedSlot) return;
    onAdjustQuantity(
      { id: tier.id, label: tier.label },
      delta,
      selectedSlot.showtimeId,
      selectedSlot.date,
      selectedSlot.time,
    );
  };

  const handlePrimaryAction = () => {
    if (!selectedSlot) return;
    // The showtime id is what the hold API locks against — carry it, not just the display strings.
    if (isSeated)
      onProceedToSeatSelection(selectedSlot.showtimeId, selectedSlot.date, selectedSlot.time);
    // General admission is already holding by the time this is pressed, so there is nothing to
    // commit here — only somewhere to go.
    else onProceedToCheckout();
  };

  const primaryLabel = eventUnavailable
    ? "Chưa thể đặt vé"
    : isSeated
      ? "Tiếp tục chọn ghế"
      : "Tiếp tục thanh toán";

  /*
   * The showtimes, split into a strip of days and a grid of times.
   *
   * They used to be one flat list of "11/08/2026 · 21:30 · Online" buttons two to a row, so twenty
   * showtimes were twenty near-identical labels and the only way to find a Saturday was to read all
   * of them. Every cinema in the country splits the two, and it is the split that does the work:
   * the day is a decision with four or five options, and only then is the time a decision with
   * four or five options.
   */
  const slotDates = useMemo(() => [...new Set(slots.map((slot) => slot.date))].sort(), [slots]);
  const activeDate = selectedSlot?.date ?? slotDates[0] ?? "";
  const slotsOnActiveDate = useMemo(
    () => slots.filter((slot) => slot.date === activeDate),
    [slots, activeDate],
  );

  /** Picking a day lands on its first open showtime, so the grid below is never showing nothing. */
  const chooseDate = (date: string) => {
    const onDate = slots.filter((slot) => slot.date === date);
    const firstOpen = onDate.find((slot) => !slot.soldOut) ?? onDate[0];
    if (firstOpen) setSelectedSlotKey(firstOpen.key);
  };

  /** Every showtime on a day being gone is what greys the day out — not the day itself. */
  const dateSoldOut = (date: string) =>
    slots.filter((slot) => slot.date === date).every((slot) => slot.soldOut);

  /*
   * The event's particulars, moved out of the page's tail and into the booking panel.
   *
   * They were a two-column definition list below the blurb, below the policies — under the button
   * they were meant to inform. A buyer weighing up the price could not see the running time or the
   * age rating without scrolling past the thing they were deciding about.
   *
   * Four is the count the row is built for; anything with no value drops out rather than printing a
   * glyph over an empty label, and the grid closes up around it.
   */
  const highlights: SummaryHighlight[] = [
    { icon: Clock3, label: event.duration > 0 ? `${event.duration} phút` : "" },
    { icon: Tag, label: event.genre[0] ?? "" },
    // "P" on its own is not a fact anyone can read. The graded ratings say what they mean already.
    { icon: Users, label: event.ageRating === "P" ? "Mọi lứa tuổi" : event.ageRating },
    { icon: Ticket, label: event.ticketsLeft > 0 ? `Còn ${event.ticketsLeft} vé` : "" },
  ].filter((h) => h.label);

  const details: SummaryDetail[] = [
    { label: "Địa điểm", value: event.venueName || event.location },
    { label: "Thành phố", value: event.city },
    { label: "Suất diễn", value: selectedSlot ? `${selectedSlot.time}` : "Chưa chọn" },
    { label: "Tình trạng", value: statusLabels[event.status] },
    { label: "Giá từ", value: formatVnd(event.price) },
  ].filter((d) => d.value);

  const summaryLines: SummaryLine[] = selection.map((line) => ({
    key: line.tierId,
    label: `${line.quantity} × ${line.label}`,
    detail: formatVnd(line.price),
    amount: line.quantity * line.price,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <BookingHeader backLabel="Quay lại danh sách" onBack={onBack} current={1} seated={isSeated} />

      <BookingLayout
        aside={
          <OrderSummary
            event={event}
            date={selectedSlot?.date}
            time={selectedSlot?.time}
            venue={selectedSlot?.venue}
            highlights={highlights}
            details={details}
            lines={isSeated ? [] : summaryLines}
            total={totalPrice}
            // No hold exists on this screen until one is placed further along, so the clock is only
            // drawn when the buyer has stepped back into a live one.
            // General admission holds from the first stepper press, so its countdown belongs
            // on this screen. A seated order has nothing held until the next one.
            holdMs={isSeated ? undefined : holdRemainingMs}
            emptyLabel={isSeated ? "Ghế được chọn ở bước sau" : "Chưa chọn vé nào"}
            ctaLabel={primaryLabel}
            onCta={handlePrimaryAction}
            ctaDisabled={bookingDisabled}
            note={
              !isSignedIn && !eventUnavailable
                ? isSeated
                  ? "Cần đăng nhập để chọn ghế"
                  : "Cần đăng nhập để thanh toán"
                : undefined
            }
            reassurance={event.refundPolicy}
          />
        }
      >
        {/*
          One step, not two.

          A general-admission purchase decides the showtime and the quantity on this page and then
          pays; splitting that into "01 Chọn suất" and "02 Chọn số lượng vé" numbered two halves of
          one screen as if the buyer travelled between them. A seated purchase really does travel —
          the seat map is its own screen — so for that one this page is step 01 and nothing else.
        */}
        {/*
          The artwork, at the size it was made to be seen.

          This screen opened on a 128px thumbnail inside a ticket stub — the object being sold,
          reproduced smaller than the step indicator above it. The reference runs a gallery down the
          whole left column against the booking panel on the right, and the page already has that
          two-column shape; it was simply not using the left one to show anything.

          The stub is not gone, it has moved: on the seat map and at checkout the buyer has already
          decided, and a compact reminder of what they are buying is exactly the right size there.

          One image, not a carousel. `MovieEvent` carries a single `imageUrl`; the arrows and dots
          the reference has would be furniture around nothing until the catalog gains a gallery.

          `3/2` with the blurred fill behind it, the same arrangement the catalog cards use: posters
          arrive in every shape and `object-contain` is the only crop that never cuts a face off.
        */}
        <div>
          <h1 className="font-display text-title-l font-black uppercase leading-[1.05] tracking-[0.02em] text-beige-kem">
            {event.title}
          </h1>
          {event.originalTitle && (
            <p className="mt-2 font-meta text-lede text-ink-soft">{event.originalTitle}</p>
          )}

          <figure className="relative mt-6 aspect-[3/2] overflow-hidden bg-beige-kem/[0.07]">
            <img
              src={event.imageUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
            />
            <img
              src={event.imageUrl}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="relative h-full w-full object-contain"
            />
          </figure>
        </div>

        <BookingSection
          step="01"
          title={isSeated ? "Chọn suất" : "Chọn vé"}
          hint={
            slots.length === 0
              ? undefined
              : isSeated
                ? "Chọn ngày và giờ. Ghế được chọn ở bước sau."
                : "Chọn ngày, giờ, rồi số lượng cho từng hạng vé."
          }
        >
          {slots.length === 0 ? (
            <p className="border border-dashed border-beige-kem/30 py-8 text-center font-meta text-meta text-ink-soft">
              Chưa có suất nào đang mở bán.
            </p>
          ) : (
            <div className="space-y-8">
              <div>
                <p className="label-eyebrow text-ink-soft">Ngày</p>
                {/*
                  The day strip scrolls sideways rather than wrapping. A run of dates that wraps to a
                  second line stops reading as a calendar and starts reading as a paragraph of
                  numbers, and the order is no longer obvious at a glance.
                */}
                <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
                  {slotDates.map((date) => {
                    const isActive = date === activeDate;
                    const gone = dateSoldOut(date);
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => chooseDate(date)}
                        disabled={gone}
                        aria-pressed={isActive}
                        className={`shrink-0 border px-4 py-2.5 text-center transition ${
                          isActive
                            ? "border-burgundy bg-burgundy text-white"
                            : gone
                              ? "cursor-not-allowed border-beige-kem/20 text-ink-soft/50"
                              : "border-beige-kem/35 text-beige-kem hover:border-beige-kem"
                        }`}
                      >
                        <span className="block font-meta text-body font-bold leading-none">
                          {formatEventDate(date)}
                        </span>
                        <span className="mt-1 block font-meta text-eyebrow leading-none opacity-70">
                          {gone ? "hết vé" : `${slots.filter((s) => s.date === date).length} suất`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="label-eyebrow text-ink-soft">Giờ</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {slotsOnActiveDate.map((slot) => {
                    const isSelected = slot.key === selectedSlotKey;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        onClick={() => setSelectedSlotKey(slot.key)}
                        disabled={slot.soldOut}
                        aria-pressed={isSelected}
                        className={`border p-3 text-left transition ${
                          isSelected
                            ? "border-burgundy bg-burgundy/10 text-beige-kem"
                            : slot.soldOut
                              ? "cursor-not-allowed border-beige-kem/20 text-ink-soft/60"
                              : "border-beige-kem/35 text-beige-kem hover:border-beige-kem"
                        }`}
                      >
                        <span className="block font-display text-title-s font-black leading-none">
                          {slot.time}
                        </span>
                        <span className="mt-1.5 block truncate font-meta text-eyebrow text-ink-soft">
                          {slot.venue}
                        </span>
                        <span
                          className={`mt-0.5 block font-meta text-eyebrow ${
                            slot.soldOut ? "text-ink-soft" : "text-burgundy-ink"
                          }`}
                        >
                          {slot.soldOut ? "Hết vé" : "Còn vé"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/*
                Only general admission picks a quantity here. A seated order's quantity is however
                many seats get clicked on the next screen, so listing the tiers on this page would
                be a second, contradictory way to say the same number.
              */}
              {!isSeated && (
                <div>
                  <p className="label-eyebrow text-ink-soft">Hạng vé</p>
                  {/*
                    One tier per row, ruled apart. A grid of bordered cards made each tier an object
                    to compare side by side, which is the wrong reading — this is a price list, and a
                    price list is a column.
                  */}
                  <ul className="mt-3 border-t border-beige-kem/25">
                    {tiers.map((tier) => {
                      const cap = tierCap(tier);
                      const quantity = quantities[tier.id] ?? 0;
                      const soldOut = cap === 0;
                      const remaining = remainingOf(tier);

                      return (
                        <li
                          key={tier.id}
                          className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-beige-kem/25 py-4"
                        >
                          <div className="min-w-[12rem] flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
                                {tier.label}
                              </span>
                              {tier.badge && (
                                <span className="border border-beige-kem/50 px-2 py-0.5 font-meta text-eyebrow text-beige-kem">
                                  {tier.badge}
                                </span>
                              )}
                            </div>
                            {tier.description && (
                              <p className="mt-1 text-meta leading-5 text-beige-kem/70">
                                {tier.description}
                              </p>
                            )}
                            <p className="mt-1 font-meta text-eyebrow text-ink-soft">
                              {remaining === null || remaining === undefined
                                ? "Còn vé"
                                : soldOut
                                  ? "Hết vé"
                                  : `Còn ${remaining} vé`}
                            </p>
                          </div>

                          <span className="shrink-0 font-display text-title-s font-black text-beige-kem">
                            {formatVnd(tier.price)}
                          </span>

                          <div className="flex shrink-0 items-center gap-3">
                            <button
                              type="button"
                              onClick={() => adjustQuantity(tier, -1)}
                              disabled={quantity === 0 || holdBusy}
                              aria-label={`Bớt vé ${tier.label}`}
                              className="grid h-9 w-9 place-items-center border border-beige-kem/50 font-meta text-beige-kem transition hover:border-beige-kem disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              −
                            </button>
                            <span className="w-6 text-center font-meta text-body font-bold text-beige-kem">
                              {quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => adjustQuantity(tier, 1)}
                              disabled={soldOut || quantity >= cap || holdBusy}
                              aria-label={`Thêm vé ${tier.label}`}
                              className="grid h-9 w-9 place-items-center border border-beige-kem/50 font-meta text-beige-kem transition hover:border-beige-kem disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </BookingSection>

        {/*
          Everything below is about the event rather than the purchase, so it comes after both
          steps — and it is set as one ruled column, the shape the reference gives its itinerary.

          Only the blurb collapses. It is the one thing here long enough that hiding it saves a
          screen; the two policy notes are two sentences each, and a click to reveal two sentences
          costs more than it returns. The refund line in particular is already printed under the
          buy button, so folding it away here would be hiding what the page just said elsewhere.
        */}
        <div className="border-t border-beige-kem/30 pt-2">
          <Disclosure label="Giới thiệu" heading="section" defaultOpen>
            {/*
              Set at reading size, not at caption size. This is the only prose on the page; at 14px
              it was smaller than the labels around it. `max-w-2xl` holds the measure so the line
              length stays readable on a wide screen even though the column is not.
            */}
            <p className="max-w-2xl whitespace-pre-line text-lede leading-8 text-beige-kem/90">
              {event.description}
            </p>

            {/*
              The two facts the panel has no room for: the age note is a sentence rather than a
              rating, and the line-up is a list. Everything shorter is up beside the price.
            */}
            <dl className="mt-8 grid gap-x-12 gap-y-4 sm:grid-cols-2">
              {[
                ["Đơn vị/nghệ sĩ", event.cast.join(", ")],
                ["Độ tuổi", event.ageDescription],
                ["Địa chỉ", event.location],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex gap-4 border-b border-beige-kem/20 pb-3">
                    <dt className="w-32 shrink-0 font-meta text-meta tracking-[0.08em] text-ink-soft">
                      {label}
                    </dt>
                    <dd className="min-w-0 flex-1 text-body leading-6 text-beige-kem">{value}</dd>
                  </div>
                ))}
            </dl>
          </Disclosure>

          {/*
            Label left, content right, one hairline under each — the same row the reference uses for
            a day of its itinerary. It replaces a three-column grid, which gave three short notes
            equal width and equal weight and made the page end on a wall of small print.
          */}
          <dl>
            {[
              ["Hoàn/đổi vé", event.refundPolicy],
              ["Hướng dẫn đến nơi", event.venueGuide],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 border-b border-beige-kem/30 py-4 sm:flex-row sm:gap-8"
                >
                  <dt className="shrink-0 font-display text-body font-bold uppercase tracking-[0.04em] text-beige-kem sm:w-56">
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 text-body leading-6 text-beige-kem/80">{value}</dd>
                </div>
              ))}

            <div className="flex flex-col gap-2 border-b border-beige-kem/30 py-4 sm:flex-row sm:items-center sm:gap-8">
              <dt className="shrink-0 font-display text-body font-bold uppercase tracking-[0.04em] text-beige-kem sm:w-56">
                Nhắc lịch
              </dt>
              <dd className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onToggleWishlist(event.id)}
                  aria-pressed={isWishlisted}
                  className={`border px-3 py-1.5 font-meta text-meta transition ${
                    isWishlisted
                      ? "border-burgundy bg-burgundy text-white"
                      : "border-beige-kem/50 text-beige-kem hover:border-beige-kem"
                  }`}
                >
                  {isWishlisted ? "Đã lưu" : "Lưu sự kiện"}
                </button>
              </dd>
            </div>
          </dl>
        </div>

        {relatedEvents.length > 0 && (
          <section className="border-t border-beige-kem/30 pt-7">
            <p className="label-eyebrow text-ink-soft">Gợi ý tương tự</p>
            <div className="mt-5 grid gap-8 sm:grid-cols-3">
              {relatedEvents.map((related) => (
                <button
                  key={related.id}
                  onClick={() => onBookRelated(related)}
                  className="group text-left"
                >
                  <span className="block aspect-[4/3] overflow-hidden bg-beige-kem/[0.07]">
                    <img
                      src={related.imageUrl}
                      alt={related.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.06]"
                    />
                  </span>
                  <span className="mt-3 block">
                    <span className="line-clamp-2 font-display text-body font-bold uppercase leading-[1.35] tracking-[0.06em] text-beige-kem transition group-hover:text-burgundy-ink">
                      {related.title}
                    </span>
                    <span className="mt-1 block font-meta text-meta text-ink-soft">
                      {formatVnd(related.price)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </BookingLayout>
    </div>
  );
}
