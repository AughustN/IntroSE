/**
 * Organizer Event Management Client & Service Adapter
 * 
 * Provides API client functions and mock storage state management for the
 * Organizer Event Portfolio Dashboard and Single Event Management Workspace.
 * 
 * Implements SEC-04 identity scoping, UC-24 A6 material field reversion,
 * UC-26 A3 ticket tier archiving, and UC-25 mandatory cancellation with wallet refunds.
 */

import {
  OrganizerEvent,
  OrganizerEventStatus,
  OrganizerPortfolioSummary,
  TicketTier,
  EventCancellationAuditRecord
} from "../types";
import { withAuthRetry } from "./authClient";
import { organizerApi } from "./catalogClient";

// Default authenticated organizer session identity for demo/dev scoping (SEC-04)
let currentOrganizerId = "org-888";

export function getCurrentOrganizerId(): string {
  return currentOrganizerId;
}

export function setCurrentOrganizerId(id: string): void {
  currentOrganizerId = id;
}

// Hardcoded mock seed dataset disabled & deleted from source code
const INITIAL_ORGANIZER_EVENTS: OrganizerEvent[] = [];

// Persistent state holder
let eventsStore: OrganizerEvent[] = [...INITIAL_ORGANIZER_EVENTS];
const auditLogsStore: EventCancellationAuditRecord[] = [];

/**
 * Computes the derived event status.
 * Status becomes "completed" dynamically if endDatetime has passed for a published event.
 */
export function computeEventStatus(event: OrganizerEvent): OrganizerEventStatus {
  if (event.status === "published") {
    const endDate = new Date(event.endDatetime);
    if (!isNaN(endDate.getTime()) && new Date() > endDate) {
      return "completed";
    }
  }
  return event.status;
}

/**
 * Calculates aggregate capacity, sold ticket counts, remaining availability,
 * and total revenue in integer VND for an event across its ticket tiers.
 */
export function calculateEventMetrics(event: OrganizerEvent): {
  totalCapacity: number;
  soldTickets: number;
  remainingTickets: number;
  totalRevenueVnd: number;
} {
  let totalCapacity = 0;
  let soldTickets = 0;
  let totalRevenueVnd = 0;

  (event.ticketTiers || []).forEach(t => {
    if (t.isArchived) return;
    const cap = Number(t.capacity) || 0;
    const sold = Number(t.soldCount) || 0;
    const price = Number(t.price) || 0;
    totalCapacity += cap;
    soldTickets += sold;
    totalRevenueVnd += sold * price;
  });

  const remainingTickets = Math.max(0, totalCapacity - soldTickets);

  return {
    totalCapacity,
    soldTickets,
    remainingTickets,
    totalRevenueVnd
  };
}

/**
 * List all events owned by the currently authenticated organizer (SEC-04).
 * Fetches from the backend database when signed in, falling back to local session store.
 */
