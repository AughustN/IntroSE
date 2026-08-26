/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MovieEvent {
  /** The event slug. Named `id` because routing keys off it; the numeric one is `eventId`. */
  id: string;
  /**
   * The catalogue's numeric id.
   *
   * The adapter used to drop it, so anything needing to address an event by id — reviews being the
   * first — had no way to. Null only for the dev-only sample catalogue, which has no server rows.
   */
  eventId: number | null;
  /**
   * Which inventory model this event sells. Seated events pick seats from a map; general-admission
   * events pick a quantity per tier and never see a seat map — they have no seats in the database.
   */
  eventType: "general_admission" | "seated";
  /*
   * The catalogue's own category code, verbatim — not a fixed set.
   *
   * It was `"movie" | "music" | "theatre" | "concert"`, a leftover from when this was a cinema
   * mock-up, and the adapter squeezed a dozen real categories into it by defaulting everything it
   * did not recognise to `music`. Filtering by "Âm nhạc" therefore returned business conferences,
   * marathons and merchandise: 461 of 503 events.
   */
  category: string;
  /** The same category's Vietnamese name, so the UI never has to own a translation table. */
  categoryLabel: string;
  title: string;
  originalTitle?: string;
  tags: string[]; // e.g. ["2D", "Phụ Đề", "IMAX"]
  ageRating: "P" | "T13" | "T16" | "T18"; // age restriction labels in Cam Đất Nhạt (#C69F89)
  ageDescription: string;
  duration: number; // in minutes
  genre: string[];
  director: string;
  cast: string[];
  releaseDate: string;
  rating: number; // e.g. 8.7
  reviewCount: number;
  description: string;
  price: number; // base price in cam dat nhat (#C69F89)
  doublePrice: number; // double seat price
  ticketTiers: TicketTier[];
  imageUrl: string;
  trailerUrl: string; // fallback or streaming video url
  times: string[]; // showtimes
  dates: string[]; // calendar dates
  /**
   * The province, free text — the same shape `venues.city` holds on the server.
   *
   * This was a three-way union, which made every other province in the country unrepresentable:
   * `toCity` had to coerce anything it did not recognise, and it coerced to "TP.HCM", so an event
   * in Nghệ An arrived in the browser claiming to be in Ho Chi Minh City.
   */
  city: string;
  location: string;
  venueName: string;
  venueMapUrl: string;
  venueGuide: string;
  refundPolicy: string;
  isHighDemand?: boolean;
  /** Cinema only: which of the landing band's two tabs this film belongs under (0038). */
  releasePhase?: "now_showing" | "upcoming";
  // `finished` is not a degree of "sold out": the event happened. It keeps its card, its tag, and
  // its detail page, but nothing about it is buyable, so every booking control reads it the same
  // way it reads `cancelled`.
  //
  // There is no `low` ("sắp hết"). Nothing could ever produce it: the catalog adapter derives this
  // field from `hasUpcoming` and `soldOut`, neither of which carries a degree, so the only rows that
  // ever said `low` were the sample fixtures. The filter offering it matched zero events by
  // construction. An event-wide "nearly gone" is not recoverable either — an event now spans ~125
  // showtimes across 44 cinemas, and a threshold over that total describes nothing a buyer can act
  // on. Scarcity belongs where it is true and known: the per-tier "Còn N vé" on a chosen showtime.
  status: "available" | "sold_out" | "finished" | "cancelled";
  isFeatured: boolean;
  comboOffer?: string;
  affiliateCode?: string;
}

export interface TicketTier {
  id: string;
  label: string;
  price: number;
  description: string;
  badge?: string;
  /** General admission only: capacity − sold − reserved. `null` for seated or uncapped tiers. */
  remaining?: number | null;
  capacity?: number;
  soldCount?: number;
  isArchived?: boolean;
}

export interface PromoVoucher {
  code: string;
  label: string;
  discountAmount: number;
  minOrder: number;
  expiresAt: string;
}

export interface Seat {
  id: string;
  row: string; // A, B, C...
  number: number;
  type: "single" | "double";
  price: number;
  isBooked: boolean;
  /** The real `showtime_seats` row this stands for — what the hold API locks. Absent for GA lines. */
  showtimeSeatId?: number;
}

