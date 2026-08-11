import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

export interface RecommendedEvent {
  event: { id: number; slug: string; title: string; category: string; city: string | null; startsAt: string; startingPrice: number | null };
  reason: string;
}

export interface ListingSuggestion {
  title: string;
  description: string;
  tags: string[];
  ticketPriceSuggestions: Array<{ name: string; price: number }>;
}

async function call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await withAuthRetry((token) => fetch(apiUrl(`/api/ai${path}`), {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error.message ?? error.code ?? "Không thể gọi AI.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const aiClient = {
  recommendations: (message: string) => call<{ source: "ai" | "cache" | "fallback"; recommendations: RecommendedEvent[]; message?: string }>("/recommendations", { message }),
  eventAssistant: (input: { brief: string; category?: string; eventType?: "general_admission" | "seated" }) => call<{ source: "ai" | "cache" | "fallback"; suggestion: ListingSuggestion | null; message?: string }>("/event-assistant", input),
  bookmarks: () => call<string[]>("/bookmarks", undefined, "GET"),
  bookmark: (slug: string) => call<{ saved: boolean }>(`/events/${encodeURIComponent(slug)}/bookmark`, {}),
  recordView: (slug: string) => call<void>(`/events/${encodeURIComponent(slug)}/view`, {}),
};
