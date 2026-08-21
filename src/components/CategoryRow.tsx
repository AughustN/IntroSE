/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One of the landing page's category bands: a heading, a "Xem thêm" into the filtered catalog, and
 * four cards.
 *
 * The landing page used to be one undifferentiated grid under a filter strip, which asked the reader
 * to describe what they wanted before it would show them anything. A stack of named bands answers
 * the same question the other way round — here is what we have, by kind — and the filter work moves
 * to `/events`, where a reader who already knows what they are after goes.
 *
 * The band draws the same ruled card the old landing grid did, so nothing about an individual event
 * reads differently for having been sorted into a band.
 */

import { useState } from "react";
import { MovieEvent } from "../types";
import type { LandingTab } from "../services/eventSections";
import { RuledCard } from "./EventCards";
import Section, { BAND, FilmRail, SectionHead } from "./Section";

interface CategoryRowProps {
  title: string;
  eyebrow: string;
  events: MovieEvent[];
  /** What to say when the catalogue has nothing of this kind yet. */
  emptyNote: string;
  /**
   * Opens `/events` filtered to this band. Omitted when the band is empty — a link to a listing that
   * is guaranteed to be blank is a promise the page cannot keep.
   */
  onViewMore?: () => void;
  /** Marks the card whose trailer is in the hero, exactly as the old landing grid did. */
  selectedEvent?: MovieEvent;
  onSelectEvent: (event: MovieEvent) => void;
  onBookNow: (event: MovieEvent) => void;
  wishlistedIds: string[];
  onToggleWishlist: (eventId: string) => void;
  /**
   * Draw this band as a reel: perforated rails top and bottom, a centred head, and portrait cards.
   * Set for the cinema band, whose artwork is posters rather than stills.
   */
  film?: boolean;
  /**
   * Sub-divisions of this band, switched in place. Cinema's "Sắp chiếu" / "Đang chiếu" (0038).
   *
   * They replace the heading rather than sitting under it: the two words ARE what the band is
   * called once it holds two things, and a title plus two tabs saying nearly the same thing makes
   * the reader work out which one is the control.
   */
  tabs?: LandingTab[];
}