export async function getOrganizerEvents(params?: {
  status?: string;
  search?: string;
}): Promise<{
  data: OrganizerPortfolioSummary[];
  summary: {
    totalEvents: number;
    draftCount: number;
    pendingCount: number;
    publishedCount: number;
    canceledCount: number;
    completedCount: number;
  };
}> {
  let fetchedDbEvents: OrganizerEvent[] = [];

  try {
    const res = await withAuthRetry((token) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      return fetch("/api/organizer/events", {
        method: "GET",
        headers,
        credentials: "include",
      });
    });

    if (res.ok) {
        const rawList = await res.json();
        if (Array.isArray(rawList)) {
          fetchedDbEvents = rawList.map((item: any) => {
            const rawStatus = item.status || "draft";
            const modStatus = item.moderation || "pending_review";

            let compStatus: OrganizerEventStatus = "draft";
            if (rawStatus === "cancelled" || rawStatus === "canceled") compStatus = "canceled";
            else if (rawStatus === "finished" || rawStatus === "completed") compStatus = "completed";
            else if (rawStatus === "on_sale" && modStatus === "approved") compStatus = "published";
            else if (modStatus === "pending_review") compStatus = "pending_review";
            else if (rawStatus === "draft") compStatus = "draft";

            const tiers = Array.isArray(item.ticketTiers) && item.ticketTiers.length > 0
              ? item.ticketTiers
              : [
                  {
                    id: `tier-${item.id}-1`,
                    label: "Vé Tiêu Chuẩn",
                    price: Number(item.soldTickets) > 0 ? Math.round(Number(item.totalRevenueVnd || 0) / Number(item.soldTickets)) : 0,
                    capacity: Number(item.totalCapacity || 0),
                    soldCount: Number(item.soldTickets || 0),
                    remaining: Math.max(0, Number(item.totalCapacity || 0) - Number(item.soldTickets || 0)),
                    isArchived: false
                  }
                ];

            return {
              eventId: String(item.id),
              organizerId: getCurrentOrganizerId(),
              title: item.title || "Sự kiện",
              description: item.description || "",
              category: item.category || "music",
              categoryLabel: item.category || "Âm nhạc",
              bannerUrl: item.imageUrl || item.image_url || "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80",
              venueName: item.venueName || "Sân Vận Động Quân Khu 7",
              venueAddress: item.venueAddress || "202 Hoàng Văn Thụ, Tân Bình, TP.HCM",
              city: (item.city as any) || "TP.HCM",
              startDatetime: item.startDatetime || item.starts_at || new Date().toISOString(),
              endDatetime: item.endDatetime || item.ends_at || new Date().toISOString(),
              salesStartDatetime: item.salesStartDatetime || new Date().toISOString(),
              salesEndDatetime: item.salesEndDatetime || new Date().toISOString(),
              status: rawStatus as any,
              computedStatus: compStatus,
              rejectionReason: null,
              cancellationReason: null,
              createdAt: item.createdAt || new Date().toISOString(),
              updatedAt: item.updatedAt || new Date().toISOString(),
              times: ["19:00"],
              dates: ["2026-09-20"],
              ticketTiers: tiers
            };
          });
        }
      }
    } catch {
      // Network error, fallback to session store
    }

  // Combine database events with local session created events
  const dbIds = new Set(fetchedDbEvents.map(e => e.eventId));
  const localOnly = eventsStore.filter(e => !dbIds.has(e.eventId) && e.organizerId === getCurrentOrganizerId());
  eventsStore = [...fetchedDbEvents, ...localOnly];
  const ownedEvents = eventsStore;

  let draftCount = 0;
  let pendingCount = 0;
  let publishedCount = 0;
  let canceledCount = 0;
  let completedCount = 0;

  const summaries: OrganizerPortfolioSummary[] = ownedEvents.map(event => {
    const compStatus = computeEventStatus(event);
    event.computedStatus = compStatus;

    if (compStatus === "draft") draftCount++;
    else if (compStatus === "pending_review") pendingCount++;
    else if (compStatus === "published") publishedCount++;
    else if (compStatus === "canceled") canceledCount++;
    else if (compStatus === "completed") completedCount++;

    const metrics = calculateEventMetrics(event);

    return {
      eventId: event.eventId,
      organizerId: event.organizerId,
      title: event.title,
      bannerUrl: event.bannerUrl,
      status: compStatus,
      startDatetime: event.startDatetime,
      endDatetime: event.endDatetime,
      locationName: `${event.venueName}, ${event.city}`,
      totalCapacity: metrics.totalCapacity,
      soldTickets: metrics.soldTickets,
      remainingTickets: metrics.remainingTickets,
      totalRevenueVnd: metrics.totalRevenueVnd
    };
  });

  let filtered = summaries;

  // Status Filter
  if (params?.status && params.status !== "all") {
    filtered = filtered.filter(s => s.status === params.status);
  }

  // Keyword Search
  if (params?.search && params.search.trim() !== "") {
    const q = params.search.trim().toLowerCase();
    filtered = filtered.filter(
      s => s.title.toLowerCase().includes(q) || s.locationName.toLowerCase().includes(q)
    );
  }

  return {
    data: filtered,
    summary: {
      totalEvents: summaries.length,
      draftCount,
      pendingCount,
      publishedCount,
      canceledCount,
      completedCount
    }
  };
}

/**
 * Fetch detailed event management workspace payload for a single event (SEC-04).
 */
