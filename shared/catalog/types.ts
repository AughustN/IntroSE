// One typed contract for the event catalog, shared by server and web (Principle VI).
// Derived from src/specs/002-event-catalog/contracts/catalog.openapi.yaml. Money = whole VND đồng.

export type EventType = 'general_admission' | 'seated';
export type SeatStatus = 'available' | 'held' | 'sold' | 'blocked';
export type ShowtimeAvailability = 'available' | 'sold_out' | 'unavailable';

export interface EventCard {
  id: number;
  slug: string;
  title: string;
  imageUrl: string | null;
  category: string; // category code
  city: string | null; // derived from showtime venues
  earliestShowtime: string | null; // ISO date-time
  startingPrice: number | null; // VND integer
  soldOut: boolean; // derived — all upcoming showtimes sold out (D-A)
}

export interface Tier {
  id: number;
  label: string;
  price: number; // VND integer
  remaining: number | null; // GA remaining = capacity − sold − reserved; null = seated/unlimited
}

export interface Showtime {
  id: number;
  startsAt: string;
  venue: { name: string; city: string };
  availability: ShowtimeAvailability;
}

export interface EventDetail extends EventCard {
  description: string;
  ageRestriction: string;
  lineup: string[];
  genre: string[];
  trailerUrl: string | null;
  refundPolicy: string | null;
  eventType: EventType;
  venueGuide: string | null;
  tiers: Tier[];
  related: EventCard[];
  seo: { title: string; description: string; imageUrl: string | null };
}

export interface SeatMapSeat {
  id: number;
  /** Which price tier this seat belongs to — what the buyer map colours by (FR-067). */
  tierId?: number | null;
  row: string;
  number: number;
  tier: string;
  price: number; // whole VND
  status: SeatStatus;
  // Geometry (feature 005). Integer units in the layout's 0–10000 space; rotation is cosmetic and
  // never affects a seat's footprint or its overlap behaviour (FR-008).
  x: number;
  y: number;
  rotation: number;
  /** Section name — drives the accessible label and the tab order (FR-039a). */
  section: string | null;
  /**
   * The seat's drawn form, from its section's style (FR-064). Shape and size reach the buyer —
   * section COLOUR does not, because on the buyer's map colour means price and nothing else.
   * Absent on pre-amendment snapshots, where the renderers fall back to 005's circle at 1×.
   */
  shape?: 'circle' | 'square';
  /** Multiplier on the space's nominal seat diameter. 1 = 005's baseline. */
  sizeMultiplier?: number;
}

/** Non-sellable decoration (feature 005). Never inventory: it cannot be held, sold, or priced (FR-017). */
export interface SeatMapElement {
  kind:
    | 'stage'
    | 'aisle'
    | 'door'
    | 'bar'
    | 'label'
    | 'area'
    // Hall outline and dividers, drawn from `points` (FR-057, FR-058).
    | 'boundary'
    | 'divider'
    // Facility icons (FR-061).
    | 'exit'
    | 'restroom'
    | 'food_drink'
    | 'smoking'
    | 'first_aid'
    | 'lift_stairs'
    | 'wheelchair';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Rendered as literal text, never as markup (FR-018). */
  label: string | null;
  /** Ordered vertices for `boundary` / `divider`; the rectangle fields stay as the bounding box. */
  points?: { x: number; y: number }[] | null;
}

/** Background layer only. Holds no seat and no status (FR-020). */
export interface SeatMapFloorPlan {
  url: string;
  scale: number; // per-mille of the coordinate space
  offsetX: number;
  offsetY: number;
  opacity: number; // 0–100
}

export interface SeatMapSpace {
  width: number;
  height: number;
  seatDiameter: number;
}

