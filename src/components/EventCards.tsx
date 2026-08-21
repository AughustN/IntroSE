/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two event cards, and the two rules that decide what they print.
 *
 * They used to live inside `EventGrid`, which was their only caller. The landing page is now a stack
 * of category rows rather than one grid, so the same card is drawn by three components — and a card
 * that exists in one of them and is copied into the others is a card that stops agreeing with itself
 * the first time a status word changes.
 */

import { Heart } from "lucide-react";
import { MovieEvent } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";
import { sectionOfCategory } from "../services/eventSections";

/** Whether an event is a cinema/movie event (which spans multiple venues and cinemas). */
export const isMovieEvent = (evt: MovieEvent): boolean =>
  sectionOfCategory(evt.category, evt.categoryLabel || "") === "movie";

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
export const statusMeta: Record<
  MovieEvent["status"],
  { label: string; className: string; onImage: string }
> = {
  available: { label: "Còn vé", className: "text-ink-soft", onImage: "text-white/75" },
  sold_out: { label: "Hết vé", className: "text-burgundy-ink", onImage: "text-cam-dat" },
  // Quiet, not alarming: a finished event is not a disappointment the way a sold-out one is. It is
  // simply the archive, so it takes the same soft ink "Còn vé" does rather than the warning red.
  finished: { label: "Đã diễn", className: "text-ink-soft", onImage: "text-white/70" },
  cancelled: { label: "Đã hủy", className: "text-burgundy-ink", onImage: "text-cam-dat" },
};

/**
 * Whether the card's buy control is dead.
 *
 * The same test was written out three times below, which is how `finished` would have been added to
 * two of them and forgotten in the third. One name, one place to extend.
 */
export const isUnbookable = (status: MovieEvent["status"]): boolean =>
  status === "sold_out" || status === "finished" || status === "cancelled";

export interface CardProps {
  evt: MovieEvent;
  isWishlisted: boolean;
  onSelectEvent: (event: MovieEvent) => void;
  onBookNow: (event: MovieEvent) => void;
  onToggleWishlist: (eventId: string) => void;
}

/*
 * The whole card opens the event, on both variants.
 *
 * A convenience for the pointer, not the control itself: the heading is a real button and is what a
 * keyboard reaches and a screen reader announces. An `article` carrying `role="button"` would be
 * the alternative and it is worse — it would flatten the card's text into one long accessible name
 * and swallow the buttons inside it.
 *
 * Every interactive child therefore stops the click from reaching the card, or the card would
 * navigate out from under the wishlist heart and the trailer overlay. Where a child does the same
 * thing the card does, stopping it is still necessary: two calls to `onBookNow` mean two
 * navigations and, mid-hold, two confirmation dialogs.
 */
export const stop = (handler: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  handler();
};

