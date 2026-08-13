import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrganizerEvents,
  getOrganizerEventDetail,
  requestPublication,
  updateEventDetails,
  deleteOrArchiveTier,
  saveTicketTier,
  cancelEvent,
  computeEventStatus,
  createOrganizerEvent,
  setCurrentOrganizerId,
  resetOrganizerStore
} from "../../src/services/organizerClient";

describe("Organizer Event Management Service Layer", () => {
  beforeEach(() => {
    resetOrganizerStore();
  });

  it("FR-001 / FR-002: Should list portfolio events scoped to authenticated organizer identity", async () => {
    setCurrentOrganizerId("org-888");
    const result = await getOrganizerEvents();

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach(e => {
      expect(e.organizerId).toBe("org-888");
    });
  });

  it("FR-002: Should reject access to events owned by a different organizer (SEC-04)", async () => {
    setCurrentOrganizerId("org-other");
    await expect(getOrganizerEventDetail("evt-101")).rejects.toThrow("FORBIDDEN");
  });

  it("FR-003: Should filter events by status correctly", async () => {
    setCurrentOrganizerId("org-888");
    const result = await getOrganizerEvents({ status: "published" });

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach(e => {
      expect(e.status).toBe("published");
    });
  });

  it("FR-006 / FR-007: Should transition valid Draft event to Pending Approval upon Request to Publish", async () => {
    setCurrentOrganizerId("org-888");
    const updated = await requestPublication("evt-103");

    expect(updated.status).toBe("pending_review");
    expect(updated.computedStatus).toBe("pending_review");
  });

  it("FR-014: Should automatically revert Published event status to Pending Approval when material fields are edited (UC-24 A6)", async () => {
    setCurrentOrganizerId("org-888");
    const res = await updateEventDetails("evt-101", {
      title: "Đêm Nhạc Trịnh Công Sơn: Hạ Trắng (Phiên bản mới)"
    });

    expect(res.statusRevertedToPending).toBe(true);
    expect(res.event.status).toBe("pending_review");
  });

  it("FR-009: Should reject ticket tier capacity reduction below sold tickets count", async () => {
    setCurrentOrganizerId("org-888");
    // tier-v1 has 100 sold tickets
    await expect(
      saveTicketTier("evt-101", {
        id: "tier-v1",
        label: "Vé VIP",
        price: 800000,
        capacity: 50 // less than 100 sold
      })
    ).rejects.toThrow("VALIDATION_ERROR");
  });

  it("FR-015: Should archive ticket tier instead of hard deleting if tickets have been sold (UC-26 A3)", async () => {
    setCurrentOrganizerId("org-888");
    // tier-v1 has 100 sold tickets
    const res = await deleteOrArchiveTier("evt-101", "tier-v1");

    expect(res.actionTaken).toBe("archived");
    expect(res.isArchived).toBe(true);

    const eventDetail = await getOrganizerEventDetail("evt-101");
    const tier = eventDetail.data.ticketTiers.find(t => t.id === "tier-v1");
    expect(tier?.isArchived).toBe(true);
  });

  it("FR-010 / FR-011 / FR-012: Should process event cancellation with mandatory reason and generate audit record", async () => {
    setCurrentOrganizerId("org-888");
    const reason = "Sự cố thời tiết bão lũ nghiêm trọng tại khu vực.";
    const result = await cancelEvent("evt-101", reason);

    expect(result.event.status).toBe("canceled");
    expect(result.event.cancellationReason).toBe(reason);
    expect(result.auditRecord.ticketsAffectedCount).toBe(320); // 100 VIP + 220 Standard
    expect(result.auditRecord.totalRefundAmountVnd).toBe(168000000); // 100*800k + 220*400k = 168m
  });

  it("Derived Status: Should dynamically infer Completed status when endDatetime has passed", () => {
    const pastEvent: any = {
      eventId: "past-1",
      status: "published",
      endDatetime: "2020-01-01T00:00:00Z"
    };

    expect(computeEventStatus(pastEvent)).toBe("completed");
  });

  it("FR-017: Should create new event with required picture (bannerUrl) and optional video (videoUrl)", async () => {
    setCurrentOrganizerId("org-888");

    // Missing picture should fail validation
    await expect(
      createOrganizerEvent({
        title: "Sự Kiện Thử Nghiệm",
        description: "Mô tả...",
        category: "music",
        categoryLabel: "Âm nhạc",
        bannerUrl: "", // missing required picture
        venueName: "Nhà hát TP",
        venueAddress: "Quận 1",
        city: "TP.HCM",
        startDatetime: "2026-10-01T19:00:00Z",
        endDatetime: "2026-10-01T22:00:00Z",
        ticketTiers: [{ label: "Vé Standard", price: 100000, capacity: 50 }]
      })
    ).rejects.toThrow("VALIDATION_ERROR");

    // Valid create with picture and optional video
    const created = await createOrganizerEvent({
      title: "Concert Đêm Mùa Thu 2026",
      description: "Đêm nhạc đặc sắc mùa thu.",
      category: "music",
      categoryLabel: "Âm nhạc",
      bannerUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      venueName: "Nhà hát Thành Phố",
      venueAddress: "7 Công Trường Lam Sơn, Quận 1",
      city: "TP.HCM",
      startDatetime: "2026-10-10T19:30:00Z",
      endDatetime: "2026-10-10T22:30:00Z",
      ticketTiers: [{ label: "Vé VIP", price: 500000, capacity: 100 }]
    });

    expect(created.eventId).toBeDefined();
    expect(created.title).toBe("Concert Đêm Mùa Thu 2026");
    expect(created.bannerUrl).toBe("https://images.unsplash.com/photo-1514525253161-7a46d19cd819");
    expect(created.videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(created.status).toBe("draft");
  });
});
