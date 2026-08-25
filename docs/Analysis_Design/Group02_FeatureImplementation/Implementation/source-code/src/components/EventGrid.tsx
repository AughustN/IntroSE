/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Heart } from "lucide-react";
import { MovieEvent } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";
import Section, { SectionHead } from "./Section";

interface EventGridProps {
  events: MovieEvent[];
  selectedEvent: MovieEvent;
  onSelectEvent: (event: MovieEvent) => void;
  onBookNow: (event: MovieEvent) => void;
  wishlistedIds: string[];
  onToggleWishlist: (eventId: string) => void;
  /** Where the header's "xem tất cả" goes. Omitted on `/events`, which is already that page. */
  onViewAll?: () => void;
}

/**
 * Status now reads as a word in the card's meta line rather than a coloured sticker.
 *
 * Doron's cards carry no badges at all: type and state are set in the same mono as everything else
 * and separated by rules. Only the two states a buyer must not miss keep a colour.
 */
const statusMeta: Record<MovieEvent["status"], { label: string; className: string }> = {
  available: { label: "Còn vé", className: "text-ink-soft" },
  low: { label: "Sắp hết", className: "text-burgundy-ink" },
  sold_out: { label: "Hết vé", className: "text-ink-soft" },
  cancelled: { label: "Đã hủy", className: "text-burgundy-ink" },
};

