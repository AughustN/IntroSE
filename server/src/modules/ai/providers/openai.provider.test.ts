import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.provider.js";

// Exercise the provider's public contract without a database or a real paid AI request.
vi.mock("../../../config.js", async () => {
  const { DEFAULT_MAX_TIERS_PER_SHOWTIME } = await import("@shared/catalog/limits.js");
  return {
    MAX_TIERS_PER_SHOWTIME: DEFAULT_MAX_TIERS_PER_SHOWTIME,
    AI_REQUEST_TIMEOUT_MS: 1_000,
    config: {
      openaiApiKey: "test-key",
      openaiChatUrl: "https://example.test/chat",
      openaiModel: "test",
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

function respondWithTiers(count: number) {
  const suggestion = {
    title: "Concert",
    description: "Mô tả",
    tags: ["music"],
    ticketPriceSuggestions: Array.from({ length: count }, (_, i) => ({
      name: `Hạng ${i + 1}`,
      price: (i + 1) * 100_000,
    })),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(suggestion) } }],
        }),
      ),
    ),
  );
}

describe("listing assistant ticket tiers", () => {
  it("accepts 20 valid price suggestions", async () => {
    respondWithTiers(20);
    const result = await new OpenAIProvider().generateEventListing({
      brief: "Concert nhiều hạng vé",
    });
    expect(result.ticketPriceSuggestions).toHaveLength(20);
    expect(result.ticketPriceSuggestions[19]).toEqual({ name: "Hạng 20", price: 2_000_000 });
  });

  it("rejects 21 suggestions rather than offering tiers that cannot all be created", async () => {
    respondWithTiers(21);
    await expect(new OpenAIProvider().generateEventListing({ brief: "Concert" })).rejects.toThrow();
  });
});
