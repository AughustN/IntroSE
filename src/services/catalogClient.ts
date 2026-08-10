// Public catalog data layer plus authed organizer/admin calls.
import type { EventDetail, EventListResponse, SeatMap, Showtime } from "@/shared/catalog/types";
import type {
  ApplyPreview,
  Layout,
  LayoutFloorPlan,
  LayoutSummary,
  SaveLayoutRequest,
  ValidateResponse,
} from "@/shared/catalog/seatmap";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(`/api${path}`), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const e = await readApiError(res);
    throw new Error(e.message ?? `catalog ${res.status}`);
  }
  return (await res.json()) as T;
}

async function authed<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Refresh once on a 401 (same reason as holdsClient): an organizer or admin panel left open past
  // the access token's lifetime must not report itself as signed out.
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl(`/api${path}`), {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  });
  if (!res.ok) {
    const e = await readApiError(res);
    throw new Error(e.message ?? e.code);
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
  eventType: "general_admission" | "seated";
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
  myEvents: () => authed<MyEvent[]>("/organizer/events"),
  showtimesManage: (eventId: number) =>
    authed<ManageShowtime[]>(`/organizer/events/${eventId}/showtimes-manage`),
  venueSections: (venueId: number) => authed<Section[]>(`/organizer/venues/${venueId}/sections`),
  createSection: (venueId: number, name: string) =>
    authed<{ id: number }>(`/organizer/venues/${venueId}/sections`, {
      method: "POST",
      body: { name },
    }),
  addSeats: (venueId: number, b: { sectionId: number; rowLabel: string; count: number }) =>
    authed<{ count: number }>(`/organizer/venues/${venueId}/seats`, { method: "POST", body: b }),
  generateSeatMap: (
    showtimeId: number,
    sectionTiers: { sectionId: number; ticketTierId: number }[],
  ) =>
    authed<{ seats: number }>(`/organizer/showtimes/${showtimeId}/seat-map`, {
      method: "POST",
      body: { sectionTiers },
    }),
  createEvent: (b: {
    title: string;
    categoryCode: string;
    description: string;
    eventType: "general_admission" | "seated";
  }) => authed<{ id: number; slug: string }>("/organizer/events", { method: "POST", body: b }),
  publish: (id: number) =>
    authed<{ ok: true }>(`/organizer/events/${id}/publish`, { method: "POST" }),
  unpublish: (id: number) =>
    authed<{ ok: true }>(`/organizer/events/${id}/unpublish`, { method: "POST" }),
  myVenues: () => authed<MyVenue[]>("/organizer/venues"),
  createVenue: (b: { name: string; city: string; rawAddress: string; guide?: string }) =>
    authed<{ id: number }>("/organizer/venues", { method: "POST", body: b }),
  addShowtime: (
    eventId: number,
    b: { venueId: number; startsAt: string; tiers: { label: string; price: number }[] },
  ) =>
    authed<{ id: number }>(`/organizer/events/${eventId}/showtimes`, { method: "POST", body: b }),
};

