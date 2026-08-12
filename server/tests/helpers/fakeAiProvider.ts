import { expect } from 'vitest';
import type {
  AIProvider,
  ChatCompletion,
  ListingInput,
  ListingSuggestion,
  RecommendationContext,
} from '../../src/modules/ai/providers/ai.provider.js';
import { setAIProvider } from '../../src/modules/ai/ai.service.js';

/**
 * A provider that answers whatever the test says, and records what it was asked.
 *
 * Every degradation path in this feature is defined by what happens when the model is slow, wrong,
 * or must not be called at all — none of which is reachable against a live endpoint, and all of
 * which must be deterministic. `neverCalled` is the important one: several cases assert that no
 * outbound call happens, and an assertion inside the double is the only way to prove it rather than
 * infer it from the response.
 */
export class FakeAIProvider implements AIProvider {
  chatCalls: RecommendationContext[] = [];
  listingCalls: ListingInput[] = [];

  constructor(
    private handlers: {
      chat?: (context: RecommendationContext) => Promise<ChatCompletion> | ChatCompletion;
      listing?: (input: ListingInput) => Promise<ListingSuggestion> | ListingSuggestion;
    } = {},
  ) {}

  async chat(context: RecommendationContext): Promise<ChatCompletion> {
    this.chatCalls.push(context);
    if (!this.handlers.chat) throw new Error('fake provider: no chat handler');
    return this.handlers.chat(context);
  }

  async generateEventListing(input: ListingInput): Promise<ListingSuggestion> {
    this.listingCalls.push(input);
    if (!this.handlers.listing) throw new Error('fake provider: no listing handler');
    return this.handlers.listing(input);
  }
}

/** Fails the test the moment anything calls out. Use where the contract is "no external call". */
export const neverCalled = (): FakeAIProvider =>
  new FakeAIProvider({
    chat: () => {
      expect.unreachable('provider.chat must not be called');
    },
    listing: () => {
      expect.unreachable('provider.generateEventListing must not be called');
    },
  });

/**
 * Install a double for one test and hand back the restore function.
 *
 * The service holds a module-level provider, so a suite that swapped it and did not put it back
 * would leak into every later file — `fileParallelism` is off, so they share one process.
 */
export function useFakeProvider(fake: FakeAIProvider): () => void {
  const previous = setAIProvider(fake);
  return () => void setAIProvider(previous);
}