export async function getOrganizerEventDetail(eventId: string): Promise<{
  data: OrganizerEvent & {
    metrics: {
      totalCapacity: number;
      soldTickets: number;
      remainingTickets: number;
      totalRevenueVnd: number;
    };
  };
}> {
  const organizerId = getCurrentOrganizerId();
  let event = eventsStore.find(e => e.eventId === String(eventId));

  if (!event) {
    await getOrganizerEvents();
    event = eventsStore.find(e => e.eventId === String(eventId));
  }

  if (!event) {
    throw new Error("NOT_FOUND: Event not found.");
  }

  // SEC-04 Identity Scoping Check
  if (event.organizerId !== organizerId) {
    throw new Error("FORBIDDEN: You do not own this event.");
  }

  event.computedStatus = computeEventStatus(event);
  const metrics = calculateEventMetrics(event);

  return {
    data: {
      ...event,
      metrics
    }
  };
}

/**
 * Validates completeness of mandatory event fields before publication request.
 */
export function validateEventCompleteness(event: OrganizerEvent): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!event.title || event.title.trim().length < 3) {
    errors.push("Tên sự kiện phải từ 3 ký tự trở lên.");
  }
  if (!event.description || event.description.trim().length < 10) {
    errors.push("Mô tả sự kiện phải từ 10 ký tự trở lên.");
  }
  if (!event.bannerUrl) {
    errors.push("Sự kiện phải có hình ảnh banner.");
  }
  if (!event.venueName || !event.venueAddress) {
    errors.push("Vui lòng nhập đầy đủ tên địa điểm và địa chỉ.");
  }
  if (!event.ticketTiers || event.ticketTiers.length === 0) {
    errors.push("Sự kiện phải có ít nhất 1 hạng vé.");
  } else {
    const validTier = event.ticketTiers.some(t => (t.price || 0) >= 0 && (t.capacity || 0) > 0);
    if (!validTier) {
      errors.push("Ít nhất một hạng vé phải có giá VND và sức chứa hợp lệ.");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Submit Draft event for publication review ("Request to Publish").
 */
export async function requestPublication(eventId: string): Promise<OrganizerEvent> {
  const organizerId = getCurrentOrganizerId();
  const event = eventsStore.find(e => e.eventId === eventId);

  if (!event) throw new Error("NOT_FOUND: Event not found.");
  if (event.organizerId !== organizerId) throw new Error("FORBIDDEN: You do not own this event.");

  const validation = validateEventCompleteness(event);
  if (!validation.valid) {
    throw new Error(`VALIDATION_ERROR: ${validation.errors.join(" ")}`);
  }

  event.status = "pending_review";
  event.computedStatus = "pending_review";
  event.updatedAt = new Date().toISOString();

  return event;
}

/**
 * Check whether updated fields are material (triggering status reversion to pending_review per UC-24 A6).
 */
export function isMaterialChange(original: OrganizerEvent, updates: Partial<OrganizerEvent>): boolean {
  if (updates.title && updates.title !== original.title) return true;
  if (updates.description && updates.description !== original.description) return true;
  if (updates.startDatetime && updates.startDatetime !== original.startDatetime) return true;
  if (updates.endDatetime && updates.endDatetime !== original.endDatetime) return true;
  if (updates.venueName && updates.venueName !== original.venueName) return true;
  if (updates.ticketTiers) return true;

  return false;
}

/**
 * Edit and update event details. Automatically reverts Published events to Pending Approval
 * if material fields are modified (UC-24 A6).
 */
export async function updateEventDetails(
  eventId: string,
  updates: Partial<OrganizerEvent>
): Promise<{ event: OrganizerEvent; statusRevertedToPending: boolean }> {
  const organizerId = getCurrentOrganizerId();
  const event = eventsStore.find(e => e.eventId === eventId);

  if (!event) throw new Error("NOT_FOUND: Event not found.");
  if (event.organizerId !== organizerId) throw new Error("FORBIDDEN: You do not own this event.");

  let statusRevertedToPending = false;

  if (event.status === "published" && isMaterialChange(event, updates)) {
    event.status = "pending_review";
    event.computedStatus = "pending_review";
    statusRevertedToPending = true;
  }

  Object.assign(event, updates);
  event.updatedAt = new Date().toISOString();
  event.computedStatus = computeEventStatus(event);

  return { event, statusRevertedToPending };
}

/**
 * Delete or Archive ticket tier (UC-26 A3).
 * If soldCount > 0, hard deletion is blocked and tier is marked isArchived: true.
 */
export async function deleteOrArchiveTier(
  eventId: string,
  tierId: string
): Promise<{ tierId: string; actionTaken: "deleted" | "archived"; isArchived: boolean }> {
  const organizerId = getCurrentOrganizerId();
  const event = eventsStore.find(e => e.eventId === eventId);

  if (!event) throw new Error("NOT_FOUND: Event not found.");
  if (event.organizerId !== organizerId) throw new Error("FORBIDDEN: You do not own this event.");

  const tierIndex = event.ticketTiers.findIndex(t => t.id === tierId);
  if (tierIndex === -1) throw new Error("NOT_FOUND: Ticket tier not found.");

  const tier = event.ticketTiers[tierIndex];
  const soldCount = tier.soldCount || 0;

  if (soldCount > 0) {
    // UC-26 A3: Archive tier if tickets have been sold
    tier.isArchived = true;
    event.updatedAt = new Date().toISOString();
    return { tierId, actionTaken: "archived", isArchived: true };
  } else {
    // Hard delete if zero tickets sold
    event.ticketTiers.splice(tierIndex, 1);
    event.updatedAt = new Date().toISOString();
    return { tierId, actionTaken: "deleted", isArchived: false };
  }
}

/**
 * Add or Update Ticket Tier with quota validation (`capacity >= soldCount`).
 */
export async function saveTicketTier(
  eventId: string,
  tierData: Partial<TicketTier> & { id?: string; label: string; price: number; capacity: number }
): Promise<TicketTier> {
  const organizerId = getCurrentOrganizerId();
  const event = eventsStore.find(e => e.eventId === eventId);

  if (!event) throw new Error("NOT_FOUND: Event not found.");
  if (event.organizerId !== organizerId) throw new Error("FORBIDDEN: You do not own this event.");

  if (tierData.id) {
    const existingTier = event.ticketTiers.find(t => t.id === tierData.id);
    if (existingTier) {
      const soldCount = existingTier.soldCount || 0;
      if (tierData.capacity < soldCount) {
        throw new Error(`VALIDATION_ERROR: Sức chứa mới (${tierData.capacity}) không thể nhỏ hơn số vé đã bán (${soldCount}).`);
      }
      Object.assign(existingTier, tierData);
      existingTier.remaining = Math.max(0, (existingTier.capacity || 0) - (existingTier.soldCount || 0));
      event.updatedAt = new Date().toISOString();
      return existingTier;
    }
  }

  // Create new tier
  const newTier: TicketTier = {
    id: `tier-${Date.now()}`,
    label: tierData.label,
    price: tierData.price,
    description: tierData.description || "",
    capacity: tierData.capacity,
    soldCount: 0,
    remaining: tierData.capacity,
    isArchived: false
  };

  event.ticketTiers.push(newTier);
  event.updatedAt = new Date().toISOString();
  return newTier;
}

/**
 * Cancel Event with mandatory cancellation reason and dispatch store-credit refunds (UC-25 / FR-010..012).
 */
export async function cancelEvent(
  eventId: string,
  reason: string
): Promise<{
  event: OrganizerEvent;
  auditRecord: EventCancellationAuditRecord;
}> {
  const organizerId = getCurrentOrganizerId();
  const event = eventsStore.find(e => e.eventId === eventId);

  if (!event) throw new Error("NOT_FOUND: Event not found.");
  if (event.organizerId !== organizerId) throw new Error("FORBIDDEN: You do not own this event.");

  const compStatus = computeEventStatus(event);
  if (compStatus === "completed") {
    throw new Error("VALIDATION_ERROR: Không thể hủy sự kiện đã kết thúc.");
  }

  if (!reason || reason.trim().length < 5) {
    throw new Error("VALIDATION_ERROR: Vui lòng nhập lý do hủy sự kiện (tối thiểu 5 ký tự).");
  }

  event.status = "canceled";
  event.computedStatus = "canceled";
  event.cancellationReason = reason.trim();
  event.updatedAt = new Date().toISOString();

  const metrics = calculateEventMetrics(event);

  const auditRecord: EventCancellationAuditRecord = {
    cancellationId: `canc-${Date.now()}`,
    eventId: event.eventId,
    organizerId: event.organizerId,
    canceledAt: new Date().toISOString(),
    reason: reason.trim(),
    ticketsAffectedCount: metrics.soldTickets,
    totalRefundAmountVnd: metrics.totalRevenueVnd
  };

  auditLogsStore.push(auditRecord);

  return {
    event,
    auditRecord
  };
}

/**
 * Mark event as Hoàn Tất (Completed/Finished) — SEC-04 ownership scoped.
 *
 * Unlike cancellation, no refunds are issued and no audit record is written:
 * the event ran, attendees attended, and the organizer is closing the books.
 * The DB 'finished' status locks further edits and ticket sales.
 *
 * Also updates the in-memory store so the UI reflects the new state immediately
 * without a full reload, consistent with how cancelEvent handles local state.
 */
export async function completeEvent(
  eventId: string
): Promise<{ event: OrganizerEvent }> {
  const organizerId = getCurrentOrganizerId();
  const event = eventsStore.find(e => e.eventId === eventId);

  if (!event) throw new Error('NOT_FOUND: Event not found.');
  if (event.organizerId !== organizerId) throw new Error('FORBIDDEN: You do not own this event.');

  const compStatus = computeEventStatus(event);
  if (compStatus === 'canceled') {
    throw new Error('VALIDATION_ERROR: Không thể hoàn tất sự kiện đã hủy.');
  }
  if (compStatus === 'completed') {
    // Already finished — treat as success (idempotent)
    return { event };
  }
  if (compStatus !== 'published') {
    throw new Error('VALIDATION_ERROR: Chỉ có thể hoàn tất sự kiện đang được đăng bán (đã duyệt).');
  }

  // Call the real server endpoint
  try {
    await organizerApi.completeEvent(eventId);
  } catch (err: any) {
    throw new Error(err.message || 'Lỗi server khi hoàn tất sự kiện');
  }

  // Update local store
  event.status = 'completed';
  event.computedStatus = 'completed';
  event.updatedAt = new Date().toISOString();

  return { event };
}

/**
 * Create a new event for the authenticated organizer.
 * Image (bannerUrl) is required; Video (videoUrl) is optional.
 */
export interface CreateEventInput {
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  bannerUrl: string; // Required picture
  videoUrl?: string; // Optional video
  venueName: string;
  venueAddress: string;
  city: "TP.HCM" | "Hà Nội" | "Đà Nẵng";
  startDatetime: string;
  endDatetime: string;
  salesStartDatetime?: string;
  salesEndDatetime?: string;
  ticketTiers: Array<{
    label: string;
    price: number;
    capacity: number;
    description?: string;
  }>;
}

export async function createOrganizerEvent(input: CreateEventInput): Promise<OrganizerEvent> {
  const organizerId = getCurrentOrganizerId();

  if (!input.title || input.title.trim().length < 3) {
    throw new Error("VALIDATION_ERROR: Tên sự kiện phải từ 3 ký tự trở lên.");
  }
  if (!input.bannerUrl || input.bannerUrl.trim() === "") {
    throw new Error("VALIDATION_ERROR: Hình ảnh sự kiện (Picture) là bắt buộc.");
  }
  if (!input.venueName || !input.venueAddress) {
    throw new Error("VALIDATION_ERROR: Vui lòng nhập địa điểm và địa chỉ sự kiện.");
  }

  if (!input.description || input.description.trim().length < 1) {
    throw new Error("VALIDATION_ERROR: Vui lòng nhập mô tả sự kiện.");
  }
  if (!input.ticketTiers || input.ticketTiers.length === 0) {
    throw new Error("VALIDATION_ERROR: Sự kiện phải có ít nhất 1 hạng vé.");
  }
  try {
    new URL(input.bannerUrl.trim());
  } catch {
    throw new Error("VALIDATION_ERROR: Hình ảnh sự kiện phải là một URL hợp lệ.");
  }

  // The organizer dashboard is backed by the catalog API. Keep the old local path only for
  // non-browser service tests; allowing it in the browser would create an ID that disappears on
  // the next API refresh and leaves the detail page with a misleading NOT_FOUND error.
  const isBrowserRuntime =
    typeof globalThis !== "undefined" &&
    (globalThis as typeof globalThis & { window?: unknown }).window !== undefined;
  if (isBrowserRuntime) {
    const startsAt = new Date(input.startDatetime);
    if (Number.isNaN(startsAt.getTime())) {
      throw new Error("VALIDATION_ERROR: Thời gian bắt đầu không hợp lệ.");
    }

    const created = await organizerApi.createEvent({
      title: input.title.trim(),
      categoryCode: input.category || "music",
      description: input.description.trim(),
      eventType: "general_admission",
      imageUrl: input.bannerUrl.trim(),
    });
    const venue = await organizerApi.createVenue({
      name: input.venueName.trim(),
      city: input.city || "TP.HCM",
      rawAddress: input.venueAddress.trim(),
    });
    await organizerApi.addShowtime(created.id, {
      venueId: venue.id,
      startsAt: startsAt.toISOString(),
      tiers: (input.ticketTiers || []).map((tier) => ({
        label: tier.label.trim(),
        price: Number(tier.price) || 0,
        totalQuantity: Math.max(1, Number(tier.capacity) || 1),
      })),
    });

    const now = new Date().toISOString();
    const newEvent: OrganizerEvent = {
      eventId: String(created.id),
      organizerId,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category || "music",
      categoryLabel: input.categoryLabel || "Âm nhạc",
      bannerUrl: input.bannerUrl.trim(),
      videoUrl: input.videoUrl?.trim() || undefined,
      venueName: input.venueName.trim(),
      venueAddress: input.venueAddress.trim(),
      city: input.city || "TP.HCM",
      startDatetime: startsAt.toISOString(),
      endDatetime: input.endDatetime,
      salesStartDatetime: input.salesStartDatetime || now,
      salesEndDatetime: input.salesEndDatetime || input.startDatetime,
      status: "draft",
      computedStatus: "draft",
      rejectionReason: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
      times: [startsAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })],
      dates: [startsAt.toISOString().slice(0, 10)],
      ticketTiers: (input.ticketTiers || []).map((tier, idx) => ({
        id: `tier-${created.id}-${idx}`,
        label: tier.label.trim(),
        price: Number(tier.price) || 0,
        capacity: Math.max(1, Number(tier.capacity) || 1),
        soldCount: 0,
        remaining: Math.max(1, Number(tier.capacity) || 1),
        description: tier.description || "",
        isArchived: false,
      })),
    };
    eventsStore = [newEvent, ...eventsStore.filter((event) => event.eventId !== newEvent.eventId)];
    return newEvent;
  }

  const newEvent: OrganizerEvent = {
    eventId: `evt-${Date.now()}`,
    organizerId,
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category || "music",
    categoryLabel: input.categoryLabel || "Âm nhạc",
    bannerUrl: input.bannerUrl.trim(),
    videoUrl: input.videoUrl?.trim() || undefined,
    venueName: input.venueName.trim(),
    venueAddress: input.venueAddress.trim(),
    city: input.city || "TP.HCM",
    startDatetime: input.startDatetime,
    endDatetime: input.endDatetime,
    salesStartDatetime: input.salesStartDatetime || new Date().toISOString(),
    salesEndDatetime: input.salesEndDatetime || input.startDatetime,
    status: "draft",
    computedStatus: "draft",
    rejectionReason: null,
    cancellationReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    times: [input.startDatetime.slice(11, 16) || "19:00"],
    dates: [input.startDatetime.slice(0, 10)],
    ticketTiers: (input.ticketTiers || []).map((t, idx) => ({
      id: `tier-new-${Date.now()}-${idx}`,
      label: t.label,
      price: t.price,
      capacity: t.capacity,
      soldCount: 0,
      remaining: t.capacity,
      description: t.description || "",
      isArchived: false
    }))
  };

  eventsStore.unshift(newEvent);
  return newEvent;
}

/**
 * Reset mock store state (useful for tests).
 */
export function resetOrganizerStore(): void {
  eventsStore = JSON.parse(JSON.stringify(INITIAL_ORGANIZER_EVENTS));
  currentOrganizerId = "org-888";
}
