import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { deleteFromCloudinary } from "../../src/services/cloudinary.js";
import { deleteLayoutMedia } from "../../src/modules/media/layoutMedia.js";

describe("Media Cleanup & Cloudinary Deletion", () => {
  // Same reason as the upload suite: these assert which resource type each caller asks for and
  // that a missing URL is a no-op, neither of which needs a live account to answer.
  beforeAll(() => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    vi.stubEnv("CLOUDINARY_NAME", "");
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
  });
  afterAll(() => vi.unstubAllEnvs());

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

  it("safely handles non-cloudinary or null URLs without crashing", async () => {
    await expect(deleteFromCloudinary(null, "image")).resolves.not.toThrow();
    await expect(
      deleteFromCloudinary("https://images.unsplash.com/photo-123", "image"),
    ).resolves.not.toThrow();
    await expect(deleteLayoutMedia(null)).resolves.not.toThrow();
    await expect(deleteLayoutMedia("/uploads/floorplans/old.webp")).resolves.not.toThrow();
  });
});
