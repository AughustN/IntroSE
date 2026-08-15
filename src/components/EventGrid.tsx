/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { MovieEvent } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";
import Section, { SectionHead } from "./Section";

interface EventGridProps {
  events: MovieEvent[];
  /** Marks the card whose trailer is currently in the hero. Landing page only. */
  selectedEvent?: MovieEvent;
  onSelectEvent: (event: MovieEvent) => void;
  onBookNow: (event: MovieEvent) => void;
  wishlistedIds: string[];
  onToggleWishlist: (eventId: string) => void;
  /** Where the header's "xem tất cả" goes. Omitted on `/events`, which is already that page. */
  onViewAll?: () => void;
  /**
   * Which card the grid draws.
   *
   * `landing` is the ruled listing the home page has always run: four columns sharing hairlines, a
   * tinted card surface, the still inset inside it, and a "Đặt vé" control on every card. It is a
   * promotional band under a hero, and it is built to look like one.
   *
   * `catalog` is the borderless grid the `/events` page runs, after the reference collection page:
   * no rules, no fill, no card padding, three tight lines under each still. It is a page of nothing
   * but results, and the chrome that helps a band of four cards stand out on a busy landing page
   * only gets in the way when the whole page is the grid.
   */
  variant?: "landing" | "catalog";
  /**
   * A column to run down the left of the grid — the filter rail on the catalog page.
   *
   * Passed in rather than rendered here because the filters are the caller's state, and taken here
   * rather than wrapped around this component by the caller because the measure lives in `BAND`: a
   * wrapper outside would have to restate the same max-width and gutters, and the two would drift.
   * Its presence also narrows the grid from four columns to three.
   */
  sidebar?: React.ReactNode;
  /**
   * Cards per page.
   *
   * The whole catalog is now in memory — the browse page filters in the browser, so it has to be —
   * and a page that renders five hundred stills at once is a page nobody scrolls to the end of. The
   * `catalog` variant splits the list and draws controls; the `landing` band simply takes the first
   * page, which is what it always effectively showed. Growing the catalog therefore adds pages
   * rather than length, with no further change here.
   */
  pageSize?: number;
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
const isUnbookable = (status: MovieEvent["status"]): boolean =>
  status === "sold_out" || status === "finished" || status === "cancelled";

/**
 * Which page numbers to draw.
 *
 * Every number up to seven pages; beyond that, the first, the last, the current and its neighbours,
 * with an ellipsis standing in for each run that was dropped. `null` is the ellipsis — a marker
 * rather than a string so the renderer cannot mistake it for a page called "…".
 */
function pageWindow(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const near = [current - 1, current, current + 1].filter((n) => n > 1 && n < total);
  const shown = [1, ...near, total];

  const out: Array<number | null> = [];
  let previous = 0;
  for (const n of shown) {
    if (n - previous > 1) out.push(null);
    out.push(n);
    previous = n;
  }
  return out;
}

/**
 * This band's own measure, wider than the site's.
 *
 * Four landscape cards on `max-w-7xl` leave each about 300px, narrower than the 16/9 still it has
 * to hold. Everything in the section shares this one wrapper — head, featured pair, grid — so the
 * masthead still starts on the same vertical as the first card; running only the grid wide left the
 * heading indented against it. The gutters match `Section`'s so the band reads as a band.
 */
const BAND = "mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8";

interface CardProps {
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
const stop = (handler: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  handler();
};

/** The landing page's card: ruled, filled, inset still, its own "Đặt vé". */
function RuledCard({
  evt,
  isActiveHero,
  isWishlisted,
  onSelectEvent,
  onBookNow,
  onToggleWishlist,
}: CardProps & { isActiveHero: boolean }) {
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
      className={`group flex cursor-pointer flex-col border-b border-r border-beige-kem/45 transition-colors ${ isActiveHero ? "bg-bubblegum/25" : "bg-surface-2 hover:bg-bubblegum/20"
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
        <div className="relative aspect-video overflow-hidden bg-black">
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
            className={`absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center transition ${ isWishlisted
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
            Joined, not interpolated. `venueName` is a detail-only field, and the hardcoded
            separator was printing "TP.HCM ·" with nothing after it on every card in the catalogue.
          */}
          <p
            className="truncate font-meta text-body leading-snug text-ink-soft"
            title={evt.location || undefined}
          >
            {[evt.city, evt.venueName].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-5">
          <div>
            <p className="label-eyebrow text-ink-soft">Từ</p>
            <p className="mt-1 font-display text-title-m font-black leading-none text-beige-kem">
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
function PlainCard({ evt, isWishlisted, onSelectEvent, onBookNow, onToggleWishlist }: CardProps) {
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
      <div className="relative aspect-[4/3] overflow-hidden bg-beige-kem/[0.07]">
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
          className={`absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center transition ${ isWishlisted
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
            title={evt.location || undefined}
          >
            {[evt.genre[0], evt.city].filter(Boolean).join(" · ")}
          </p>
          <p className="shrink-0 font-meta text-meta text-beige-kem">{formatVnd(evt.price)}</p>
        </div>
      </div>
    </article>
  );
}

export default function EventGrid({
  events,
  selectedEvent,
  onSelectEvent,
  onBookNow,
  wishlistedIds,
  onToggleWishlist,
  onViewAll,
  variant = "landing",
  sidebar,
  pageSize = 20,
}: EventGridProps) {
  const featuredEvents = events.filter((evt) => evt.isFeatured).slice(0, 2);
  const catalog = variant === "catalog";
  // Anything a reader could actually pay for. `isUnbookable` already knows what that excludes, so
  // the heading below cannot drift from what the cards say.
  const bookableCount = events.filter((evt) => !isUnbookable(evt.status)).length;

  const [page, setPage] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);

  const pageCount = Math.max(1, Math.ceil(events.length / pageSize));

  /*
   * Back to the first page whenever the result set changes.
   *
   * `events` is the caller's memoised filtered list, so its identity changes exactly when a filter
   * does — which is also the only moment page seven can stop existing. Without this, narrowing a
   * search from twelve pages to two leaves the reader looking at an empty grid and no obvious
   * reason why.
   *
   * Adjusted during render against a remembered previous value, not in an effect. React supports
   * setting a component's own state while rendering it and re-runs the render immediately, before
   * anything is committed; the effect version would paint the wrong page first and then correct
   * itself, and it is what `react-hooks/set-state-in-effect` exists to catch.
   */
  const [previousEvents, setPreviousEvents] = useState(events);
  if (previousEvents !== events) {
    setPreviousEvents(events);
    setPage(1);
  }

  // Clamped anyway: `pageSize` can change under a page that is still valid for the old one.
  const current = Math.min(page, pageCount);
  const visible = useMemo(
    () => (catalog ? events.slice((current - 1) * pageSize, current * pageSize) : events.slice(0, pageSize)),
    [events, catalog, current, pageSize],
  );

  const goToPage = (next: number) => {
    setPage(next);
    // The reader is at the bottom of the grid when they press "Sau"; without this they land on a
    // new page already scrolled past its first two rows.
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
          /*
           * How many, and how many you can actually buy.
           *
           * A bare count is the first thing the eye lands on and the last thing that is checked
           * against the cards under it. Filtering to "Âm nhạc" here returns 160 events of which 159
           * have already happened and one is sold out — every card says so, in small type, one at a
           * time, while the heading says "160 sự kiện" and is believed. The second number is only
           * printed when it disagrees with the first, so a normal result set stays uncluttered.
           */
          meta={
            bookableCount === events.length
              ? `${events.length} sự kiện`
              : `${events.length} sự kiện · ${bookableCount} còn vé`
          }
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
                className={`group relative min-h-[300px] overflow-hidden border-b border-r border-beige-kem/25 bg-xanh-pho ${ index === 0 ? "lg:col-span-4" : "lg:col-span-2"
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
                  <h3 className="mt-3 max-w-xl font-display text-title-l font-black leading-none text-white sm:text-title-l">
                    {evt.title}
                  </h3>
                  <p className="mt-3 line-clamp-2 max-w-2xl text-body leading-6 text-white/75">
                    {evt.description}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-6">
                    <button
                      onClick={() => onBookNow(evt)}
                      disabled={isUnbookable(evt.status)}
                      className="label-eyebrow inline-flex items-center gap-2 text-white transition hover:text-cam-dat disabled:cursor-not-allowed disabled:text-white/35"
                    >
                      {isUnbookable(evt.status) ? statusMeta[evt.status].label : "Mua vé"}
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

      <div className={sidebar ? `${BAND} flex flex-col gap-10 lg:flex-row lg:gap-14` : BAND}>
        {sidebar && (
          /*
            Sticky, so the filters stay reachable while the grid scrolls past them — the whole point
            of moving them out of a bar at the top. `h-fit` keeps the sticky box the height of its
            own content; stretched to the flex row's height it would have nothing to scroll within
            and would never stick.
          */
          <aside className="lg:sticky lg:top-24 lg:h-fit lg:w-60 lg:shrink-0">{sidebar}</aside>
        )}

        <div ref={gridRef} className="min-w-0 flex-1 scroll-mt-24">
          {events.length === 0 ? (
            <div className="hud-dashed mx-auto max-w-lg px-4 py-20 text-center">
              <h3 className="font-display text-title-s font-semibold text-beige-kem">
                Không tìm thấy kết quả
              </h3>
              <p className="mt-2 text-body text-beige-kem/60">
                Thử đổi từ khóa, ngày, thành phố, giá vé hoặc trạng thái còn vé.
              </p>
            </div>
          ) : catalog ? (
            /*
             * Nothing between the cards but page.
             *
             * The catalog this is modelled on carries no rules, no card fill and no card border,
             * and a wide enough gutter that the stills alone separate one work from the next. On a
             * page of arbitrary photographs that reads quieter, because a rule drawn between two
             * images is a third thing competing with both.
             *
             * The gutter has to be wide to do that work — 40px across and 56px down. Deeper
             * vertically because these cards carry three lines of type under the still, and the
             * rows would otherwise read as one column of text.
             */
            <div
              className={`grid grid-flow-dense grid-cols-1 gap-x-10 gap-y-14 sm:grid-cols-2 ${ sidebar ? "lg:grid-cols-3" : "lg:grid-cols-4"
              }`}
            >
              {visible.map((evt) => (
                <PlainCard
                  key={evt.id}
                  evt={evt}
                  isWishlisted={wishlistedIds.includes(evt.id)}
                  onSelectEvent={onSelectEvent}
                  onBookNow={onBookNow}
                  onToggleWishlist={onToggleWishlist}
                />
              ))}
            </div>
          ) : (
            /*
             * One hairline between cards, not a border around each: every card draws only its
             * bottom and right edge, and the container supplies the missing top and left.
             * Neighbours therefore share a single rule instead of stacking two, the way a printed
             * listing page is ruled.
             *
             * Deliberately not `gap-px` over a tinted container. That paints the tint into the
             * empty cells of a partial last row — four events in a three-column grid would show a
             * solid block of ink where the fifth and sixth cards are not.
             */
            <div className="grid grid-flow-dense grid-cols-1 border-l border-t border-beige-kem/45 sm:grid-cols-2 lg:grid-cols-4">
              {visible.map((evt) => (
                <RuledCard
                  key={evt.id}
                  evt={evt}
                  isActiveHero={selectedEvent?.id === evt.id}
                  isWishlisted={wishlistedIds.includes(evt.id)}
                  onSelectEvent={onSelectEvent}
                  onBookNow={onBookNow}
                  onToggleWishlist={onToggleWishlist}
                />
              ))}
            </div>
          )}

          {/*
            Pagination, on the catalog only.

            Ruled off the grid rather than boxed, and set in the page's own meta type — this is the
            same furniture the filter rail and the card meta lines use, not a widget borrowed from
            somewhere else. It renders only when there is more than one page, so a short result set
            is not told it is on page one of one.
          */}
          {catalog && pageCount > 1 && (
            <nav
              aria-label="Phân trang danh sách sự kiện"
              className="mt-14 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-beige-kem/25 pt-6"
            >
              <p className="font-meta text-meta text-ink-soft">
                {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, events.length)} trong{" "}
                {events.length} sự kiện
              </p>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <button
                  type="button"
                  onClick={() => goToPage(current - 1)}
                  disabled={current === 1}
                  className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:cursor-not-allowed disabled:text-ink-soft/40"
                >
                  ‹ Trước
                </button>

                {pageWindow(current, pageCount).map((n, index) =>
                  n === null ? (
                    // Not a button, and not reachable: it stands for pages, it is not one.
                    <span
                      key={`gap-${index}`}
                      aria-hidden="true"
                      className="px-1 font-meta text-meta text-ink-soft/50"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      onClick={() => goToPage(n)}
                      aria-current={n === current ? "page" : undefined}
                      className={`min-w-8 px-2 py-1 font-meta text-meta tabular-nums transition ${ n === current
                          ? "border-b-2 border-burgundy font-bold text-beige-kem"
                          : "text-ink-soft hover:text-beige-kem"
                      }`}
                    >
                      {n}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  onClick={() => goToPage(current + 1)}
                  disabled={current === pageCount}
                  className="label-eyebrow px-2 py-1 text-ink-soft transition hover:text-beige-kem disabled:cursor-not-allowed disabled:text-ink-soft/40"
                >
                  Sau ›
                </button>
              </div>
            </nav>
          )}
        </div>
      </div>
    </Section>
  );
}