/**
 * One in-progress booking flow: which showtime is being bought, what is currently held, and the
 * instant the hold lapses. It is owned by `App` and survives every move inside the flow (chọn suất →
 * chọn ghế → thanh toán), so stepping back from checkout returns the same selection and the same
 * countdown — never a fresh one.
 *
 * Shape mirrors the reservation feature 003 will own server-side: one reservation per showtime, one
 * absolute `expiresAt` governing the whole selection, no extension when a seat is added or removed
 * (FR-006). `expiresAt` is an absolute instant precisely so the countdown is display-only and a
 * remount cannot restart it. Until 003 lands this lives in the browser only.
 */
export interface HoldSession {
  /** The server-side reservation this mirrors. The database, not this object, owns the hold. */
  reservationId: number;
  showtimeId: number;
  eventId: string;
  eventTitle: string;
  /** Seated holds specific seats; general admission holds a quantity per tier. */
  mode: "seated" | "ga";
  selectedDate: string;
  selectedTime: string;
  /** Held seats (seated) or one entry per general-admission ticket. */
  seats: Seat[];
  /** General admission only: quantity per tier id, so the tier steppers can be restored. */
  quantities?: Record<string, number>;
  /** Epoch ms. Absolute — the countdown renders from it, never the other way round. */
  expiresAt: number;
}

export interface Booking {
  id: string;
  movie: MovieEvent;
  selectedDate: string;
  selectedTime: string;
  selectedSeats: Seat[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalPrice: number;
  serviceFee: number;
  discount: number;
  finalPrice: number;
  paymentMethod: string;
  promoCode?: string;
  deliveryChannel: "email_sms";
  status: "paid" | "pending" | "failed" | "cancelled";
  qrStatus: "unused" | "checked_in";
  bookingTime: string;
  qrPayload: string;
  /**
   * The server's ticket rows behind this booking, when it came from the server. Optional because
   * a local checkout draft never has them; self-cancellation (refund to ví) only exists where they
   * do.
   */
  tickets?: Array<{ id: number; label: string; status: "valid" | "used" | "refunded" }>;
  /**
   * Snapshot snack lines of this order (014) and the ONE voucher that redeems them at the venue
   * counter. Absent when the buyer bought none.
   */
  concessions?: Array<{ label: string; quantity: number; unitPriceAmount: number }>;
  voucher?: { code: string; status: "unredeemed" | "redeemed" | "void"; redeemedAt: string | null };
}

export interface CheckoutPayload {
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  paymentMethod: string;
  serviceFee: number;
  discount: number;
  finalPrice: number;
  promoCode?: string;
}

export type OrganizerEventStatus =
  "draft" | "pending_review" | "published" | "canceled" | "completed";

export interface OrganizerEvent {
  eventId: string;
  organizerId: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  bannerUrl: string;
  videoUrl?: string;
  venueName: string;
  venueAddress: string;
  city: string;
  startDatetime: string;
  endDatetime: string;
  salesStartDatetime: string;
  salesEndDatetime: string;
  status: OrganizerEventStatus;
  computedStatus: OrganizerEventStatus;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
  ticketTiers: TicketTier[];
  times: string[];
  dates: string[];
  isHighDemand?: boolean;
}

export interface OrganizerPortfolioSummary {
  eventId: string;
  organizerId: string;
  title: string;
  bannerUrl: string;
  status: OrganizerEventStatus;
  startDatetime: string;
  endDatetime: string;
  locationName: string;
  totalCapacity: number;
  soldTickets: number;
  remainingTickets: number;
  totalRevenueVnd: number;
}

export interface EventCancellationAuditRecord {
  cancellationId: string;
  eventId: string;
  organizerId: string;
  canceledAt: string;
  reason: string;
  ticketsAffectedCount: number;
  totalRefundAmountVnd: number;
}

export type MediaType = "avatar" | "logo" | "banner" | "trailer" | "floorplan" | "reference";
export type StagedMediaStatus = "idle" | "staged" | "uploading" | "error";

export interface StagedMedia {
  file: File | null;
  previewUrl: string | null;
  existingUrl: string | null;
  mediaType: MediaType;
  status: StagedMediaStatus;
  errorMessage?: string;
}
