/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Play } from "lucide-react";
import { MovieEvent } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";
import Section, { SectionMeasure, SectionHead } from "./Section";

interface EventTickerProps {
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
          <p className="line-clamp-2 font-display text-lg font-bold leading-tight text-beige-kem">
            {event.title}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.1em] text-ink-soft">
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
    <Section bleed>
      <SectionMeasure>
        <SectionHead
          eyebrow="Sự kiện nổi bật"
          title="Đang được quan tâm nhất"
          actionLabel="Xem tất cả"
          onAction={onViewAll}
        />
      </SectionMeasure>

      <div
        className="ticker-viewport mt-10 overflow-hidden border-y border-beige-kem/25"
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