export interface SeatMap {
  eventType: EventType;
  seats?: SeatMapSeat[]; // seated — ordered section → row → number (the tab-order guarantee)
  tiers?: Tier[]; // general admission
  // Seated only (feature 005).
  space?: SeatMapSpace;
  elements?: SeatMapElement[];
  /** Present ONLY when the organizer made the plan buyer-visible (FR-026). */
  floorPlan?: SeatMapFloorPlan | null;
  /**
   * Tier → colour + price, ordered cheapest first (FR-067). Derived at read time from the showtime's
   * tiers; nothing is stored, and no ticket-tier column is added. The legend is the AUTHORITY for what
   * a seat costs — colour is the shorthand, never the only signal (FR-071).
   */
  tierLegend?: SeatMapTierLegendEntry[];
  /** Tables the showtime snapshotted, so a seat labelled "Bàn 5 - Ghế 3" is drawn at its table (FR-082). */
  tables?: SeatMapTable[];
}

export interface SeatMapTierLegendEntry {
  tierId: number;
  label: string;
  /** Whole VND đồng (STD-03). */
  price: number;
  color: string;
}

/** A snapshotted table. Decoration on the buyer map: drawn, never interactive (FR-082). */
export interface SeatMapTable {
  name: string;
  shape: 'round' | 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface EventListResponse {
  events: EventCard[];
  total: number;
  page: number;
}

// ---- Organizer event studio (feature 006) ----
// Derived from src/specs/006-organizer-studio/contracts/studio.openapi.yaml. Defined once here and
// imported by both sides, so a server change that breaks the console fails at compile time
// (Principle VI). Money stays whole VND đồng throughout (STD-03).

/** A tier as its organizer sees it: the row plus the live inventory a refusal will cite (FR-009). */
export interface ManagedTier {
  id: number;
  label: string;
  price: number; // VND integer
  /** null for a seated tier — capacity comes from the seat map and is owned by feature 005 (FR-005). */
  capacity: number | null;
  sold: number;
  held: number;
  /** null when capacity is unbounded. Seated counts available showtime_seats. */
  remaining: number | null;
  archived: boolean;
  archivedAt: string | null;
}

/**
 * Every studio mutation reports whether it returned the event for review (FR-021), so the console can
 * say what just happened instead of leaving the organizer to notice their event vanished from the
 * catalog. Always false for a capacity-only change — the one exemption.
 */
export interface MutationModeration {
  returnedToReview: boolean;
}

export interface TierMutationResult extends MutationModeration {
  tier: ManagedTier;
}

/** Removal is delete-or-archive, decided by the server on live inventory (FR-006, FR-007). */
export interface TierRemovalResult extends MutationModeration {
  tier: ManagedTier | null; // null when the tier was deleted outright
  outcome: 'deleted' | 'archived';
}

export interface ManagedTierList {
  eventType: EventType;
  tiers: ManagedTier[];
}

export interface ShowtimeMutationResult extends MutationModeration {
  showtimeId: number;
  startsAt: string;
  venueId: number;
}

export type ModerationStatus = 'pending_review' | 'approved' | 'flagged' | 'removed';

export interface EventMutationResult extends MutationModeration {
  id: number;
  slug: string;
  title: string;
  status: string;
  moderation: ModerationStatus;
}

/** UC-22. Never authoritative and never persisted — only what the organizer accepts reaches the form. */
export interface ListingSuggestion {
  titles: string[];
  description: string | null;
  tags: string[];
  /** Computed in SQL from comparable published events, never produced by the model (FR-033). */
  price: number | null;
  /** How many comparable events the price came from; null when no price was suggested. */
  priceBasis: number | null;
}

export type ListingUnavailableReason = 'timeout' | 'error' | 'quota_exhausted';

/**
 * Degradation is a SUCCESSFUL response with `available: false`, never an error status, so the
 * client's fallback is the ordinary rendering path and no consumer can accidentally treat a degraded
 * assistant as a broken page (PERF-05, SCAL-03).
 */
export interface ListingResponse {
  available: boolean;
  cached?: boolean;
  suggestion?: ListingSuggestion;
  reason?: ListingUnavailableReason;
}
