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

import { MovieEvent } from "../types";
import { RuledCard } from "./EventCards";
import Section, { BAND, SectionHead } from "./Section";

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
}: CategoryRowProps) {
  return (
    /*
      20px from a title to its own cards, 32px from those cards to the next title. The heading has
      to sit closer to what it names than to the band above it, or a stack of five bands reads as
      five titles floating between five grids.
    */
    <Section density="row" divided={false} bleed className="space-y-5">
      <div className={BAND}>
        <SectionHead
          // A stack of bands, so no rules: the burgundy stroke down the left of the title is what
          // says a new band has started. See `SectionHead`.
          variant="bar"
          eyebrow={eyebrow}
          title={title}
          actionLabel={onViewMore ? "Xem thêm" : undefined}
          onAction={onViewMore}
        />
      </div>

      <div className={BAND}>
        {events.length === 0 ? (
          /*
            An empty band still prints. "Phim sắp chiếu" with nothing under it says something true
            about the catalogue; a band that vanishes when it is empty is indistinguishable from one
            that was never on the page.
          */
          <div className="hud-dashed px-4 py-14 text-center">
            <p className="font-meta text-body text-ink-soft">{emptyNote}</p>
          </div>
        ) : (
          /*
            One hairline between cards, not a border around each: every card draws only its bottom
            and right edge and the container supplies the missing top and left, so neighbours share
            a single rule the way a printed listing page is ruled.
          */
          <div className="grid grid-flow-dense grid-cols-1 border-l border-t border-beige-kem/45 sm:grid-cols-2 lg:grid-cols-4">
            {events.map((evt) => (
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
      </div>
    </Section>
  );
}
