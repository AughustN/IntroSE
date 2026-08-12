// The AI payloads, declared once.
//
// These shapes were previously written out twice — in the server's provider module and again in the
// web client — which is the contract drift the constitution names in Principle VI. A backend change
// that breaks the client must fail at compile time, so both sides import this file and neither
// re-declares any of it. Mirrors specs/008-ai-chatbot/contracts/ai-chatbot.openapi.yaml.

/** Where an answer came from. All three are successful outcomes; only `ai` cost a model call. */
export type AISource = 'ai' | 'cache' | 'fallback';

/**
 * One message in the conversation.
 *
 * Client-held and never persisted. Treated as untrusted text throughout: it shapes generated prose
 * and nothing else — it cannot select a user, widen a query, or introduce an event.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * An event the assistant is allowed to talk about.
 *
 * Built by SQL from the live catalog, and the complete universe of events an answer may contain.
 * Every field shown to a reader comes from here, never from generated text.
 */
export interface AICandidateEvent {
  id: number;
  slug: string;
  title: string;
  category: string;
  city: string | null;
  startsAt: string;
  /** VND integer, or null when no tier is priced. */
  startingPrice: number | null;
}

/** A candidate paired with the model's reason for it — the only part the model authors. */
export interface AIRecommendation {
  event: AICandidateEvent;
  reason: string;
}

export interface ChatRequest {
  message: string;
  /** Recent turns, oldest first, excluding `message`. Bounded server-side. */
  history?: ConversationTurn[];
}

export interface ChatResponse {
  source: AISource;
  reply: string;
  /** True when the question fell outside the event-ticketing domain; `recommendations` is then empty. */
  declined: boolean;
  recommendations: AIRecommendation[];
  /** Explains a non-`ai` source: AI off, platform ceiling, timeout, provider error, nothing found. */
  message?: string;
}

/**
 * How the platform itself behaves, as live values.
 *
 * The assistant is told it may answer questions about holds, refunds and buying — and until this
 * existed it had no source for any of it, so the only honest answers were "I don't know" and a
 * number it made up. Every field here is read from the Admin-managed settings at request time, so
 * the assistant quotes the rule that is actually in force rather than one written into a prompt
 * months ago and since changed.
 */
export interface PlatformFacts {
  seatHoldMinutes: number;
  topupGraceMinutes: number;
  absoluteCeilingMinutes: number;
  maxTicketsPerBuyer: number;
  walletTopupMin: number;
  walletTopupMax: number;
}

/** What the model is asked to rank over. Assembled server-side from the session identity. */
export interface RecommendationContext {
  message: string;
  history: ConversationTurn[];
  purchasedCategories: string[];
  savedCategories: string[];
  viewedCategories: string[];
  candidates: AICandidateEvent[];
  platform: PlatformFacts;
}

/** What the model returns for a chat turn: prose, a domain verdict, and ids to be resolved. */
export interface ChatCompletion {
  reply: string;
  declined: boolean;
  recommendations: Array<{ eventId: number; reason: string }>;
}

export interface ListingInput {
  brief: string;
  category?: string;
  eventType?: 'general_admission' | 'seated';
}

/** An editable draft. Nothing here reaches an event until the organizer accepts it. */
export interface ListingSuggestion {
  title: string;
  description: string;
  tags: string[];
  ticketPriceSuggestions: Array<{ name: string; price: number }>;
}

export interface ListingResponse {
  source: AISource;
  /** Null on every fallback; the organizer proceeds manually. */
  suggestion: ListingSuggestion | null;
  message?: string;
}