/** The landing page's card: ruled, filled, inset still, its own "Đặt vé". */
export function RuledCard({
  evt,
  isActiveHero,
  isWishlisted,
  onSelectEvent,
  onBookNow,
  onToggleWishlist,
  portrait,
}: CardProps & { isActiveHero: boolean; portrait?: boolean }) {
  const meta = statusMeta[evt.status];
  const bookingDisabled = isUnbookable(evt.status);

  /*
   * The hover fill is the card's only *static* way of saying "this is one object". `surface-2`
   * cannot do it in the light theme — index.css measures it at 1.03:1 against the page, i.e.
   * invisible — so the separation is carried by the inset below and the rules, and the fill only
   * has to answer "which one am I pointing at".
   */
  return (
    <article
      onClick={() => onBookNow(evt)}
      /*
       * A container, so the card can answer to its own width.
       *
       * It is five across in the cinema band and four across in the others, at every viewport, so
       * "how much room does this card have" and "how wide is the window" are different questions
       * and only the first one matters here. `@2xs` is 288px: on a 1536px window the cinema card is
       * 294px and keeps every size it has today, while the same card on a 1280px window is 243px
       * and takes the compact set. Nothing about the wider layouts moves.
       */
      className={`group @container flex cursor-pointer flex-col border-b border-r border-beige-kem/45 transition-colors ${
        isActiveHero ? "bg-bubblegum/25" : "bg-surface-2 hover:bg-bubblegum/20"
      }`}
    >
      {/*
        The inset is what separates one event from the next.

        Four `aspect-video` stills running edge to edge made a single unbroken band across the row,
        and the hairline between them is page ink at 45% — which disappears the moment a dark
        photograph is laid over it. Holding every still 20px inside its card means neighbours are
        parted by 40px of page instead of by a line drawn on top of them, and the same gap appears
        between rows. It also aligns the still's left edge with the title beneath it.
      */}
      <div className="p-5 pb-0">
        {/*
          `2/3` for a film poster, `16/9` for everything else.

          A poster is portrait by trade — the artwork is designed for a lightbox, not a still frame
          — and in a 16/9 box it shrinks to a stamp with two thirds of the card given over to blur.
          The taller frame is the one the artwork was drawn for, so the same picture arrives four
          times the size without being cropped.
        */}
        <div
          className={`relative overflow-hidden bg-black ${portrait ? "aspect-[2/3]" : "aspect-video"}`}
        >
          {/*
            The blurred backdrop stays, for the minority that is not 16/9. The sharp copy is
            `object-contain` so nothing is ever cropped, and the slack it leaves is filled with the
            same image overscaled and blurred — colours that always agree with the artwork, because
            they are the artwork.
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

            "Còn vé" was printed on nearly every card in the catalogue, which made it the most
            repeated string on the page and told a buyer nothing. "Hết vé" and "Đã hủy" are the two
            a buyer must not miss, so those still ride the image; the strip is dropped when there is
            neither a state to report nor a genre to name.
          */}
          {(evt.genre[0] || bookingDisabled) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent p-3 font-meta text-meta uppercase tracking-[0.1em]">
              {evt.genre[0] ? (
                <span className="truncate text-white/65">{evt.genre[0]}</span>
              ) : (
                <span />
              )}
              {bookingDisabled && <span className={`shrink-0 ${meta.onImage}`}>{meta.label}</span>}
            </div>
          )}

          <button
            onClick={stop(() => onToggleWishlist(evt.id))}
            className={`absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center transition ${
              isWishlisted
                ? "bg-burgundy text-white"
                : "bg-black/45 text-white backdrop-blur-sm hover:bg-black/70"
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
            The scrim is inert — without `pointer-events-none` it would sit over the wishlist button
            and swallow its clicks even at `opacity-0`. Only the trailer button takes pointer events.
          */}
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              onClick={stop(() => onSelectEvent(evt))}
              className="label-eyebrow pointer-events-auto border border-white/70 px-4 py-2 text-white transition hover:bg-white hover:text-black"
            >
              Xem trailer
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        {/*
          A `button` wrapping the `h3`, not the other way round: the heading has to stay a heading
          for the document outline, and a control may contain one but not the reverse. This is the
          card's real control — the keyboard's way in, and what gives the card an accessible name.
        */}
        <button
          type="button"
          onClick={stop(() => onBookNow(evt))}
          title={evt.title}
          className="block max-w-full text-left text-beige-kem transition hover:text-burgundy-ink"
        >
          <h3 className="line-clamp-2 min-h-[2.6rem] font-display text-title-s font-black uppercase leading-[1.05]">
            {evt.title}
          </h3>
        </button>
        {evt.originalTitle && (
          <p className="mt-1 line-clamp-1 font-meta text-meta text-ink-soft">{evt.originalTitle}</p>
        )}

        {/* Back on the card surface, so the hairline rules read as ruling again. */}
        <div className="mt-4 space-y-1 border-t border-beige-kem/25 pt-3">
          <p
            className="truncate font-meta text-body leading-snug text-beige-kem"
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
            Omit location for movie events because each movie spans multiple cinema branches
            and locations, which are selected on the event details page.
          */}
          {!isMovieEvent(evt) && (
            <p
              className="truncate font-meta text-body leading-snug text-ink-soft"
              title={evt.location || undefined}
            >
              {[evt.city, evt.venueName].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {/*
          `flex-wrap` is the guarantee and the container query is the polish.
          
          The price and the booking link sat on one line at a fixed 32px whatever the card's width,
          so a long price in a narrow card pushed the link past the edge. Wrapping means it cannot
          overflow at ANY width — including ones nobody has measured — and the smaller type below
          288px means it rarely has to.
        */}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pt-5">
          <div>
            <p className="label-eyebrow text-ink-soft">Từ</p>
            <p className="mt-1 font-display text-title-s font-black leading-none text-beige-kem @2xs:text-title-m">
              {formatVnd(evt.price)}
            </p>
          </div>
          <button
            onClick={stop(() => onBookNow(evt))}
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
}

/** The catalog page's card: no frame at all, three lines of type under the still. */
export function PlainCard({
  evt,
  isWishlisted,
  onSelectEvent,
  onBookNow,
  onToggleWishlist,
  portrait,
}: CardProps & { portrait?: boolean }) {
  const meta = statusMeta[evt.status];
  const bookingDisabled = isUnbookable(evt.status);

  return (
    <article onClick={() => onBookNow(evt)} className="group cursor-pointer">
      {/*
        The still, and no card around it. The ground behind the image is a wash of page ink rather
        than black, which keeps a portrait still from punching a dark rectangle into a cream page.

        `4/3` rather than `16/9`: this is a catalog of posters and artwork, and the taller frame
        wastes less of itself on backdrop. Fixed either way, because the rows have to line up — the
        one thing deliberately not taken from the reference, which is masonry.
      */}
      <div
        className={`relative overflow-hidden bg-beige-kem/[0.07] ${
          // A listing of nothing but posters gets the frame posters are drawn for; a mixed
          // catalogue keeps `4/3`, which is the compromise that suits both.
          portrait ? "aspect-[2/3]" : "aspect-[4/3]"
        }`}
      >
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

        {/*
          Only bad news rides the image here. The genre strip that shared this corner has moved into
          the type block: it was a black gradient across the bottom third of every still, and with
          no card frame left that gradient was the heaviest thing on the page — a band of ink under
          each picture doing the job the removed border used to do, by accident.
        */}
        {bookingDisabled && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-3 text-right font-meta text-meta uppercase tracking-[0.1em]">
            <span className={meta.onImage}>{meta.label}</span>
          </div>
        )}

        {/*
          The heart only appears under the pointer, like the trailer button beside it. Parked
          permanently on the still it was the one piece of furniture left on a card that no longer
          has any. Saved cards keep it visible regardless — a state you cannot see is not a state.
        */}
        <button
          onClick={stop(() => onToggleWishlist(evt.id))}
          className={`absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center transition ${
            isWishlisted
              ? "bg-burgundy text-white"
              : "bg-black/45 text-white opacity-0 backdrop-blur-sm hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
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

        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            onClick={stop(() => onSelectEvent(evt))}
            className="label-eyebrow pointer-events-auto border border-white/70 px-4 py-2 text-white transition hover:bg-white hover:text-black"
          >
            Xem trailer
          </button>
        </div>
      </div>

      {/*
        Three lines under the still and nothing else: what it is, when, and where plus what it
        costs. No rule above them, no padding box around them — they hang off the bottom of the
        image on 12px of air. There is no "Đặt vé" here because the whole card opens the event.
      */}
      <div className="mt-3">
        <button
          type="button"
          onClick={stop(() => onBookNow(evt))}
          title={evt.title}
          className="block max-w-full text-left text-beige-kem transition hover:text-burgundy-ink"
        >
          <h3 className="line-clamp-2 font-display text-body font-bold uppercase leading-[1.35] tracking-[0.06em]">
            {evt.title}
          </h3>
        </button>

        <p
          className="mt-1 truncate font-meta text-meta leading-snug text-beige-kem/75"
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

        <div className="mt-0.5 flex items-baseline justify-between gap-3">
          <p
            className="truncate font-meta text-meta text-ink-soft"
            title={!isMovieEvent(evt) ? evt.location || undefined : undefined}
          >
            {[evt.genre[0], !isMovieEvent(evt) ? evt.city : null].filter(Boolean).join(" · ")}
          </p>
          <p className="shrink-0 font-meta text-meta text-beige-kem">{formatVnd(evt.price)}</p>
        </div>
      </div>
    </article>
  );
}
