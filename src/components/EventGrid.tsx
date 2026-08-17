/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import { MovieEvent } from "../types";
import Section, { BAND, SectionHead } from "./Section";
import { isUnbookable, PlainCard, RuledCard, statusMeta } from "./EventCards";
import { sectionOfCategory } from "../services/eventSections";

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
  /**
   * What the grid calls itself.
   *
   * Hardcoded as "Đang mở bán / Khám phá lịch diễn" while `/events` was its only serious caller.
   * The saved page renders the same grid over a different list, and a page of bookmarks headed
   * "Khám phá lịch diễn" describes the wrong thing entirely.
   */
  eyebrow?: string;
  title?: string;
  /** What an empty result set says. The catalog blames the filters; other lists have other reasons. */
  emptyTitle?: string;
  emptyHint?: string;
}

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
  eyebrow = "Đang mở bán",
  title = "Khám phá lịch diễn",
  emptyTitle = "Không tìm thấy kết quả",
  emptyHint = "Thử đổi từ khóa, ngày, thành phố, giá vé hoặc trạng thái còn vé.",
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
    () =>
      catalog
        ? events.slice((current - 1) * pageSize, current * pageSize)
        : events.slice(0, pageSize),
    [events, catalog, current, pageSize],
  );

  /*
   * Is this listing nothing but film?
   *
   * Posters get the frame they were drawn for, but only when every card on screen is one. Deciding
   * per card would make a mixed catalogue ragged — one portrait card in a row of stills stretches
   * that whole row to poster height and leaves the rest floating in it — so the shape is a property
   * of the listing, not of the event. Filter to Phim and the grid turns; browse everything and it
   * stays as it was.
   *
   * `sectionOfCategory` does the matching, so an admin-created category called "Điện ảnh" with a
   * generated code counts as film exactly as the landing band counts it.
   */
  const allFilm = useMemo(
    () =>
      visible.length > 0 &&
      visible.every((evt) => sectionOfCategory(evt.category, evt.categoryLabel) === "movie"),
    [visible],
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
          eyebrow={eyebrow}
          title={title}
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
          /*
            `relative z-20` because the rail has things that hang out of it — the date picker's
            calendar is wider than the 240px column and reaches over the first card. The grid beside
            it is positioned too, and later in the DOM, so without a stacking order of its own the
            rail's panels were painted *under* the card art.
          */
          <aside className="relative z-20 lg:sticky lg:top-24 lg:h-fit lg:w-60 lg:shrink-0">
            {sidebar}
          </aside>
        )}

        <div ref={gridRef} className="min-w-0 flex-1 scroll-mt-24">
          {events.length === 0 ? (
            <div className="hud-dashed mx-auto max-w-lg px-4 py-20 text-center">
              <h3 className="font-display text-title-s font-semibold text-beige-kem">
                {emptyTitle}
              </h3>
              <p className="mt-2 text-body text-beige-kem/60">{emptyHint}</p>
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
              className={`grid grid-flow-dense grid-cols-1 gap-x-10 gap-y-14 sm:grid-cols-2 ${
                allFilm
                  ? sidebar
                    ? "lg:grid-cols-4"
                    : "lg:grid-cols-5"
                  : sidebar
                    ? "lg:grid-cols-3"
                    : "lg:grid-cols-4"
              }`}
            >
              {visible.map((evt) => (
                <PlainCard
                  key={evt.id}
                  evt={evt}
                  portrait={allFilm}
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
            <div
              className={`grid grid-flow-dense grid-cols-1 border-l border-t border-beige-kem/45 sm:grid-cols-2 ${
                allFilm ? "lg:grid-cols-5" : "lg:grid-cols-4"
              }`}
            >
              {visible.map((evt) => (
                <RuledCard
                  key={evt.id}
                  evt={evt}
                  portrait={allFilm}
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
                      className={`min-w-8 px-2 py-1 font-meta text-meta tabular-nums transition ${
                        n === current
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
