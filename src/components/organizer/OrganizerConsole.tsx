/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { MyEvent, MyVenue, organizerApi } from "../../services/catalogClient";
import EventEditor from "./EventEditor";
import EventList from "./EventList";
import { ErrorRetry, Loading } from "./states";

/**
 * The console shell (feature 006, FR-039).
 *
 * Four levels — events → one event → its showtimes → a showtime's tiers — instead of the single flat
 * screen the panel used to be. Loading, empty and error are handled here and in `states.tsx` once,
 * rather than reinvented per screen.
 */
export default function OrganizerConsole({
  selectedEventId,
  onSelectEvent,
  onCreateRequested,
  onOpenSeatMap,
  reloadKey,
}: {
  /** Which event is open, or null for the list. Console-local for now — the app's screen↔URL
   *  mirroring resets any deeper /organizer path, so level 2 is not yet linkable. */
  selectedEventId: number | null;
  onSelectEvent: (eventId: number | null) => void;
  onCreateRequested: () => void;
  onOpenSeatMap: (eventId: number) => void;
  /** Bumped by the parent after it creates an event or venue, so the console refetches. */
  reloadKey: number;
}) {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [venues, setVenues] = useState<MyVenue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setEvents(null);
    try {
      const [ev, vn] = await Promise.all([organizerApi.myEvents(), organizerApi.myVenues()]);
      setEvents(ev);
      setVenues(vn);
    } catch (e) {
      // Never leave stale data presented as current (FR-040).
      setEvents(null);
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (loadError) return <ErrorRetry message={loadError} onRetry={load} />;
  if (events === null) return <Loading label="Đang tải sự kiện của bạn…" />;

  const selected =
    selectedEventId === null ? null : (events.find((e) => e.id === selectedEventId) ?? null);

  if (selected) {
    return (
      <EventEditor
        event={selected}
        venues={venues}
        onBack={() => onSelectEvent(null)}
        onRefresh={load}
        onOpenSeatMap={onOpenSeatMap}
      />
    );
  }

  return (
    <EventList events={events} onOpen={(e) => onSelectEvent(e.id)} onCreate={onCreateRequested} />
  );
}
