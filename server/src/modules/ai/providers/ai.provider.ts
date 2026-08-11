// The seam between the AI domain and whichever vendor answers.
//
// Types live in @shared/ai/types.js so the web client imports the same declarations (Principle VI).
// Re-exported here because every consumer inside this module already reaches for this file.

export type {
  AICandidateEvent,
  ChatCompletion,
  ConversationTurn,
  ListingInput,
  ListingSuggestion,
  RecommendationContext,
} from '@shared/ai/types.js';

import type {
  ChatCompletion,
  ListingInput,
  ListingSuggestion,
  RecommendationContext,
} from '@shared/ai/types.js';

/**
 * One class implements this, and swapping vendors is meant to stay that one class.
 *
 * `chat` returns event *ids*, never event records: the service resolves each id against the
 * candidate set it built, so nothing the model invents can reach a reader (ADR-0001 grounding).
 */
export interface AIProvider {
  chat(context: RecommendationContext): Promise<ChatCompletion>;
  generateEventListing(input: ListingInput): Promise<ListingSuggestion>;
}
