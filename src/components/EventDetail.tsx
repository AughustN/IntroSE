/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Showtime } from "@/shared/catalog/types";
import { MovieEvent } from "../types";
import { formatHoldClock } from "../services/holdSession";
import { watchShowtime } from "../services/seatSocket";
import SeatMapView from "./SeatMapView";

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
  /** General admission: no seat map exists, so quantities go straight to checkout. */
  onProceedToQuantityCheckout: (
    selection: TierSelection[],
    showtimeId: number | null,
    date: string,
    time: string,
  ) => void;
  /**
   * The hold already placed for this event, if any. Stepping back here from checkout must show the
   * same showtime and the same quantities — the flow keeps its selection until the buyer leaves it.
   */
  restoreHold?: {
    selectedDate: string;
    selectedTime: string;
    quantities: Record<string, number>;
  } | null;
  /** Milliseconds left on that hold, so step 01 shows the same clock as steps 02 and 03. */
  holdRemainingMs?: number;
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
  onProceedToQuantityCheckout,
  restoreHold = null,
  holdRemainingMs = 0,
}: EventDetailProps) {
  const isSeated = event.eventType === "seated";

  // An event carries at most 4 ticket tiers (enforced server-side); slice defensively so a bad
  // payload can never break the even 1–4 column layout below.
  const tiers = useMemo(() => event.ticketTiers.slice(0, MAX_TIERS), [event.ticketTiers]);
  // Divide the row evenly by tier count so 1/2/3/4 tiers each fill the width (mobile stays single
  // column, and 4 tiers fall to two rows of two on a narrow screen).
  const tierGridClass =
    tiers.length <= 1
      ? "grid-cols-1"
      : tiers.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : tiers.length === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-2 sm:grid-cols-4";

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
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  /** The held showtime is restored once; after that the buyer's own clicks win. */
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const held =
      restoreHold &&
      slots.find((s) => s.date === restoreHold.selectedDate && s.time === restoreHold.selectedTime);

    if (held && restoredKeyRef.current !== held.key) {
      restoredKeyRef.current = held.key;
      setSelectedSlotKey(held.key);
      setQuantities(restoreHold!.quantities);
      return;
    }

    if (selectedSlotKey) return;
    const firstOpen = slots.find((s) => !s.soldOut) ?? slots[0];
    setSelectedSlotKey(firstOpen?.key ?? "");
  }, [slots, restoreHold, selectedSlotKey]);

  useEffect(() => {
    // Switching event or showtime starts a new selection — unless this is the slot we just
    // restored from the live hold.
    if (restoredKeyRef.current === selectedSlotKey) return;
    setQuantities({});
  }, [event.id, selectedSlotKey]);

  const selectedSlot = slots.find((s) => s.key === selectedSlotKey) ?? null;
  const eventUnavailable = event.status === "sold_out" || event.status === "cancelled";

  /**
   * Live tier availability for the selected showtime (US3): when anyone reserves or releases a
   * general-admission quantity, "Còn N vé" follows within about a second. Advisory only — the server
   * still refuses an over-reservation regardless of what this shows (FR-023).
   */
  const [liveRemaining, setLiveRemaining] = useState<Record<string, number | null>>({});

  useEffect(() => {
    setLiveRemaining({});
    const showtimeId = selectedSlot?.showtimeId;
    if (isSeated || !showtimeId) return;
    return watchShowtime(showtimeId, (update) => {
      if (!update.tier) return;
      setLiveRemaining((current) => ({ ...current, [String(update.tier!.ticketTierId)]: update.tier!.remaining }));
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
    eventUnavailable ||
    !selectedSlot ||
    selectedSlot.soldOut ||
    (!isSeated && totalQuantity === 0);

  const isWishlisted = wishlistedIds.includes(event.id);

  /** What a tier has left right now: the live number if the channel has sent one, else the fetched one. */
  const remainingOf = (tier: MovieEvent["ticketTiers"][number]): number | null | undefined =>
    tier.id in liveRemaining ? liveRemaining[tier.id] : tier.remaining;

  const tierCap = (tier: MovieEvent["ticketTiers"][number]) => {
    const remaining = remainingOf(tier);
    return remaining === null || remaining === undefined ? MAX_PER_TIER : Math.min(remaining, MAX_PER_TIER);
  };

  const adjustQuantity = (tierId: string, delta: number, cap: number) => {
    setQuantities((current) => {
      const next = Math.min(Math.max((current[tierId] ?? 0) + delta, 0), cap);
      return { ...current, [tierId]: next };
    });
  };

  const handlePrimaryAction = () => {
    if (!selectedSlot) return;
    // The showtime id is what the hold API locks against — carry it, not just the display strings.
    if (isSeated) onProceedToSeatSelection(selectedSlot.showtimeId, selectedSlot.date, selectedSlot.time);
    else onProceedToQuantityCheckout(selection, selectedSlot.showtimeId, selectedSlot.date, selectedSlot.time);
  };

  const primaryLabel = eventUnavailable
    ? "Chưa thể đặt vé"
    : isSeated
      ? "Tiếp tục chọn ghế"
      : "Tiếp tục thanh toán";

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-beige-kem/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 font-mono text-sm text-la-co transition hover:text-beige-kem"
        >
          Quay lại danh sách
        </button>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-beige-kem/45">
          <span className="font-semibold text-burgundy">01 Chọn suất</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span>02 {isSeated ? "Chọn ghế" : "Chọn số lượng vé"}</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span>03 Thanh toán</span>

          {/* A hold placed further along the flow is still running while the buyer looks back here. */}
          {restoreHold && holdRemainingMs > 0 && (
            <span className="inline-flex items-center gap-2 rounded-lg border border-cam-dat/30 bg-cam-dat/5 px-2.5 py-1 text-cam-dat">
              Đang giữ chỗ
              <b className="text-sm font-black text-beige-kem">{formatHoldClock(holdRemainingMs)}</b>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <aside className="space-y-6 rounded-2xl border border-beige-kem/10 bg-xanh-pho/50 p-5 lg:col-span-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-2xl">
            <img
              src={event.imageUrl}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-xanh-pho/90 via-transparent to-transparent" />
            <button
              onClick={() => onToggleWishlist(event.id)}
              className="absolute right-4 top-4 inline-flex h-10 items-center justify-center rounded-full border border-white/25 bg-black/35 px-3 text-[10px] font-bold uppercase text-white backdrop-blur transition hover:bg-white hover:text-xanh-pho"
              title="Wishlist hoặc nhắc lịch"
            >
              {isWishlisted ? "Đã lưu" : "Lưu"}
            </button>
            <div className="absolute bottom-4 left-4 rounded-lg bg-burgundy px-3 py-1 font-mono text-xs font-bold text-beige-kem shadow">
              {statusLabels[event.status]} / còn {event.ticketsLeft} vé
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-cam-dat px-2 py-0.5 font-mono text-xs font-bold text-xanh-pho">
                {event.ageRating}
              </span>
              <span className="font-mono text-xs font-semibold text-la-co">
                {event.rating} / {event.reviewCount} đánh giá
              </span>
            </div>

            <div>
              <h2 className="font-display text-3xl font-black leading-tight text-beige-kem sm:text-4xl">
                {event.title}
              </h2>
              {event.originalTitle && (
                <p className="mt-1 font-mono text-sm text-cam-dat">{event.originalTitle}</p>
              )}
            </div>

            <p className="rounded-xl border border-beige-kem/10 bg-beige-kem/5 p-3 text-xs leading-relaxed text-la-co">
              <span className="mb-1 block font-semibold text-beige-kem">Độ tuổi phù hợp</span>
              {event.ageDescription}
            </p>

            <p className="text-sm leading-7 text-beige-kem/80">{event.description}</p>

            <div className="space-y-3 border-t border-beige-kem/10 pt-4 text-xs text-beige-kem/72">
              <div className="flex items-center gap-3">
                <span className="font-bold text-cam-dat">Thời lượng</span>
                <span>{event.duration} phút</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-cam-dat">Thể loại</span>
                <span>{event.genre.join(", ")}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-cam-dat">Đơn vị/nghệ sĩ</span>
                <span>{event.cast.join(", ")}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="shrink-0 font-bold text-cam-dat">Địa điểm</span>
                <span>{event.location}</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-6 lg:col-span-7">
          {/* Step 01 — Chọn suất. Placed first so the on-screen order matches the flow the
              step indicator promises (Chọn suất → Chọn vé → Thanh toán). */}
          <section className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
            <h3 className="mb-4 font-display text-lg font-black text-beige-kem">
              <span className="font-mono text-xs text-cam-dat">01 · </span>Chọn suất
            </h3>
            {slots.length === 0 ? (
              <p className="rounded-xl border border-dashed border-beige-kem/15 py-6 text-center text-xs text-beige-kem/45">
                Chưa có suất nào đang mở bán.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {slots.map((slot) => {
                  const isSelected = slot.key === selectedSlotKey;
                  return (
                    <button
                      key={slot.key}
                      onClick={() => setSelectedSlotKey(slot.key)}
                      disabled={slot.soldOut}
                      className={`rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-burgundy bg-burgundy text-beige-kem"
                          : "border-beige-kem/10 bg-white/[0.035] text-beige-kem/78 hover:border-cam-dat"
                      } disabled:cursor-not-allowed disabled:border-beige-kem/10 disabled:bg-white/[0.02] disabled:text-beige-kem/30`}
                    >
                      <span className="block font-mono text-sm font-bold">
                        {slot.date} · {slot.time}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] opacity-70">
                        {slot.venue}
                        {slot.soldOut ? " · Hết vé" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {isSeated && selectedSlot?.showtimeId !== null && selectedSlot && (
            <section className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
              <h3 className="mb-1 font-display text-lg font-black text-beige-kem">Tình trạng ghế</h3>
              <p className="mb-4 font-mono text-[11px] text-beige-kem/50">
                Xem trước chỗ còn trống của suất đã chọn. Chọn ghế ở bước sau.
              </p>
              <SeatMapView showtimeId={selectedSlot.showtimeId} />
            </section>
          )}

          {/* Step 02 — Chọn vé (seat tiers for a seated event, quantity per tier for GA). */}
          <section className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
            <h3 className="mb-1 font-display text-xl font-black text-beige-kem">
              <span className="font-mono text-xs text-cam-dat">02 · </span>
              {isSeated ? "Hạng vé đang bán" : "Chọn số lượng vé"}
            </h3>
            <p className="mb-4 font-mono text-[11px] text-beige-kem/50">
              {isSeated
                ? "Sự kiện có ghế ngồi — giá theo hạng ghế, chọn vị trí ở bước sau."
                : "Sự kiện vé tự do, không có sơ đồ ghế. Chọn số lượng cho từng hạng vé."}
            </p>
            <div className={`grid gap-3 ${tierGridClass}`}>
              {tiers.map((tier) =>
                isSeated ? (
                  /* Seated: pure information (seat is picked on the next screen). Rendered as a flat
                     tile — no card border, no hover — so it never reads as a tappable button. */
                  <div key={tier.id} className="border-l-2 border-cam-dat/40 pl-3">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-base font-black text-beige-kem">{tier.label}</span>
                      {tier.badge && (
                        <span className="rounded-full border border-cam-dat/35 bg-cam-dat/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cam-dat">
                          {tier.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm font-bold text-cam-dat">{formatPrice(tier.price)}</p>
                    {tier.description && (
                      <p className="mt-1 text-xs leading-5 text-beige-kem/62">{tier.description}</p>
                    )}
                  </div>
                ) : (
                  /* General admission: interactive — pick a quantity here, so the card affordance
                     (border + stepper) is intended. */
                  (() => {
                    const cap = tierCap(tier);
                    const quantity = quantities[tier.id] ?? 0;
                    const soldOut = cap === 0;
                    return (
                      <div
                        key={tier.id}
                        className="flex flex-col rounded-xl border border-beige-kem/10 bg-white/[0.035] p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display text-base font-black text-beige-kem">{tier.label}</span>
                          {tier.badge && (
                            <span className="rounded-full border border-cam-dat/35 bg-cam-dat/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cam-dat">
                              {tier.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 font-mono text-sm font-bold text-cam-dat">{formatPrice(tier.price)}</p>
                        {tier.description && (
                          <p className="mt-2 text-xs leading-5 text-beige-kem/62">{tier.description}</p>
                        )}
                        <p className="mt-2 font-mono text-[11px] text-beige-kem/55">
                          {remainingOf(tier) === null || remainingOf(tier) === undefined
                            ? "Còn vé"
                            : soldOut
                              ? "Hết vé"
                              : `Còn ${remainingOf(tier)} vé`}
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-beige-kem/10 pt-3">
                          <button
                            type="button"
                            onClick={() => adjustQuantity(tier.id, -1, cap)}
                            disabled={quantity === 0}
                            aria-label={`Bớt vé ${tier.label}`}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-beige-kem/20 font-mono text-sm font-bold text-beige-kem transition hover:border-cam-dat disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="font-mono text-base font-black text-beige-kem">{quantity}</span>
                          <button
                            type="button"
                            onClick={() => adjustQuantity(tier.id, 1, cap)}
                            disabled={soldOut || quantity >= cap}
                            aria-label={`Thêm vé ${tier.label}`}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-beige-kem/20 font-mono text-sm font-bold text-beige-kem transition hover:border-cam-dat disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })()
                ),
              )}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-la-co/25 bg-la-co/5 p-4">
              <h4 className="font-display font-bold text-beige-kem">Hoàn/đổi vé</h4>
              <p className="mt-2 text-xs leading-5 text-beige-kem/68">{event.refundPolicy}</p>
            </div>
            <div className="rounded-2xl border border-cam-dat/25 bg-cam-dat/5 p-4">
              <h4 className="font-display font-bold text-beige-kem">Hướng dẫn đến nơi</h4>
              <p className="mt-2 text-xs leading-5 text-beige-kem/68">{event.venueGuide}</p>
            </div>
            <div className="rounded-2xl border border-burgundy/30 bg-burgundy/5 p-4">
              <h4 className="font-display font-bold text-beige-kem">Nhắc lịch</h4>
              <p className="mt-2 text-xs leading-5 text-beige-kem/68">
                Bấm Lưu để thêm vào wishlist và nhắc lịch gần ngày diễn. Trạng thái này đang lưu local trong frontend.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-mono text-xs uppercase text-la-co">Suất bạn chọn</p>
                <h4 className="font-display text-lg font-black text-beige-kem">
                  {selectedSlot
                    ? `${selectedSlot.date} · ${selectedSlot.time} · ${selectedSlot.venue}`
                    : "Chưa chọn suất"}
                </h4>
                {!isSeated && (
                  <p className="font-mono text-xs text-beige-kem/70">
                    {totalQuantity === 0
                      ? "Chưa chọn vé"
                      : `${selection
                          .map((line) => `${line.quantity} × ${line.label}`)
                          .join(" · ")} — ${formatPrice(totalPrice)}`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <button
                  onClick={handlePrimaryAction}
                  disabled={bookingDisabled}
                  className="inline-flex items-center justify-center rounded-xl bg-burgundy px-7 py-4 text-sm font-black text-beige-kem shadow-xl transition hover:bg-burgundy/90 disabled:cursor-not-allowed disabled:bg-beige-kem/10 disabled:text-beige-kem/35"
                >
                  {primaryLabel}
                </button>
                {!isSignedIn && !eventUnavailable && (
                  <p className="font-mono text-[11px] text-beige-kem/50">
                    {isSeated ? "Cần đăng nhập để chọn ghế" : "Cần đăng nhập để thanh toán"}
                  </p>
                )}
              </div>
            </div>
          </section>

          {relatedEvents.length > 0 && (
            <section className="rounded-2xl border border-beige-kem/10 bg-white/[0.025] p-6">
              <h3 className="mb-4 font-display text-xl font-black text-beige-kem">Gợi ý tương tự</h3>
              <div className="grid gap-3 md:grid-cols-3">
                {relatedEvents.map((related) => (
                  <button
                    key={related.id}
                    onClick={() => onBookRelated(related)}
                    className="group overflow-hidden rounded-xl border border-beige-kem/10 bg-xanh-pho text-left transition hover:border-cam-dat"
                  >
                    <img
                      src={related.imageUrl}
                      alt={related.title}
                      referrerPolicy="no-referrer"
                      className="h-24 w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <span className="block p-3">
                      <span className="line-clamp-2 font-display text-sm font-bold text-beige-kem">{related.title}</span>
                      <span className="mt-1 block font-mono text-[11px] text-cam-dat">{formatPrice(related.price)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