export default function CategoryRow({
  title,
  eyebrow,
  events,
  emptyNote,
  onViewMore,
  selectedEvent,
  onSelectEvent,
  onBookNow,
  wishlistedIds,
  onToggleWishlist,
  film = false,
  tabs,
}: CategoryRowProps) {
  const [activeTab, setActiveTab] = useState(0);
  // A tabbed band shows the tab; a plain one shows what it was given. `tabs?.[activeTab]` and not
  // `tabs[0]` so a band whose tab list shrinks between renders cannot land on a hole.
  const current = tabs?.[activeTab];
  const shownEvents = current ? current.events : events;
  const shownEmptyNote = current ? current.emptyNote : emptyNote;

  return (
    /*
      20px from a title to its own cards, 32px from those cards to the next title. The heading has
      to sit closer to what it names than to the band above it, or a stack of five bands reads as
      five titles floating between five grids.
    */
    <Section density="row" divided={false} bleed className="space-y-5">
      {film && <FilmRail />}

      <div className={BAND}>
        {/*
          The reel band centres its head and the others keep the ruled bar.

          A band held between two perforated rails is bounded on all four sides already; the bar's
          left stroke is a divider for bands that have no frame, and inside a symmetrical one a
          left-anchored title reads as having slipped off centre. "Xem thêm" goes with it — see the
          foot of the band below — because centring the head and then hanging a link off its right
          shoulder puts the heading back off-axis by the width of the link.
        */}
        {tabs && tabs.length > 1 ? (
          <div className="flex flex-col items-center gap-3 text-center">
{/*
              Set exactly as every other band's title — "Ca nhạc", "Sân khấu & Nghệ thuật" — because
              it is doing that job here. The bar variant's eyebrow is a caption above a title; this
              band has no title line of its own, so the same 14px label left the band unnamed next
              to neighbours announcing themselves at 50px.
            */}
            <h2 className="font-display text-title-l font-black leading-none text-beige-kem">
              {eyebrow}
            </h2>
            {/*
              The two names, at heading size, because that is what they are — the band's title, in
              two halves, one of which is currently true. Drawing them as small pills under a
              separate `<h2>` would make the heading the loudest thing and the actual choice a
              footnote to it.
            */}
{/*
              `flex-wrap` is the guard, not the plan: the pair is meant to sit on one line, and two
              ten-character words at 50px plus the gap come to about 480px. It fits the band and
              would not fit a phone, so the size steps down there and the wrap catches whatever is
              left — a longer label in another language, say.
            */}
            <div
              role="tablist"
              aria-label={eyebrow}
              className="flex flex-wrap items-end justify-center gap-6 sm:gap-10"
            >
              {tabs.map((tab, index) => {
                const active = index === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(index)}
                    className={`block pb-1 transition ${
                      active
                        ? "border-b-4 border-burgundy text-beige-kem"
                        : "border-b-4 border-transparent text-ink-soft hover:text-beige-kem"
                    }`}
                  >
                    {/*
                      The type lives on a span, not on the button.
                      
                      `index.css` sets `button, input, select { font: inherit }` OUTSIDE any layer,
                      which outranks every Tailwind utility — a `text-title-l` written on a button
                      is silently dropped and the control inherits body's 16px. The rule is
                      deliberate and documented there; moving it into `@layer base` would resize
                      every control in the app at once. A span inside the button is not a button, so
                      the utilities apply to it normally.
                    */}
                    <span className="font-display text-title-m font-black leading-none sm:text-title-l">
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <SectionHead
            variant={film ? "reel" : "bar"}
            eyebrow={eyebrow}
            title={title}
            actionLabel={!film && onViewMore ? "Xem thêm" : undefined}
            onAction={film ? undefined : onViewMore}
          />
        )}
      </div>

      <div className={BAND}>
        {shownEvents.length === 0 ? (
          /*
            An empty band still prints. "Phim sắp chiếu" with nothing under it says something true
            about the catalogue; a band that vanishes when it is empty is indistinguishable from one
            that was never on the page.
          */
          <div className="hud-dashed px-4 py-14 text-center">
            <p className="font-meta text-body text-ink-soft">{shownEmptyNote}</p>
          </div>
        ) : (
          /*
            One hairline between cards, not a border around each: every card draws only its bottom
            and right edge and the container supplies the missing top and left, so neighbours share
            a single rule the way a printed listing page is ruled.
          */
          <div
            className={`grid grid-flow-dense border-l border-t border-beige-kem/45 ${
              /*
               * Posters go two-up on a phone; stills stay one.
               *
               * A 2:3 poster at the full width of a 390px screen is 465px tall, so one film filled
               * the display and five of them made the band five screens of scrolling — the reader
               * has to remember the first card by the time they reach the last, which is the one
               * thing a shortlist is meant to save them. Half width makes it a glance again, and a
               * portrait card survives being narrow far better than a landscape one does.
               *
               * Five at `lg` has to stay in step with `CINEMA_PER_ROW`, which is how many the band
               * is given: Tailwind only compiles class names it can read in the source, so neither
               * of these can be built from a variable.
               */
              film
                ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {shownEvents.map((evt) => (
              <RuledCard
                key={evt.id}
                evt={evt}
                portrait={film}
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
          The way out of a reel band, at its foot and to the right — where a reader who has run out
          of cards is already looking, and the last thing they read rather than something competing
          with the heading. Hidden when the band is empty, for the reason `onViewMore` is: a link to
          a listing guaranteed to be blank is a promise the page cannot keep.
        */}
        {film && onViewMore && shownEvents.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onViewMore}
              className="label-eyebrow inline-flex items-center gap-2 text-beige-kem transition hover:text-burgundy-ink"
            >
              Xem thêm
              <span aria-hidden="true">&gt;</span>
            </button>
          </div>
        )}
      </div>

      {film && <FilmRail />}
    </Section>
  );
}
