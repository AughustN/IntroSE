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
          <div className="flex flex-col items-center gap-5 text-center">
            {/*
              The marquee, built from the reference: a gabled red plate, bulbs round the border, a
              cream letterboard, CINEMA in black.

              Three lines at one size read as flat, and the fix is not another size step but two
              different KINDS of object — the name is a fixed sign, the tabs are tickets you choose
              between. A reader sorts those by shape before reading a word of either.

              The two colours are literals rather than palette tokens, which is the one place in
              this file that is true. Every token flips with the theme, and a sign hanging over a
              door does not: a cinema hoarding is a painted object, and repainting it cream-on-dark
              at night would make it a different object rather than the same one after dark.
            */}
            <div className="inline-flex flex-col items-center">
              {/*
                The pediment and its finial. `clip-path` rather than a border trick, so the slope
                stays a slope at any width and the shape can carry the plate's own red.
              */}
              <span
                aria-hidden="true"
                className="-mb-1 h-4 w-4 rotate-45 rounded-[3px] bg-[#c0261f]"
              />
              <span
                aria-hidden="true"
                className="h-8 w-[84%] bg-[#c0261f]"
                style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }}
              />

              <span className="relative -mt-px block bg-[#c0261f] p-3.5 shadow-[0_10px_28px_rgba(0,0,0,0.3)]">
                {/*
                  The bulbs, as their own layer rather than on the plate itself. The ring is cut with
                  `mask-composite: exclude`, and a mask applies to an element's children as well as
                  its background — put it on the plate and the plate's own letterboard is what the
                  hole in the middle removes. Measured: the board rendered as a black void.
                */}
                <span
                  aria-hidden="true"
                  className="marquee-bulb-ring pointer-events-none absolute inset-0 text-[#ffe9b8]"
                />
                {/*
                  The letterboard: cream, ruled the way the slats of a real one are, with the name
                  set heavy and black across it.
                */}
                <span
                  className="relative block border border-black/20 bg-[#f4ead6] px-6 py-2.5 sm:px-8"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, rgba(0,0,0,0.07) 0 1px, transparent 1px 9px)",
                  }}
                >
                  <h2 className="font-display text-title-m font-black uppercase leading-none tracking-[0.06em] text-[#141110]">
                    {eyebrow}
                  </h2>
                </span>
              </span>
            </div>

            {/*
              Two torn stubs. `ticket-punch` bites a semicircle out of each side, which is the shape
              the nav's own account ticket already uses — so the control reads as a ticket without
              a single new drawing.

              `flex-wrap` is the guard, not the plan: the pair is meant to sit on one line, and two
              ten-character words at this size plus the gap fit the band but not a phone.
            */}
            <div
              role="tablist"
              aria-label={eyebrow}
              className="flex flex-wrap items-stretch justify-center gap-5 sm:gap-8"
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
                    className={`ticket-punch block px-7 py-3 transition sm:px-9 ${
                      active
                        ? "bg-burgundy text-white"
                        : "bg-beige-kem/10 text-ink-soft hover:bg-beige-kem/20 hover:text-beige-kem"
                    }`}
                    style={{ "--punch-r": "10px" } as React.CSSProperties}
                  >
                    {/*
                      The type lives on a span, not on the button: `index.css` sets
                      `button, input, select { font: inherit }` OUTSIDE any layer, which outranks
                      every Tailwind utility, so a size written on the button itself is dropped.
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
          /*
            Cinema drops the ruling and the other bands keep it.

            Every band drew the same hairline card, so the cinema row looked like the music row with
            different pictures in it — which is why a bigger heading could not make it stand out:
            the heading is a tenth of the band and the cards are the rest. MUBI and A24 both run
            their films with no card chrome at all, and it is the single thing they have in common.

            The gap replaces the rules as the thing that separates one film from the next.
          */
          <div
            className={`grid grid-flow-dense ${
              film ? "gap-x-5 gap-y-8" : "border-l border-t border-beige-kem/45"
            } ${
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
            {shownEvents.map((evt, index) => (
              <RuledCard
                key={evt.id}
                evt={evt}
                portrait={film}
                chromeless={film}
                /*
                  Every other column sits lower, breaking the level line four other bands hold to.
                  A reader registers the broken rhythm before reading a word — it is the cheapest
                  difference on the page, and the one A24 leans on hardest.

                  Only from `lg`, where there are five columns and the stagger reads as intent. At
                  two columns it would just look like one card failed to align.
                */
                offsetRow={film && index % 2 === 1}
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
