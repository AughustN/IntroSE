// The live public-visibility predicate (R-1, D-B/D-E). An event is public only when it is on sale,
// admin-approved, AND its owning organizer is currently approved (not suspended). Composed into EVERY
// public read — the single most important anti-leak control (SC-004). Assumes the query aliases the
// events row as `e` and joins its organizer as `o` (organizers).

export const VISIBLE_JOIN = `JOIN organizers o ON o.id = e.organizer_id`;

export const VISIBLE_WHERE = `e.status = 'on_sale' AND e.moderation_status = 'approved' AND o.status = 'approved'`;

// Upcoming, sellable showtime of event alias `e` (excludes past/cancelled/finished).
export const UPCOMING_SHOWTIME = `s.event_id = e.id AND s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')`;

/**
 * Is showtime `s` open for sale right now? Assumes `s` joined to its event `e` and `VISIBLE_JOIN`.
 *
 * The one definition of "on sale", shared by the two sides that must agree about it: the buy path
 * uses it to decide whether a hold may be placed, and the seat-map editor uses it to decide whether
 * an organizer may still restructure or reprice the map. Written twice, the two drift, and the gap
 * between them is precisely the window where a buyer holds a seat on a map being edited underneath
 * them. Whatever counts as sellable is by construction off-limits to the editor.
 */
export const SHOWTIME_ON_SALE = `${VISIBLE_WHERE} AND s.starts_at > now() AND s.status NOT IN ('cancelled', 'finished')`;

// Whether a showtime `s` still has availability, branching on the event's type (R-2):
//   seated → an available showtime_seat, OR a capacity zone with room;  GA → a tier with remaining.
//
// The seated branch gained its second half with capacity zones (0027). A seated chart may hold a
// standing floor, and a floor produces no `showtime_seats` at all — so a venue sold entirely as zones
// had every seat check come back empty and was hidden from the catalog as though it were sold out.
//
// `total_quantity IS NOT NULL` is what keeps that half honest: a seated tier's quantity is NULL
// meaning "gated by its seats", and counting those as available would make a genuinely sold-out
// seated showtime advertise itself as open.
export const SHOWTIME_HAS_AVAILABILITY = `(
  (e.event_type = 'seated' AND (
     EXISTS (SELECT 1 FROM showtime_seats ss WHERE ss.showtime_id = s.id AND ss.status = 'available')
     OR EXISTS (
       SELECT 1 FROM ticket_tiers tt WHERE tt.showtime_id = s.id
         AND tt.archived_at IS NULL
         AND tt.total_quantity IS NOT NULL
         AND tt.sold_quantity + tt.reserved_quantity < tt.total_quantity)))
  OR
  (e.event_type = 'general_admission' AND EXISTS (
     SELECT 1 FROM ticket_tiers tt WHERE tt.showtime_id = s.id
       AND tt.archived_at IS NULL
       AND (tt.total_quantity IS NULL OR tt.sold_quantity + tt.reserved_quantity < tt.total_quantity)))
)`;
