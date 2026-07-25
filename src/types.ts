/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MovieEvent {
  id: string;
  /**
   * Which inventory model this event sells. Seated events pick seats from a map; general-admission
   * events pick a quantity per tier and never see a seat map — they have no seats in the database.
   */
  eventType: "general_admission" | "seated";
  category: "movie" | "music" | "theatre" | "concert";
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
  city: "TP.HCM" | "Hà Nội" | "Đà Nẵng";
  location: string;
  venueName: string;
  venueMapUrl: string;
  venueGuide: string;
  refundPolicy: string;
  status: "available" | "low" | "sold_out" | "cancelled";
  ticketsLeft: number;
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
