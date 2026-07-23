// Maps the real catalog API onto the existing (cinema-shaped) MovieEvent the UI renders, so the
// browse + detail flows use real data while keeping the current components/design unchanged. Fields the
// catalog does not have yet (rating, cast, tags…) default to empty — they belong to later features
// (reviews, richer metadata). The MovieEvent `id` carries the event slug so detail can be fetched.

import type { EventCard, EventDetail, Showtime } from '@/shared/catalog/types';
import type { MovieEvent } from '../types';

const CATEGORY: Record<string, MovieEvent['category']> = {
  music: 'music',
  theatre: 'theatre',
  concert: 'concert',
};
const toCategory = (code: string): MovieEvent['category'] => CATEGORY[code] ?? 'music';

const CITY = new Set(['TP.HCM', 'Hà Nội', 'Đà Nẵng']);
const toCity = (c: string | null): MovieEvent['city'] =>
  c && CITY.has(c) ? (c as MovieEvent['city']) : 'TP.HCM';

const AGE: Record<string, MovieEvent['ageRating']> = { all: 'P', '13+': 'T13', '16+': 'T16', '18+': 'T18' };

export function cardToMovie(c: EventCard): MovieEvent {
  return {
    id: c.slug,
    category: toCategory(c.category),
    title: c.title,
    tags: [],
    ageRating: 'P',
    ageDescription: '',
    duration: 0,
    genre: [],
    director: '',
    cast: [],
    releaseDate: c.earliestShowtime ?? '',
    rating: 0,
    reviewCount: 0,
    description: '',
    price: c.startingPrice ?? 0,
    doublePrice: 0,
    ticketTiers: [],
    imageUrl: c.imageUrl ?? '',
    trailerUrl: '',
    times: [],
    dates: c.earliestShowtime ? [c.earliestShowtime.slice(0, 10)] : [],
    city: toCity(c.city),
    location: '',
    venueName: '',
    venueMapUrl: '',
    venueGuide: '',
    refundPolicy: '',
    status: c.soldOut ? 'sold_out' : 'available',
    ticketsLeft: c.soldOut ? 0 : 50,
    isFeatured: false,
  };
}

export function detailToMovie(d: EventDetail, showtimes: Showtime[]): MovieEvent {
  const base = cardToMovie(d);
  const dates = [...new Set(showtimes.map((s) => s.startsAt.slice(0, 10)))];
  const times = [...new Set(showtimes.map((s) => s.startsAt.slice(11, 16)))];
  const venue = showtimes[0]?.venue;
  return {
    ...base,
    ageRating: AGE[d.ageRestriction] ?? 'P',
    genre: d.genre,
    cast: d.lineup,
    description: d.description,
    trailerUrl: d.trailerUrl ?? '',
    refundPolicy: d.refundPolicy ?? '',
    venueGuide: d.venueGuide ?? '',
    venueName: venue?.name ?? '',
    location: venue?.city ?? '',
    dates: dates.length ? dates : base.dates,
    times: times.length ? times : ['19:00'],
    ticketTiers: d.tiers.map((t) => ({
      id: String(t.id),
      label: t.label,
      price: t.price,
      description: '',
    })),
  };
}