// ---- Seat map designer (feature 005) ----
// Derived from specs/005-seatmap-designer/contracts/seatmap.openapi.yaml. Layout shapes come from the
// shared contract, so a server change that breaks this fails at compile time (Principle VI).
export const layoutApi = {
  list: (venueId: number) =>
    authed<{ layouts: LayoutSummary[] }>(`/organizer/venues/${venueId}/layouts`),
  create: (venueId: number, name: string) =>
    authed<Layout>(`/organizer/venues/${venueId}/layouts`, { method: "POST", body: { name } }),
  get: (id: number) => authed<Layout>(`/organizer/layouts/${id}`),
  /** Full-document save. `version` must be the one you loaded — a stale value is refused (FR-015). */
  save: (id: number, body: SaveLayoutRequest) =>
    authed<Layout>(`/organizer/layouts/${id}`, { method: "PUT", body }),
  remove: (id: number) => authed<void>(`/organizer/layouts/${id}`, { method: "DELETE" }),
  generateSeats: (
    id: number,
    b: { sectionId: number; rowLabel: string; count: number; replaceExisting?: boolean },
  ) =>
    authed<{ created: number; layout: Layout }>(`/organizer/layouts/${id}/generate-seats`, {
      method: "POST",
      body: b,
    }),
  validate: (id: number) =>
    authed<ValidateResponse>(`/organizer/layouts/${id}/validate`, { method: "POST" }),
  publish: (id: number) => authed<Layout>(`/organizer/layouts/${id}/publish`, { method: "POST" }),
  clone: (id: number, b: { targetVenueId: number; name: string }) =>
    authed<Layout>(`/organizer/layouts/${id}/clone`, { method: "POST", body: b }),

  // Floor plan — a background layer only; it never moves a seat (FR-020, FR-024).
  uploadPlan: async (id: number, file: File): Promise<LayoutFloorPlan> => {
    const form = new FormData();
    form.append("file", file);
    const res = await withAuthRetry((token) =>
      fetch(`/api/organizer/layouts/${id}/floorplan`, {
        method: "POST",
        headers: token
          ? { Authorization: `Bearer ${token}`, Accept: "application/json" }
          : { Accept: "application/json" },
        credentials: "include",
        body: form,
      }),
    );
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(e.message ?? e.error ?? `error ${res.status}`);
    }
    return (await res.json()) as LayoutFloorPlan;
  },
  alignPlan: (id: number, b: Omit<LayoutFloorPlan, "url">) =>
    authed<LayoutFloorPlan>(`/organizer/layouts/${id}/floorplan`, { method: "PATCH", body: b }),
  removePlan: (id: number) =>
    authed<void>(`/organizer/layouts/${id}/floorplan`, { method: "DELETE" }),

  // Showtime map — the only inventory-aware calls (FR-027..FR-029, FR-033..FR-035).
  reapplyPreview: (showtimeId: number) =>
    authed<ApplyPreview>(`/organizer/showtimes/${showtimeId}/seat-map/reapply`, {
      method: "POST",
      body: { dryRun: true },
    }),
  reapply: (showtimeId: number) =>
    authed<ApplyPreview>(`/organizer/showtimes/${showtimeId}/seat-map/reapply`, {
      method: "POST",
      body: { dryRun: false },
    }),
  blockSeats: (showtimeId: number, showtimeSeatIds: number[], blocked: boolean) =>
    authed<{ changed: unknown[] }>(`/organizer/showtimes/${showtimeId}/seats/block`, {
      method: "POST",
      body: { showtimeSeatIds, blocked },
    }),
  assignTier: (showtimeId: number, showtimeSeatIds: number[], ticketTierId: number) =>
    authed<{ updated: number }>(`/organizer/showtimes/${showtimeId}/seats/tier`, {
      method: "POST",
      body: { showtimeSeatIds, ticketTierId },
    }),
};

export const adminApi = {
  queue: () => authed<QueueItem[]>("/admin/moderation"),
  approve: (id: number) => authed<{ ok: true }>(`/admin/events/${id}/approve`, { method: "POST" }),
  reject: (id: number, reason: string) =>
    authed<{ ok: true }>(`/admin/events/${id}/reject`, { method: "POST", body: { reason } }),
  flag: (id: number) => authed<{ ok: true }>(`/admin/events/${id}/flag`, { method: "POST" }),
  remove: (id: number) =>
    authed<{ ok: true }>(`/admin/events/${id}/remove`, { method: "POST", body: {} }),
};

export const EVENT_CATEGORIES = [
  { code: "music", label: "Âm nhạc" },
  { code: "workshop", label: "Workshop" },
  { code: "theatre", label: "Sân khấu" },
  { code: "community", label: "Cộng đồng" },
  { code: "sports", label: "Thể thao" },
  { code: "exhibition", label: "Triển lãm" },
];

export interface CatalogQuery {
  q?: string;
  category?: string;
  city?: string;
  date?: string;
  minPrice?: number;
  maxPrice?: number;
  availability?: "available" | "all";
  page?: number;
}

export const catalogClient = {
  listEvents(params: CatalogQuery = {}): Promise<EventListResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    return get<EventListResponse>(`/events${s ? `?${s}` : ""}`);
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
