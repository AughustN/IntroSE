// Public catalog data layer (no auth) + authed organizer/admin calls. Same-origin; /api proxied in dev.
import type { EventDetail, EventListResponse, SeatMap, Showtime } from '@/shared/catalog/types';
import { withAuthRetry } from './authClient';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return (await res.json()) as T;
}

async function authed<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Refresh once on a 401 (same reason as holdsClient): an organizer or admin panel left open past
  // the access token's lifetime must not report itself as signed out.
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(e.message ?? e.error ?? `error ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface MyEvent {
  id: number;
  slug: string;
  title: string;
  status: string;
  moderation: string;
  reviewNote: string | null;
  imageUrl: string | null;
  eventType: 'general_admission' | 'seated';
  category: string;
}
export interface MyVenue {
  id: number;
  name: string;
  city: string;
  rawAddress: string;
  guide: string | null;
}
export interface QueueItem {
  id: number;
  slug: string;
  title: string;
  status: string;
  organizer: string;
}

export interface Section {
  id: number;
  name: string;
  seatCount: number;
}
export interface ManageShowtime {
  id: number;
  startsAt: string;
  venueId: number;
  venueName: string;
  hasSeatMap: boolean;
  tiers: { id: number; label: string; price: number }[];
  sections: Section[];
}

export const organizerApi = {
  myEvents: () => authed<MyEvent[]>('/organizer/events'),
  showtimesManage: (eventId: number) => authed<ManageShowtime[]>(`/organizer/events/${eventId}/showtimes-manage`),
  venueSections: (venueId: number) => authed<Section[]>(`/organizer/venues/${venueId}/sections`),
  createSection: (venueId: number, name: string) => authed<{ id: number }>(`/organizer/venues/${venueId}/sections`, { method: 'POST', body: { name } }),
  addSeats: (venueId: number, b: { sectionId: number; rowLabel: string; count: number }) =>
    authed<{ count: number }>(`/organizer/venues/${venueId}/seats`, { method: 'POST', body: b }),
  generateSeatMap: (showtimeId: number, sectionTiers: { sectionId: number; ticketTierId: number }[]) =>
    authed<{ seats: number }>(`/organizer/showtimes/${showtimeId}/seat-map`, { method: 'POST', body: { sectionTiers } }),
  createEvent: (b: { title: string; categoryCode: string; description: string; eventType: 'general_admission' | 'seated' }) =>
    authed<{ id: number; slug: string }>('/organizer/events', { method: 'POST', body: b }),
  publish: (id: number) => authed<{ ok: true }>(`/organizer/events/${id}/publish`, { method: 'POST' }),
  unpublish: (id: number) => authed<{ ok: true }>(`/organizer/events/${id}/unpublish`, { method: 'POST' }),
  myVenues: () => authed<MyVenue[]>('/organizer/venues'),
  createVenue: (b: { name: string; city: string; rawAddress: string; guide?: string }) =>
    authed<{ id: number }>('/organizer/venues', { method: 'POST', body: b }),
  addShowtime: (eventId: number, b: { venueId: number; startsAt: string; tiers: { label: string; price: number }[] }) =>
    authed<{ id: number }>(`/organizer/events/${eventId}/showtimes`, { method: 'POST', body: b }),
};

export const adminApi = {
  queue: () => authed<QueueItem[]>('/admin/moderation'),
  approve: (id: number) => authed<{ ok: true }>(`/admin/events/${id}/approve`, { method: 'POST' }),
  reject: (id: number, reason: string) => authed<{ ok: true }>(`/admin/events/${id}/reject`, { method: 'POST', body: { reason } }),
  flag: (id: number) => authed<{ ok: true }>(`/admin/events/${id}/flag`, { method: 'POST' }),
  remove: (id: number) => authed<{ ok: true }>(`/admin/events/${id}/remove`, { method: 'POST', body: {} }),
};

export const EVENT_CATEGORIES = [
  { code: 'music', label: 'Âm nhạc' },
  { code: 'workshop', label: 'Workshop' },
  { code: 'theatre', label: 'Sân khấu' },
  { code: 'community', label: 'Cộng đồng' },
  { code: 'sports', label: 'Thể thao' },
  { code: 'exhibition', label: 'Triển lãm' },
];

export interface CatalogQuery {
  q?: string;
  category?: string;
  city?: string;
  date?: string;
  minPrice?: number;
  maxPrice?: number;
  availability?: 'available' | 'all';
  page?: number;
}

export const catalogClient = {
  listEvents(params: CatalogQuery = {}): Promise<EventListResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return get<EventListResponse>(`/events${s ? `?${s}` : ''}`);
  },
  getEvent(slug: string): Promise<EventDetail> {
    return get<EventDetail>(`/events/${encodeURIComponent(slug)}`);
  },
  getShowtimes(eventId: number): Promise<Showtime[]> {
    return get<Showtime[]>(`/events/${eventId}/showtimes`);
  },
  getSeatMap(showtimeId: number): Promise<SeatMap> {
    return get<SeatMap>(`/showtimes/${showtimeId}/seat-map`);
  },
};
