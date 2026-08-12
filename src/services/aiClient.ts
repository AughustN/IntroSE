import type {
  ChatResponse,
  ConversationTurn,
  ListingResponse,
  ListingSuggestion,
} from "@/shared/ai/types";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";
import { readApiError } from "./apiError";

// Types are imported, never re-declared: the server builds its responses from the same file, so a
// shape change that breaks this client fails at compile time rather than in the browser.
export type { ChatResponse, ConversationTurn, ListingSuggestion };

async function call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await withAuthRetry((token) =>
    fetch(apiUrl(`/api/ai${path}`), {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error.message ?? error.code ?? "Không thể gọi AI.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const aiClient = {
  /**
   * One turn of the conversation.
   *
   * `history` is whatever the panel is holding, capped at the server's limit — sending more is a
   * 400, and the cap is small enough that the request stays well inside any body limit.
   */
  chat: (message: string, history: ConversationTurn[] = []) =>
    call<ChatResponse>("/chat", { message, history: history.slice(-8) }),
  eventAssistant: (input: {
    brief: string;
    category?: string;
    eventType?: "general_admission" | "seated";
  }) => call<ListingResponse>("/event-assistant", input),
  bookmarks: () => call<string[]>("/bookmarks", undefined, "GET"),
  bookmark: (slug: string) => call<{ saved: boolean }>(`/events/${encodeURIComponent(slug)}/bookmark`, {}),
  recordView: (slug: string) => call<void>(`/events/${encodeURIComponent(slug)}/view`, {}),
};