export default function EventGrid({
  events,
  selectedEvent,
  onSelectEvent,
  onBookNow,
  wishlistedIds,
  onToggleWishlist,
  onViewAll,
}: EventGridProps) {
  const featuredEvents = events.filter((evt) => evt.isFeatured).slice(0, 2);

  return (
    <Section divided={false} className="space-y-12">
      <SectionHead
        eyebrow="Đang mở bán"
        title="Khám phá lịch diễn"
        meta={`${events.length} sự kiện`}
        actionLabel={onViewAll ? "Xem tất cả" : undefined}
        onAction={onViewAll}
      />

      {featuredEvents.length > 0 && (
        <div className="grid grid-flow-dense grid-cols-1 border-l border-t border-beige-kem/25 lg:grid-cols-6">
          {featuredEvents.map((evt, index) => (
            <article
              key={evt.id}
              className={`group relative min-h-[300px] overflow-hidden border-b border-r border-beige-kem/25 bg-xanh-pho ${
                index === 0 ? "lg:col-span-4" : "lg:col-span-2"
              }`}
            >
              <img
                src={evt.imageUrl}
                alt={evt.title}
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-xanh-pho via-xanh-pho/65 to-transparent" />
              {/* Registration marks sit above the photo, inset from the panel edge. */}
              <div className="hud-corners pointer-events-none absolute inset-4 z-10" />
              <div className="relative z-10 flex h-full min-h-[300px] flex-col justify-end p-7">
                <p className="label-eyebrow text-white/70">Nổi bật</p>
                <h3 className="mt-3 max-w-xl font-display text-4xl font-black leading-none text-white sm:text-5xl">
                  {evt.title}
                </h3>
                <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-white/75">
                  {evt.description}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-6">
                  <button
                    onClick={() => onBookNow(evt)}
                    disabled={evt.status === "sold_out" || evt.status === "cancelled"}
                    className="label-eyebrow inline-flex items-center gap-2 text-white transition hover:text-cam-dat disabled:cursor-not-allowed disabled:text-white/35"
                  >
                    {evt.status === "sold_out" ? "Hết vé" : "Mua vé"}
                    <span aria-hidden="true">&gt;</span>
                  </button>
                  <button
                    onClick={() => onSelectEvent(evt)}
                    className="label-eyebrow text-white/70 transition hover:text-white"
                  >
                    Xem trailer
                  </button>
                  <button
                    onClick={() => onToggleWishlist(evt.id)}
                    className="label-eyebrow text-white/70 transition hover:text-white"
                  >
                    {wishlistedIds.includes(evt.id) ? "Đã lưu" : "Lưu"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <div className="hud-dashed mx-auto max-w-lg px-4 py-20 text-center">
          <h3 className="font-display text-xl font-semibold text-beige-kem">
            Không tìm thấy kết quả
          </h3>
          <p className="mt-2 text-sm text-beige-kem/60">
            Thử đổi từ khóa, ngày, thành phố, giá vé hoặc trạng thái còn vé.
          </p>
        </div>
      ) : (
        /*
         * One hairline between cards, not a border around each: every card draws only its bottom
         * and right edge, and the container supplies the missing top and left. Neighbours therefore
         * share a single rule instead of stacking two, the way a printed listing page is ruled.
         *
         * Deliberately not `gap-px` over a tinted container. That paints the tint into the empty
         * cells of a partial last row — four events in a three-column grid would show a solid block
         * of ink where the fifth and sixth cards are not.
         */
        <div className="grid grid-flow-dense grid-cols-1 border-l border-t border-beige-kem/25 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((evt) => {
            const isActiveHero = selectedEvent.id === evt.id;
            const isWishlisted = wishlistedIds.includes(evt.id);
            const meta = statusMeta[evt.status];
            const bookingDisabled = evt.status === "sold_out" || evt.status === "cancelled";

            return (
              <article
                key={evt.id}
                className={`group flex flex-col border-b border-r border-beige-kem/25 transition-colors ${
                  isActiveHero ? "bg-bubblegum/25" : "bg-surface-2"
                }`}
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={evt.imageUrl}
                    alt={evt.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <button
                    onClick={() => onToggleWishlist(evt.id)}
                    className={`absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center transition ${
                      isWishlisted
                        ? "bg-burgundy text-white"
                        : "bg-surface-2/90 text-beige-kem hover:bg-surface-2"
                    }`}
                    aria-pressed={isWishlisted}
                    title={isWishlisted ? "Bỏ khỏi wishlist" : "Thêm vào wishlist hoặc nhắc lịch"}
                  >
                    <Heart
                      className="h-4 w-4"
                      strokeWidth={2}
                      fill={isWishlisted ? "currentColor" : "none"}
                    />
                  </button>
                  {/*
                    The scrim is inert: it is the last child of the image, so without
                    `pointer-events-none` it sits over the wishlist button and swallows its clicks
                    even at `opacity-0`. Only the trailer button itself takes pointer events.
                  */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-xanh-pho/80 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => onSelectEvent(evt)}
                      className="label-eyebrow pointer-events-auto text-beige-kem transition hover:text-burgundy-ink"
                    >
                      Xem trailer
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  {/* Type, rating and state on one mono line — Doron's card meta row. */}
                  <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-soft">
                    <span className="truncate">{evt.genre[0]}</span>
                    <span aria-hidden="true">/</span>
                    <span>{evt.ageRating}</span>
                    <span aria-hidden="true">/</span>
                    <span>{evt.rating}</span>
                    <span className={`ml-auto shrink-0 ${meta.className}`}>{meta.label}</span>
                  </div>

                  <h3 className="mt-4 line-clamp-2 min-h-[3.6rem] font-display text-[26px] font-bold leading-tight text-beige-kem">
                    {evt.title}
                  </h3>
                  {evt.originalTitle && (
                    <p className="mt-1 line-clamp-1 font-mono text-[11px] text-ink-soft">
                      {evt.originalTitle}
                    </p>
                  )}

                  {/* Facts as a ruled two-row table rather than icon chips. */}
                  <dl className="mt-5 border-t border-beige-kem/25 text-xs">
                    <div className="flex items-baseline gap-3 border-b border-beige-kem/25 py-2">
                      <dt className="label-eyebrow w-16 shrink-0 text-ink-soft">Lịch</dt>
                      <dd
                        className="truncate font-mono text-beige-kem"
                        title={
                          evt.dates.length > 1
                            ? evt.dates.map((d) => formatEventDate(d, true)).join(", ")
                            : undefined
                        }
                      >
                        {[evt.dates[0] && formatEventDate(evt.dates[0]), evt.times[0]]
                          .filter(Boolean)
                          .join(" · ")}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-3 border-b border-beige-kem/25 py-2">
                      <dt className="label-eyebrow w-16 shrink-0 text-ink-soft">Nơi</dt>
                      <dd className="truncate font-mono text-beige-kem" title={evt.location}>
                        {evt.city} · {evt.venueName}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 font-mono text-[11px] text-ink-soft">
                    {evt.status === "sold_out"
                      ? "Bấm ♥ để được nhắc khi mở thêm suất."
                      : `Còn khoảng ${evt.ticketsLeft} vé`}
                  </p>

                  <div className="mt-auto flex items-end justify-between gap-4 pt-6">
                    <div>
                      <p className="label-eyebrow text-ink-soft">Từ</p>
                      <p className="mt-1 font-display text-2xl font-black leading-none text-beige-kem">
                        {formatVnd(evt.price)}
                      </p>
                    </div>
                    <button
                      onClick={() => onBookNow(evt)}
                      disabled={bookingDisabled}
                      className="label-eyebrow inline-flex items-center gap-2 text-beige-kem transition hover:text-burgundy-ink disabled:cursor-not-allowed disabled:text-ink-soft disabled:hover:text-ink-soft"
                    >
                      {bookingDisabled ? "Nhắc tôi" : "Đặt vé"}
                      <span aria-hidden="true">&gt;</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
