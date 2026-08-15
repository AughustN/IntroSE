// Public catalog data layer plus authed organizer/admin calls.
import type { ChartDocument } from "@/shared/catalog/seatmap-document";
import type {
  EventCard,
  EventDetail,
  EventListResponse,
  SeatMap,
  Showtime,
} from "@/shared/catalog/types";
import type {
  ApplyPreview,
  Layout,
  LayoutTable,
  LayoutFloorPlan,
  LayoutReferenceChart,
  LayoutLibraryEntry,
  LayoutRevision,
  LayoutSummary,
  SaveLayoutRequest,
  ShowtimeMap,
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
  /** How many bookable seats this showtime actually has — 0 until the layout is applied. */
  bookableSeats: number;
  tiers: {
    id: number;
    label: string;
    price: number;
    capacity: number | null;
    sold: number;
    held: number;
    /** Which chart class this tier prices. Null until the organizer binds it. */
    categoryId: number | null;
    archived: boolean;
  }[];
  sections: Section[];
  /** The chart this showtime binds to: the one it generated from, else the venue's default. */
  layoutId: number | null;
  layoutStatus: "draft" | "ready" | "archived" | null;
  /** That chart's price classes — what a tier is bound TO. */
  categories: { id: number; name: string; color: string; seatCount: number }[];
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
  /** Bind a published chart to a showtime. Which class costs what is already recorded on the tiers,
   *  so all this call names is the chart. */
  generateSeatMap: (showtimeId: number, layoutId: number) =>
    authed<{ seats: number }>(`/organizer/showtimes/${showtimeId}/seat-map`, {
      method: "POST",
      body: { layoutId },
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

  // The library: every chart across every venue, with the usage count that decides whether archiving
  // and deleting are offered at all.
  library: () => authed<{ layouts: LayoutLibraryEntry[] }>(`/organizer/layouts`),
  archive: (id: number) => authed<Layout>(`/organizer/layouts/${id}/archive`, { method: "POST" }),

  // History. A revision is taken at publish, and restoring one goes back through the ordinary save
  // path on the server — so it inherits the refusal to delete a seat somebody has bought.
  revisions: (id: number) =>
    authed<{ revisions: LayoutRevision[] }>(`/organizer/layouts/${id}/revisions`),
  /** One revision's document, for showing what a restore would change before it happens (§31). */
  revisionDocument: (id: number, revisionId: number) =>
    authed<{ document: ChartDocument }>(`/organizer/layouts/${id}/revisions/${revisionId}`),
  restoreRevision: (id: number, revisionId: number) =>
    authed<Layout>(`/organizer/layouts/${id}/revisions/${revisionId}/restore`, { method: "POST" }),
  saveAsTemplate: (id: number, name: string) =>
    authed<Layout>(`/organizer/layouts/${id}/save-as-template`, { method: "POST", body: { name } }),
  restore: (id: number) => authed<Layout>(`/organizer/layouts/${id}/restore`, { method: "POST" }),
  rename: (id: number, name: string) =>
    authed<Layout>(`/organizer/layouts/${id}`, { method: "PATCH", body: { name } }),

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
  /** The tracing layer. Same upload pipeline as the plan; the server never lets it reach a buyer. */
  uploadReference: async (id: number, file: File): Promise<LayoutReferenceChart> => {
    const form = new FormData();
    form.append("file", file);
    const res = await withAuthRetry((token) =>
      fetch(`/api/organizer/layouts/${id}/reference`, {
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
    return (await res.json()) as LayoutReferenceChart;
  },
  alignReference: (id: number, b: Omit<LayoutReferenceChart, "url">) =>
    authed<LayoutReferenceChart>(`/organizer/layouts/${id}/reference`, { method: "PATCH", body: b }),
  removeReference: (id: number) =>
    authed<void>(`/organizer/layouts/${id}/reference`, { method: "DELETE" }),
  /** Re-shape a standing area and regenerate its positions. Refused whole if any is sold or held. */
  reshapeArea: (id: number, elementId: number, b: { points: { x: number; y: number }[]; capacity: number }) =>
    authed<{ created: number; layout: Layout }>(`/organizer/layouts/${id}/areas/${elementId}`, {
      method: "PATCH",
      body: b,
    }),
  removePlan: (id: number) =>
    authed<void>(`/organizer/layouts/${id}/floorplan`, { method: "DELETE" }),

  // Showtime map — the only inventory-aware calls (FR-027..FR-029, FR-033..FR-035).
  /** The owner's read. Not `catalogClient.getSeatMap`, which is gated on public visibility and so
   *  returns nothing for the draft events an organizer is most often arranging. */
  showtimeMap: (showtimeId: number) =>
    authed<ShowtimeMap>(`/organizer/showtimes/${showtimeId}/seat-map`),
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

/**
 * The catalogue's categories, fetched.
 *
 * This was a six-entry constant while the database held thirteen. Seven categories — `business`,
 * `other`, `technology`, `health`, `family`, `food`, `travel`, between them 287 events — could not
 * be chosen by anyone creating an event, and a category an Admin added through the console saved
 * successfully and then appeared nowhere. Categories are Admin-managed data (UC-35); a copy of them
 * compiled into the bundle can only ever be a stale second opinion.
 */
export interface EventCategory {
  id: number;
  code: string;
  labelVi: string;
  labelEn: string | null;
}

export interface CatalogQuery {
  q?: string;
  category?: string;
  city?: string;
  date?: string;
  minPrice?: number;
  maxPrice?: number;
  availability?: "available" | "all";
  page?: number;
  /** Cards per request. Server default 20, server ceiling 200. */
  pageSize?: number;
}

export const catalogClient = {
  listEvents(params: CatalogQuery = {}): Promise<EventListResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    return get<EventListResponse>(`/events${s ? `?${s}` : ""}`);
  },
  /**
   * The whole catalog, however many requests that takes.
   *
   * The browse page filters in the browser, so it cannot work from one page of results: a category
   * with nothing on the first page would look empty, and the price rule's far end is the dearest of
   * whatever survived the other filters — it has to see them all. `total` comes back with the first
   * response, so the remaining pages are known at once and fetched together rather than in a chain.
   */
  async listAllEvents(params: Omit<CatalogQuery, "page" | "pageSize"> = {}): Promise<EventCard[]> {
    const pageSize = 200;
    const first = await this.listEvents({ ...params, page: 1, pageSize });
    const pages = Math.ceil(first.total / pageSize);
    if (pages <= 1) return first.events;

    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        this.listEvents({ ...params, page: i + 2, pageSize }),
      ),
    );
    return [first.events, ...rest.map((r) => r.events)].flat();
  },
  listCategories(): Promise<EventCategory[]> {
    return get<EventCategory[]>("/categories");
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
  updateTier: (
    tierId: number,
    b: { label?: string; price?: number; capacity?: number; categoryId?: number | null },
  ) =>
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
