import { describe, expect, it } from "vitest";
import { mutationConfirmation, REVIEW_WARNING } from "./mutationConfirmation";

describe("organizer mutation confirmations", () => {
  it.each([
    "showtime.startsAt",
    "showtime.add",
    "tier.price",
    "tier.label",
    "tier.add",
    "tier.restore",
    "tier.remove",
  ])("warns before %s changes an on-sale event", (field) => {
    expect(mutationConfirmation(true, [field])?.message).toContain(REVIEW_WARNING);
  });
  it("does not warn about review for draft events or inventory-only changes", () => {
    expect(mutationConfirmation(false, ["tier.price"])).toBeNull();
    expect(mutationConfirmation(true, ["tier.capacity"])).toBeNull();
  });
  it("combines destructive and moderation consequences into one question", () => {
    const request = {
      title: "Xóa suất?",
      message: "Không thể hoàn tác.",
      confirmLabel: "Xóa",
      cancelLabel: "Giữ lại",
      tone: "danger" as const,
    };
    expect(mutationConfirmation(false, ["showtime.remove"], request)).toEqual(request);
    expect(mutationConfirmation(true, ["showtime.remove"], request)?.message).toBe(
      `Không thể hoàn tác.\n\n${REVIEW_WARNING}`,
    );
  });
});
