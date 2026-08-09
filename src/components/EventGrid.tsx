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
 *
 * The card answers one question only — can I still buy? — so `low` reads as "Còn vé" like
 * `available`; the exact remaining count is left to the detail page.
 *
 * Two colours per state, because the word appears in two places. `className` is for meta set on the
 * page surface; `onImage` is for the same word burnt into a poster, where the page's inks are far
 * too dark to read and peach is the only accent that survives an arbitrary photograph.
 */
const statusMeta: Record<
  MovieEvent["status"],
  { label: string; className: string; onImage: string }
> = {
  available: { label: "Còn vé", className: "text-ink-soft", onImage: "text-white/75" },
  low: { label: "Còn vé", className: "text-ink-soft", onImage: "text-white/75" },
  sold_out: { label: "Hết vé", className: "text-burgundy-ink", onImage: "text-cam-dat" },
  cancelled: { label: "Đã hủy", className: "text-burgundy-ink", onImage: "text-cam-dat" },
};

/**
 * This band's own measure, wider than the site's.
 *
 * Four landscape cards on `max-w-7xl` leave each about 300px, narrower than the 16/9 still it has
 * to hold. Everything in the section shares this one wrapper — head, featured pair, grid — so the
 * masthead still starts on the same vertical as the first card; running only the grid wide left the
 * heading indented against it. The gutters match `Section`'s so the band reads as a band.
 */
