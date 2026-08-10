import { z } from "zod";
import { config, AI_REQUEST_TIMEOUT_MS } from "../../../config.js";
import type { AIProvider, ListingInput, ListingSuggestion, RecommendationContext } from "./ai.provider.js";

const recommendationItemSchema = z.object({
  eventId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
  event_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
  reason: z.string().trim().min(1).max(400),
}).strict().transform((item) => {
  const id = item.eventId ?? item.event_id;
  if (id === undefined) throw new Error("AI recommendation has no event id.");
  return { eventId: Number(id), reason: item.reason };
});

const recommendationSchema = z.object({
  recommendations: z.array(recommendationItemSchema).min(1).max(6),
}).strict();

const priceSuggestionSchema = z.array(z.union([
  z.object({ name: z.string().trim().min(1).max(80), price: z.number().int().nonnegative() }),
  z.number().int().nonnegative(),
])).max(4).transform((suggestions) => suggestions.map((suggestion, index) =>
  typeof suggestion === "number"
    ? { name: index === 0 ? "Vé tiêu chuẩn" : `Hạng vé ${index + 1}`, price: suggestion }
    : suggestion,
));

const listingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5_000),
  tags: z.array(z.string().trim().min(1).max(50)).max(10),
  ticketPriceSuggestions: priceSuggestionSchema,
}).strict();

function jsonFromCompletion(payload: unknown): unknown {
  const body = payload as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned no completion content.");
  try { return JSON.parse(content); } catch { throw new Error("AI provider returned invalid JSON."); }
}

async function complete(system: string, input: unknown): Promise<unknown> {
  if (!config.openaiApiKey) throw new Error("AI provider is not configured.");
  const signal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
  const response = await fetch(config.openaiChatUrl, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(input) },
      ],
    }),
  });
  if (!response.ok) {
    const target = new URL(config.openaiChatUrl);
    throw new Error(`AI provider request failed (${response.status}) at ${target.origin}${target.pathname}.`);
  }
  return jsonFromCompletion(await response.json());
}

export class OpenAIProvider implements AIProvider {
  async recommendEvents(context: RecommendationContext) {
    const result = recommendationSchema.parse(await complete(
      "You rank only the supplied candidate events. When candidates is non-empty, return 1 to 6 recommendations. Return JSON {recommendations:[{eventId:number,reason:string}]}. Each eventId MUST be an exact numeric id from candidates. Never invent an event, price, date, or ID. Write concise Vietnamese reasons.",
      context,
    ));
    return result.recommendations;
  }

  async generateEventListing(input: ListingInput): Promise<ListingSuggestion> {
    return listingSchema.parse(await complete(
      'You are an event-listing assistant. Return JSON exactly matching {"title":"string","description":"string","tags":["string"],"ticketPriceSuggestions":[{"name":"Early Bird","price":150000}]}. ticketPriceSuggestions MUST be an array of objects with both name and integer price, never an array of numbers. Suggestions are editable drafts, not factual claims. Write Vietnamese.',
      input,
    ));
  }
}
