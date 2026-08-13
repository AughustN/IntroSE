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

// Default authenticated organizer session identity for demo/dev scoping (SEC-04)
let currentOrganizerId = "org-888";

export function getCurrentOrganizerId(): string {
  return currentOrganizerId;
}

export function setCurrentOrganizerId(id: string): void {
  currentOrganizerId = id;
}

// Initial mock dataset for Organizer org-888
const INITIAL_ORGANIZER_EVENTS: OrganizerEvent[] = [
  {
    eventId: "evt-101",
    organizerId: "org-888",
    title: "Đêm Nhạc Trịnh Công Sơn: Hạ Trắng",
    description: "Đêm nhạc tưởng nhớ nhạc sĩ Trịnh Công Sơn với sự tham gia của nhiều nghệ sĩ nổi tiếng.",
    category: "music",
    categoryLabel: "Âm nhạc",
    bannerUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80",
    venueName: "Nhà hát Hòa Bình",
    venueAddress: "240 3 Tháng 2, Phường 12, Quận 10, TP.HCM",
    city: "TP.HCM",
    startDatetime: "2026-09-15T19:30:00Z",
    endDatetime: "2026-09-15T22:30:00Z",
    salesStartDatetime: "2026-08-01T00:00:00Z",
    salesEndDatetime: "2026-09-15T18:00:00Z",
    status: "published",
    computedStatus: "published",
    rejectionReason: null,
    cancellationReason: null,
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-08-01T12:00:00Z",
    times: ["19:30"],
    dates: ["2026-09-15"],
    ticketTiers: [
      {
        id: "tier-v1",
        label: "Vé VIP",
        price: 800000,
        description: "Hàng ghế A-C, tặng nước uống & quà",
        capacity: 100,
        soldCount: 100,
        remaining: 0,
        isArchived: false
      },
      {
        id: "tier-s1",
        label: "Vé Standard",
        price: 400000,
        description: "Hàng ghế D-M",
        capacity: 400,
        soldCount: 220,
        remaining: 180,
        isArchived: false
      }
    ]
  },
  {
    eventId: "evt-102",
    organizerId: "org-888",
    title: "Triển Lãm Nghệ Thuật Đương Đại: Sắc Màu Đô Thị",
    description: "Không gian trưng bày 50 tác phẩm hội họa và sắp đặt của các nghệ sĩ trẻ Việt Nam.",
    category: "art",
    categoryLabel: "Triển lãm",
    bannerUrl: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&w=1200&q=80",
    venueName: "Trung tâm Nghệ thuật Không gian Xanh",
    venueAddress: "15 Lê Thánh Tông, Quận 1, TP.HCM",
    city: "TP.HCM",
    startDatetime: "2026-08-20T09:00:00Z",
    endDatetime: "2026-08-25T18:00:00Z",
    salesStartDatetime: "2026-08-05T00:00:00Z",
    salesEndDatetime: "2026-08-25T17:00:00Z",
    status: "pending_review",
    computedStatus: "pending_review",
    rejectionReason: null,
    cancellationReason: null,
    createdAt: "2026-08-05T08:00:00Z",
    updatedAt: "2026-08-05T08:30:00Z",
    times: ["09:00", "14:00"],
    dates: ["2026-08-20", "2026-08-21", "2026-08-22"],
    ticketTiers: [
      {
        id: "tier-art-1",
        label: "Vé Phổ Thông",
        price: 150000,
        description: "Tham quan tự do triển lãm",
        capacity: 300,
        soldCount: 45,
        remaining: 255,
        isArchived: false
      }
    ]
  },
  {
    eventId: "evt-103",
    organizerId: "org-888",
    title: "Hội Thảo Công Nghệ TechTalk 2026: AI & Cloud Infrastructure",
    description: "Hội thảo chuyên sâu về hạ tầng đám mây và ứng dụng trí tuệ nhân tạo.",
    category: "conference",
    categoryLabel: "Hội thảo",
    bannerUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80",
    venueName: "Trung tâm Hội nghị Quốc gia",
    venueAddress: "Đại lộ Thăng Long, Mễ Trì, Nam Từ Liêm, Hà Nội",
    city: "Hà Nội",
    startDatetime: "2026-10-10T08:00:00Z",
    endDatetime: "2026-10-10T17:00:00Z",
    salesStartDatetime: "2026-08-10T00:00:00Z",
    salesEndDatetime: "2026-10-09T23:59:00Z",
    status: "draft",
    computedStatus: "draft",
    rejectionReason: null,
    cancellationReason: null,
    createdAt: "2026-08-10T14:00:00Z",
    updatedAt: "2026-08-10T14:00:00Z",
    times: ["08:00"],
    dates: ["2026-10-10"],
    ticketTiers: [
      {
        id: "tier-tech-1",
        label: "Vé Tham Dự",
        price: 250000,
        description: "Bao gồm teabreak và tài liệu hội thảo",
        capacity: 200,
        soldCount: 0,
        remaining: 200,
        isArchived: false
      }
    ]
  },
  {
    eventId: "evt-104",
    organizerId: "org-888",
    title: "Lễ Hội Âm Nhạc Mùa Hè: Summer Beats 2026",
    description: "Đại nhạc hội mùa hè hội tụ dàn DJ và ca sĩ hàng đầu.",
    category: "concert",
    categoryLabel: "Concert",
    bannerUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80",
    venueName: "Sân vận động Quân khu 7",
    venueAddress: "202 Hoàng Văn Thụ, Phường 2, Tân Bình, TP.HCM",
    city: "TP.HCM",
    startDatetime: "2026-07-01T18:00:00Z",
    endDatetime: "2026-07-01T23:00:00Z",
    salesStartDatetime: "2026-05-01T00:00:00Z",
    salesEndDatetime: "2026-07-01T17:00:00Z",
    status: "published",
    computedStatus: "completed",
    rejectionReason: null,
    cancellationReason: null,
    createdAt: "2026-04-20T09:00:00Z",
    updatedAt: "2026-07-02T08:00:00Z",
    times: ["18:00"],
    dates: ["2026-07-01"],
    ticketTiers: [
      {
        id: "tier-summer-1",
        label: "Vé GA",
        price: 350000,
        description: "Vé đứng tự do",
        capacity: 1000,
        soldCount: 1000,
        remaining: 0,
        isArchived: false
      }
    ]
  }
];

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
 * Computes metric aggregates for an event.
 */
export function calculateEventMetrics(event: OrganizerEvent) {
  let totalCapacity = 0;
  let soldTickets = 0;
  let totalRevenueVnd = 0;

  (event.ticketTiers || []).forEach(tier => {
    const cap = tier.capacity || 0;
    const sold = tier.soldCount || 0;
    const price = tier.price || 0;

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
  // SEC-04: Scoped query filter by organizerId
  const organizerId = getCurrentOrganizerId();
  const ownedEvents = eventsStore.filter(e => e.organizerId === organizerId);

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
  const event = eventsStore.find(e => e.eventId === eventId);

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