const BAND = "mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8";

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
    /*
     * `bleed` hands the section its width back so `BAND` can set a wider one. Deliberately not a
     * change to `MEASURE` itself — that would re-grid the whole site, which is the thing `Section`
     * exists to prevent.
     */
    <Section divided={false} bleed className="space-y-12">
      <div className={BAND}>
        <SectionHead
          eyebrow="Đang mở bán"
          title="Khám phá lịch diễn"
          meta={`${events.length} sự kiện`}
          actionLabel={onViewAll ? "Xem tất cả" : undefined}
          onAction={onViewAll}
        />
      </div>

      {featuredEvents.length > 0 && (
        <div className={BAND}>
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
        </div>
      )}

      {events.length === 0 ? (
        <div className={BAND}>
          <div className="hud-dashed mx-auto max-w-lg px-4 py-20 text-center">
            <h3 className="font-display text-xl font-semibold text-beige-kem">
              Không tìm thấy kết quả
            </h3>
            <p className="mt-2 text-sm text-beige-kem/60">
              Thử đổi từ khóa, ngày, thành phố, giá vé hoặc trạng thái còn vé.
            </p>
          </div>
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
        <div className={BAND}>
          <div className="grid grid-flow-dense grid-cols-1 border-l border-t border-beige-kem/45 sm:grid-cols-2 lg:grid-cols-4">
            {events.map((evt) => {
              const isActiveHero = selectedEvent.id === evt.id;
              const isWishlisted = wishlistedIds.includes(evt.id);
              const meta = statusMeta[evt.status];
              const bookingDisabled = evt.status === "sold_out" || evt.status === "cancelled";

              /*
               * The hover fill is the card's only *static* way of saying "this is one object".
               * `surface-2` cannot do it in the light theme — index.css measures it at 1.03:1
               * against the page, i.e. invisible — so the separation is carried by the inset below
               * and the rules, and the fill only has to answer "which one am I pointing at".
               */
              return (
                <article
                  key={evt.id}
                  className={`group flex flex-col border-b border-r border-beige-kem/45 transition-colors ${
                    isActiveHero ? "bg-bubblegum/25" : "bg-surface-2 hover:bg-bubblegum/20"
                  }`}
                >
                  {/*
                  The inset is what separates one event from the next.

                  Four `aspect-video` stills running edge to edge made a single unbroken band across
                  the row, and the hairline between them is page ink at 45% — which disappears the
                  moment a dark photograph is laid over it. Holding every still 20px inside its card
                  means neighbours are parted by 40px of page instead of by a line drawn on top of
                  them, and the same gap appears between rows. It also aligns the still's left edge
                  with the title beneath it, which the full-bleed crop never did.
                */}
                  <div className="p-5 pb-0">
                    <div className="relative aspect-video overflow-hidden bg-black">
                      {/*
                    The blurred backdrop stays, for the minority that is not 16/9. The sharp copy is
                    `object-contain` so nothing is ever cropped, and the slack it leaves is filled
                    with the same image overscaled and blurred — colours that always agree with the
                    artwork, because they are the artwork. A true 16/9 file covers the frame outright
                    and the backdrop is never seen.
                  */}
                      <img
                        src={evt.imageUrl}
                        alt=""
                        aria-hidden="true"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
                      />
                      <img
                        src={evt.imageUrl}
                        alt={evt.title}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                        className="relative h-full w-full object-contain transition-transform duration-[1400ms] ease-out group-hover:scale-[1.06]"
                      />

                      {/* Shapes the light so a bright still does not bleed into the cream page. */}
                      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_55px_14px_rgba(0,0,0,0.45)]" />

                      {/*
                    The state word only appears when it is bad news.

                    "Còn vé" was printed on nearly every card in the catalogue, which made it the
                    most repeated string on the page and told a buyer nothing — tickets being
                    available is the default a listing already implies. "Hết vé" and "Đã hủy" are
                    the two a buyer must not miss, so those still ride the image; the strip itself
                    is dropped when there is neither a state to report nor a genre to name.
                  */}
                      {(evt.genre[0] || bookingDisabled) && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent p-3 font-mono text-[13px] uppercase tracking-[0.1em]">
                          {evt.genre[0] ? (
                            <span className="truncate text-white/65">{evt.genre[0]}</span>
                          ) : (
                            <span />
                          )}
                          {bookingDisabled && (
                            <span className={`shrink-0 ${meta.onImage}`}>{meta.label}</span>
                          )}
                        </div>
                      )}

                      <button
                        onClick={() => onToggleWishlist(evt.id)}
                        className={`absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center transition ${
                          isWishlisted
                            ? "bg-burgundy text-white"
                            : "bg-black/45 text-white backdrop-blur-sm hover:bg-black/70"
                        }`}
                        aria-pressed={isWishlisted}
                        title={
                          isWishlisted ? "Bỏ khỏi wishlist" : "Thêm vào wishlist hoặc nhắc lịch"
                        }
                      >
                        <Heart
                          className="h-4 w-4"
                          strokeWidth={2}
                          fill={isWishlisted ? "currentColor" : "none"}
                        />
                      </button>

                      {/*
                    The scrim is inert — without `pointer-events-none` it would sit over the wishlist
                    button and swallow its clicks even at `opacity-0`. Only the trailer button takes
                    pointer events.
                  */}
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          onClick={() => onSelectEvent(evt)}
                          className="label-eyebrow pointer-events-auto border border-white/70 px-4 py-2 text-white transition hover:bg-white hover:text-black"
                        >
                          Xem trailer
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="line-clamp-2 min-h-[2.6rem] font-display text-[21px] font-black uppercase leading-[1.05] text-beige-kem">
                      {evt.title}
                    </h3>
                    {evt.originalTitle && (
                      <p className="mt-1 line-clamp-1 font-mono text-[13px] text-ink-soft">
                        {evt.originalTitle}
                      </p>
                    )}

                    {/* Back on the card surface, so the hairline rules read as ruling again. */}
                    <div className="mt-4 space-y-1 border-t border-beige-kem/25 pt-3">
                      <p
                        className="truncate font-mono text-[15px] leading-snug text-beige-kem"
                        title={
                          evt.dates.length > 1
                            ? evt.dates.map((d) => formatEventDate(d, true)).join(", ")
                            : undefined
                        }
                      >
                        {[evt.dates[0] && formatEventDate(evt.dates[0], true), evt.times[0]]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {/*
                      Joined, not interpolated. `venueName` is another detail-only field, and the
                      hardcoded separator was printing "TP.HCM ·" with nothing after it on every
                      card in the catalogue.
                    */}
                      <p
                        className="truncate font-mono text-[15px] leading-snug text-ink-soft"
                        title={evt.location || undefined}
                      >
                        {[evt.city, evt.venueName].filter(Boolean).join(" · ")}
                      </p>
                    </div>

                    <div className="mt-auto flex items-end justify-between gap-4 pt-5">
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
        </div>
      )}
    </Section>
  );
}
