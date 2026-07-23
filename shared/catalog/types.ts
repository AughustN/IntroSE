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
  row: string;
  number: number;
  tier: string;
  price: number;
  status: SeatStatus;
}

export interface SeatMap {
  eventType: EventType;
  seats?: SeatMapSeat[]; // seated
  tiers?: Tier[]; // general admission
}

export interface EventListResponse {
  events: EventCard[];
  total: number;
  page: number;
}
