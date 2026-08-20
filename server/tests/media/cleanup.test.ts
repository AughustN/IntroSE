import { describe, it, expect } from "vitest";
import { deleteFromCloudinary } from "../../src/services/cloudinary.js";
import { deleteLayoutMedia } from "../../src/modules/media/layoutMedia.js";

describe("Media Cleanup & Cloudinary Deletion", () => {
  it("calls deleteFromCloudinary with image resource type when removing image URL", async () => {
    const fakeCloudinaryUrl =
      "https://res.cloudinary.com/demo/image/upload/v123456/tixhub/events/10/banner/10.webp";
    await expect(deleteFromCloudinary(fakeCloudinaryUrl, "image")).resolves.not.toThrow();
  });

  it("calls deleteFromCloudinary with video resource type when removing video URL", async () => {
    const fakeVideoUrl =
      "https://res.cloudinary.com/demo/video/upload/v123456/tixhub/events/10/trailer/10.mp4";
    await expect(deleteFromCloudinary(fakeVideoUrl, "video")).resolves.not.toThrow();
  });

  it("safely handles non-cloudinary or empty URLs without crashing", async () => {
    await expect(deleteFromCloudinary("", "image")).resolves.not.toThrow();
    await expect(
      deleteFromCloudinary("https://images.unsplash.com/photo-123", "image"),
    ).resolves.not.toThrow();
    await expect(deleteLayoutMedia(null)).resolves.not.toThrow();
    await expect(deleteLayoutMedia("/uploads/floorplans/old.webp")).resolves.not.toThrow();
  });
});
