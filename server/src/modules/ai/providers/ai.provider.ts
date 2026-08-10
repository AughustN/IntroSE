export interface AICandidateEvent {
  id: number;
  slug: string;
  title: string;
  category: string;
  city: string | null;
  startsAt: string;
  startingPrice: number | null;
}

export interface RecommendationContext {
  message: string;
  purchasedCategories: string[];
  savedCategories: string[];
  viewedCategories: string[];
  candidates: AICandidateEvent[];
}

export interface ListingInput {
  brief: string;
  category?: string;
  eventType?: "general_admission" | "seated";
}

export interface ListingSuggestion {
  title: string;
  description: string;
  tags: string[];
  ticketPriceSuggestions: Array<{ name: string; price: number }>;
}

export interface AIProvider {
  recommendEvents(context: RecommendationContext): Promise<Array<{ eventId: number; reason: string }>>;
  generateEventListing(input: ListingInput): Promise<ListingSuggestion>;
}
