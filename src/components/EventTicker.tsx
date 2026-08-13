/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Flame, Play } from "lucide-react";
import { MovieEvent } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";
import Section, { BAND, SectionHead } from "./Section";

interface EventTickerProps {
  /**
   * The curated trending list, in the Admin's order (`featured_events`, UC-35) — not the catalogue.
   *
   * This band used to run every event the browser had loaded, which on a catalogue of five hundred
   * meant a rail nobody could reach the end of and an editorial heading over a list nobody had
   * edited. Ten chosen events is what the heading has always claimed.
   */
  events: MovieEvent[];
  onSelect: (event: MovieEvent) => void;
  onViewAll: () => void;
}

/** Doron runs eight cards. Fewer than a screenful and the loop reads as a stutter, not a loop. */
const MIN_ITEMS = 6;

function TickerCard({ event, onSelect }: { event: MovieEvent; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-[300px] shrink-0 border-r border-beige-kem/25 p-4 text-left transition-colors hover:bg-bubblegum/20 sm:w-[360px]"
    >
      <div className="relative aspect-video overflow-hidden bg-surface-2">
        <img
          src={event.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
      </div>
      <div className="mt-3 flex items-start gap-2.5">
        <Play
          className="mt-0.5 h-4 w-4 shrink-0 text-burgundy-ink"
          strokeWidth={2.5}
          fill="currentColor"
        />
        <div className="min-w-0">
          <p className="line-clamp-2 font-display text-lede font-bold leading-tight text-beige-kem">
            {event.title}
          </p>
          <p className="mt-1 truncate font-meta text-meta uppercase tracking-[0.1em] text-ink-soft">
            {[event.dates[0] && formatEventDate(event.dates[0]), formatVnd(event.price)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
    </button>
  );
}

/**
 * The featured rail, after Doron's MISSION section: a heading block, then a row of cards that runs
 * itself sideways forever.
 *
 * The set is rendered twice. That is not a duplicate-content mistake — the track travels exactly
 * -50%, so at the instant the animation restarts the second copy is sitting where the first began
 * and the loop has no visible seam. The clone is `aria-hidden` and its cards are removed from the
 * tab order, so a screen reader and a keyboard both see the list once.
 */
export default function EventTicker({ events, onSelect, onViewAll }: EventTickerProps) {
  if (events.length === 0) return null;

  // Short catalogues get padded by repetition, or the row ends mid-viewport and the loop is obvious.
  const items: MovieEvent[] = [];
  while (items.length < MIN_ITEMS && events.length > 0) items.push(...events);

  // Longer rows must not travel faster, so the duration scales with how much there is to travel.
  const duration = `${items.length * 9}s`;

  return (
    /*
      `row` density: this is the first of a stack of bands now, not a section on its own page.

      The extra top margin is the seam with the hero above it, which ends flush against whatever
      follows it. 16px of section padding alone put this heading almost on the trailer's bottom edge.
      81px on top of that opens the gap to ~97px — three times the 32px between the bands below, and
      deliberately so: this is the join between two different kinds of thing, a full-bleed trailer
      and the stack of listings, and it must not read as one more step down the stack.
    */
    <Section density="row" bleed className="mt-[81px]">
      {/* `BAND`, not `SectionMeasure` — the four headings under this one sit on the wider measure. */}
      <div className={BAND}>
        <SectionHead
          // The first band of the landing stack, so it takes the same stroked head the category
          // rows below it do rather than the ruled one.
          variant="bar"
          eyebrow="Sự kiện xu hướng"
          /*
            Hidden from assistive tech: it marks the band, it does not add a word to it. Announced,
            it would read as "lửa sự kiện xu hướng".
          */
          icon={
            <Flame
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-burgundy-ink"
              strokeWidth={2.5}
              fill="currentColor"
            />
          }
          title="Đang được quan tâm"
          actionLabel="Xem tất cả"
          onAction={onViewAll}
        />
      </div>

      <div
        className="ticker-viewport mt-5 overflow-hidden border-y border-beige-kem/25"
        style={{ ["--ticker-duration" as string]: duration }}
      >
        <div className="ticker-track">
          {items.map((event, i) => (
            <TickerCard key={`a-${i}`} event={event} onSelect={() => onSelect(event)} />
          ))}
          {/* The seamless half. Hidden from assistive tech and from Tab. */}
          <div className="flex" aria-hidden="true" inert>
            {items.map((event, i) => (
              <TickerCard key={`b-${i}`} event={event} onSelect={() => onSelect(event)} />
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
