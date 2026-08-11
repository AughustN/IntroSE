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
  /**
   * The category's Vietnamese name, from the database.
   *
   * Sent with the card so the browser can build its filter list from the events it actually holds.
   * The alternative — a hardcoded list in the UI — is what broke: the catalogue grew past a dozen
   * categories while the frontend still knew three, and everything it did not recognise was silently
   * relabelled as one of them.
   */
  categoryLabel: string;
  city: string | null; // derived from showtime venues
  earliestShowtime: string | null; // ISO date-time
  startingPrice: number | null; // VND integer
  soldOut: boolean; // derived — all upcoming showtimes sold out (D-A)
  // Derived — the event still has a showtime ahead of it. False means every showtime is in the past,
  // which is a different thing from selling out and has to read differently on the card: `soldOut`
  // is only ever true while `hasUpcoming` is, so without this field a finished event arrives looking
  // identical to a bookable one.
  hasUpcoming: boolean;
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
  /**
   * The event's mean star rating, or **null when nobody has rated it** — an unrated event is not a
   * zero-star event, and collapsing the two would libel every new listing.
   */
  rating: number | null;
  reviewCount: number;
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
}

/** Non-sellable decoration (feature 005). Never inventory: it cannot be held, sold, or priced (FR-017). */
export interface SeatMapElement {
  kind: 'stage' | 'aisle' | 'door' | 'bar' | 'label' | 'area';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Rendered as literal text, never as markup (FR-018). */
  label: string | null;
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
}

export interface EventListResponse {
  events: EventCard[];
  total: number;
  page: number;
}
