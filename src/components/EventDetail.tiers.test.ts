import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EventDetail from "./EventDetail";
import { cardToMovie } from "../services/catalogAdapter";

const noop = () => {};

describe("buyer ticket tier list", () => {
  it.each([20, 25])(
    "renders all %i summary tiers without hiding later prices or controls",
    (count) => {
      // The per-showtime limit must not truncate an event summary spanning multiple showtimes.
      const event = cardToMovie({
        id: 1,
        slug: "concert",
        title: "Concert",
        imageUrl: "https://example.com/poster.jpg",
        trailerUrl: null,
        category: "music",
        categoryLabel: "Âm nhạc",
        city: "Hà Nội",
        earliestShowtime: "2099-12-12T12:00:00Z",
        startingPrice: 100_000,
        soldOut: false,
        hasUpcoming: true,
        releasePhase: "now_showing",
      });
      event.ticketTiers = Array.from({ length: count }, (_, i) => ({
        id: String(i + 1),
        label: `Hạng ${String(i + 1).padStart(2, "0")}`,
        price: (i + 1) * 100_000,
        description: "",
        remaining: 100,
      }));
      event.times = ["19:00"];
      const html = renderToStaticMarkup(
        createElement(EventDetail, {
          event,
          showtimes: [],
          isSignedIn: false,
          relatedEvents: [],
          wishlistedIds: [],
          heldQuantities: {},
          holdBusy: false,
          holdRemainingMs: 0,
          onBack: noop,
          onOpenReviews: noop,
          onToggleWishlist: noop,
          onBookRelated: noop,
          onProceedToSeatSelection: noop,
          onProceedToCheckout: noop,
          onAdjustQuantity: noop,
          onRequireSignIn: noop,
          onNotice: noop,
        }),
      );
      expect(html.match(/aria-label="Thêm vé Hạng /g)).toHaveLength(count);
      expect(html).toContain(`aria-label="Thêm vé Hạng ${count}"`);
      expect(html).toContain(`aria-label="Bớt vé Hạng ${count}"`);
    },
  );
});
