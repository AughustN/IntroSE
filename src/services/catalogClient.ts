// Public catalog data layer (no auth) + authed organizer/admin calls. Same-origin; /api proxied in dev.
import type { EventDetail, EventListResponse, SeatMap, Showtime } from "@/shared/catalog/types";
import type {
  ApplyPreview,
  Layout,
  LayoutTable,
  LayoutFloorPlan,
  LayoutSummary,
  SaveLayoutRequest,
  ValidateResponse,
} from "@/shared/catalog/seatmap";
import type {
  ListingResponse,
  ManagedTierList,
  TierMutationResult,
  TierRemovalResult,
  ShowtimeMutationResult,
  EventMutationResult,
} from "@/shared/catalog/types";
import { withAuthRetry } from "./authClient";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return (await res.json()) as T;
}

async function authed<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Refresh once on a 401 (same reason as holdsClient): an organizer or admin panel left open past
  // the access token's lifetime must not report itself as signed out.
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
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
  /** How many bookable seats this showtime actually has — 0 until the layout is applied. */
  bookableSeats: number;
  tiers: {
    id: number;
    label: string;
    price: number;
    capacity: number | null;
    sold: number;
    held: number;
    archived: boolean;
  }[];
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

  // Tables (feature 005 amendment). Placing one generates its seats server-side, where the sold/held
  // guards can see them; moving, re-counting or deleting is refused whole if any seat is committed.
  addTable: (layoutId: number, body: Record<string, unknown>) =>
    authed<LayoutTable>(`/organizer/layouts/${layoutId}/tables`, { method: 'POST', body }),
  updateTable: (tableId: number, body: Record<string, unknown>) =>
    authed<LayoutTable>(`/organizer/tables/${tableId}`, { method: 'PATCH', body }),
  deleteTable: (tableId: number) => authed<{ ok: true }>(`/organizer/tables/${tableId}`, { method: 'DELETE' }),

  // Standing area (FR-080) — the fan-zone substitute. Positions are generated server-side inside the
  // drawn shape, as ordinary seats of type `standing`; a shape too small to hold the count is refused
  // rather than quietly generating fewer.
  addStandingArea: (layoutId: number, body: Record<string, unknown>) =>
    authed<{ created: number; layout: Layout }>(`/organizer/layouts/${layoutId}/standing-area`, {
      method: 'POST',
      body,
    }),

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

// ---- Organizer event studio (feature 006) ----
// Derived from src/specs/006-organizer-studio/contracts/studio.openapi.yaml. Shapes come from the
// shared contract, so a server change that breaks this fails at compile time (Principle VI).
export const studioApi = {
  // Tiers (UC-26). `remove` is delete-or-archive — the server decides on live inventory and reports
  // which happened, so the console can word it correctly.
  tiers: (showtimeId: number) =>
    authed<ManagedTierList>(`/organizer/showtimes/${showtimeId}/tiers`),
  addTier: (showtimeId: number, b: { label: string; price: number; capacity?: number | null }) =>
    authed<TierMutationResult>(`/organizer/showtimes/${showtimeId}/tiers`, {
      method: "POST",
      body: b,
    }),
  updateTier: (tierId: number, b: { label?: string; price?: number; capacity?: number }) =>
    authed<TierMutationResult>(`/organizer/tiers/${tierId}`, { method: "PATCH", body: b }),
  removeTier: (tierId: number) =>
    authed<TierRemovalResult>(`/organizer/tiers/${tierId}`, { method: "DELETE" }),
  restoreTier: (tierId: number) =>
    authed<TierMutationResult>(`/organizer/tiers/${tierId}/restore`, { method: "POST" }),

  // Showtimes (UC-23). Each refusal names what blocked it; render the message as-is.
  updateShowtime: (showtimeId: number, b: { startsAt?: string; venueId?: number }) =>
    authed<ShowtimeMutationResult>(`/organizer/showtimes/${showtimeId}`, {
      method: "PATCH",
      body: b,
    }),
  deleteShowtime: (showtimeId: number) =>
    authed<ShowtimeMutationResult>(`/organizer/showtimes/${showtimeId}`, { method: "DELETE" }),

  // Events. Deletion is permitted only for one never approved, with no inventory, not under an
  // admin's hand (FR-020).
  updateEvent: (
    eventId: number,
    b: {
      title?: string;
      description?: string;
      imageUrl?: string | null;
      refundPolicy?: string | null;
      ageRestriction?: string;
      categoryCode?: string;
    },
  ) => authed<EventMutationResult>(`/organizer/events/${eventId}`, { method: "PATCH", body: b }),
  deleteEvent: (eventId: number) =>
    authed<void>(`/organizer/events/${eventId}`, { method: "DELETE" }),
};

/**
 * UC-22. `available: false` is a NORMAL response, not a failure — the assistant degrades to manual
 * entry on timeout, error or quota, and the UI must never render that as an error (Principle III).
 * Only the per-user rate limit (429) throws, because that is the one case the organizer can act on.
 */
export const aiApi = {
  listing: (b: {
    eventId?: number;
    topic: string;
    keywords?: string[];
    categoryCode?: string;
    city?: string;
  }) => authed<ListingResponse>("/organizer/ai/listing", { method: "POST", body: b }),
};
