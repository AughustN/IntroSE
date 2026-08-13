/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SAMPLE_MOVIES } from "./data";
import { Booking, CheckoutPayload, HoldSession, MovieEvent, Seat } from "./types";
import AdminPanel from "./components/AdminPanel";
import AuthModal from "./components/AuthModal";
import AccountPage from "./components/account/AccountPage";
import OrganizerPanel from "./components/OrganizerPanel";
import AdminModeration from "./components/AdminModeration";
import ResetPassword from "./components/ResetPassword";
import type { Me } from "@/shared/auth/types";
import type { EventDetail as CatalogEventDetail, Showtime } from "@/shared/catalog/types";
import { authClient } from "./services/authClient";
import { catalogClient } from "./services/catalogClient";
import { aiClient } from "./services/aiClient";
import { cardToMovie, detailToMovie } from "./services/catalogAdapter";
import { applyEventSeo, clearEventSeo } from "./services/seo";
import { matchesDateFilter, type DateFilter } from "./services/dateFilter";
import { matchesQuery, searchEvents } from "./services/eventSearch";
import { formatEventDate } from "./services/formatDate";
import { formatVnd } from "./services/currency";
import {
  ACCOUNT_PATH,
  isOverlayPath,
  pathToRoute,
  RESET_PASSWORD_PATH,
  screenToPath,
  VNPAY_RETURN_PATH,
  type Screen,
} from "./routes";
import {
  holdTotalPrice,
  loadHoldSession,
  saveHoldSession,
  sessionFromReservation,
} from "./services/holdSession";
import { HoldError, holdsClient } from "./services/holdsClient";
import { walletClient, WalletError, type OrderListItem, type Topup } from "./services/walletClient";
import WalletPanel from "./components/wallet/WalletPanel";
import VnpayReturn from "./components/wallet/VnpayReturn";
import { useHoldCountdown } from "./hooks/useHoldCountdown";
import BookingHistory from "./components/BookingHistory";
import AIChatPanel from "./components/AIChatPanel";
import ToastStack, { type ToastKind, type ToastMessage } from "./components/ToastStack";
import ConfirmDialog, { type ConfirmRequest } from "./components/ConfirmDialog";
import HoldExpiredDialog from "./components/HoldExpiredDialog";
import CheckoutForm from "./components/CheckoutForm";
import CategoryRow from "./components/CategoryRow";
import EventDetail from "./components/EventDetail";
import ReviewsPage from "./components/reviews/ReviewsPage";
import EventFilters from "./components/EventFilters";
import EventGrid from "./components/EventGrid";
import EventTicker from "./components/EventTicker";
import { buildLandingSections, isCatchAllCategory } from "./services/eventSections";
import Footer from "./components/Footer";
import Header from "./components/Header";
import HeroVideo from "./components/HeroVideo";
import SeatLayout from "./components/SeatLayout";
import TicketTicket from "./components/TicketTicket";
import LegalPage from "./components/LegalPage";
import aboutUsMd from "./content/legal/about-us.md?raw";
import termsOfServiceMd from "./content/legal/terms-of-service.md?raw";
import websiteTermsMd from "./content/legal/website-terms.md?raw";
import refundPolicyMd from "./content/legal/refund-policy.md?raw";

type ThemeMode = "dark" | "light";

/**
 * The booking flow: chọn suất → chọn ghế → thanh toán. A hold lives for as long as the buyer stays
 * inside these three screens; stepping between them keeps the selection and the countdown, and only
 * leaving the flow (or the TTL) releases it.
 */
/**
 * What the price slider spans in the seconds before the catalog answers, and only then.
 *
 * Not a business rule and not a cap — the moment `events` arrives, the dearest real ticket replaces
 * it. It exists because a slider whose two ends are both zero has no positions on it.
 */
const PRICE_CEILING_BEFORE_CATALOG = 1_000_000;

/**
 * What clicking one row of a multi-select filter does to the set.
 *
 * `"all"` is a control rather than a value, so it clears; anything else flips its own membership.
 * Returned as an updater so the three call sites read `setX(toggleFilterValue(v))` and none of them
 * has to close over the current array.
 */
const toggleFilterValue =
  (value: string) =>
  (current: string[]): string[] => {
    if (value === "all") return [];
    return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  };

/** How many curated events the trending band runs. An editorial shortlist, the length Ticketbox uses. */
const TRENDING_COUNT = 10;

/**
 * Rows in the nav's search dropdown.
 *
 * Six, because the panel hangs under a floating pill and has to stay inside the viewport on a
 * laptop; past that the list is a page, and the page already exists at `/events`.
 */
const SEARCH_SUGGESTION_COUNT = 6;

const FLOW_SCREENS: Screen[] = ["detail", "seats", "checkout"];

const LEAVE_FLOW_WARNING =
  "Bạn đang giữ chỗ cho suất này. Thoát khỏi quy trình đặt vé sẽ hủy chỗ đang giữ " +
  "và mất tiến trình thanh toán — ghế sẽ được trả lại cho người khác ngay lập tức.";

const BOOKINGS_CACHE_KEY = "tixhub_bookings_cache_v2";
// Pre-rebrand keys, still read (and cleared) so existing local data survives the TixHub rename.
const LEGACY_BOOKINGS_CACHE_KEYS = ["ticketbox_bookings_cache_v2", "ticketbox_bookings_cache_v1"];
const WISHLIST_CACHE_KEY = "tixhub_wishlist_cache_v1";
const LEGACY_WISHLIST_CACHE_KEY = "ticketbox_wishlist_cache_v1";
const USER_CACHE_KEY = "tixhub_mock_user_v1";
const LEGACY_USER_CACHE_KEY = "ticketbox_mock_user_v1";
/**
 * The avatar is cached next to the name so the header can paint the real picture on the first
 * frame. Without it the letter placeholder always wins the race: `avatarUrl` started as null and
 * only arrived after /auth/refresh + /me, so every reload flashed the initial and then swapped.
 * A stale entry is harmless — the image falls back to the initial on error and `restore()`
 * reconciles it a moment later.
 */
const AVATAR_CACHE_KEY = "tixhub_avatar_url_v1";
/**
 * Cached for the same reason as the avatar: the default avatar's colour is derived from the email,
 * so without it the circle would paint in the fallback colour and then change once the session was
 * restored. Never rendered as text — only fed to `avatarColor`.
 */
const EMAIL_CACHE_KEY = "tixhub_user_email_v1";
const THEME_CACHE_KEY = "tixhub_theme_mode_v1";
const LEGACY_THEME_CACHE_KEY = "ticketbox_theme_mode_v1";

function getInitialAvatar(): string | null {
  try {
    return localStorage.getItem(AVATAR_CACHE_KEY);
  } catch {
    return null;
  }
}

function getInitialEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_CACHE_KEY);
  } catch {
    return null;
  }
}

/** Keeps a cache entry in step with its state; `null` clears it. */
function cacheValue(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (err) {
    console.error(`Failed to cache ${key}:`, err);
  }
}

/**
 * Mirrors a value into a ref every render. Lets the URL effect read the current flow — the hold, the
 * selected event, the booking being shown — without listing any of it as a dependency, which would
 * make it re-run on things that have nothing to do with the address bar.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

function getInitialTheme(): ThemeMode {
  try {
    const cached =
      localStorage.getItem(THEME_CACHE_KEY) || localStorage.getItem(LEGACY_THEME_CACHE_KEY);
    if (cached === "dark" || cached === "light") return cached;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Turn a server order into the `Booking` the ticket screens read.
 *
 * The two shapes disagree because they were built for different worlds: `Booking` was designed when
 * an order only ever existed in this browser, so it carries a whole `MovieEvent` and the buyer's
 * contact details. The server row carries neither — the event is referenced, and the contact fields
 * were never persisted on the order at all.
 *
 * So the event is reconstructed from what the list does return, and the contact fields come back
 * empty. Nothing on the tickets or ticket-detail screen prints them; they exist on the type because
 * checkout collects them, not because a saved order remembers them.
 */
function bookingFromOrder(order: OrderListItem, known?: MovieEvent): Booking {
  const startsAt = new Date(order.startsAt);
  const iso = order.startsAt.slice(0, 10);
  const time = order.startsAt.slice(11, 16);

  // The catalog's own copy wins when the page happens to have it — it carries the genre, the
  // description and the rest that a poster and a title cannot supply.
  const movie: MovieEvent =
    known ??
    ({
      ...SAMPLE_MOVIES[0],
      id: order.eventSlug,
      title: order.eventTitle,
      imageUrl: order.eventImageUrl ?? "",
      venueName: order.venueName,
      city: order.city,
      location: order.venueName,
      dates: [iso],
      times: [time],
    } as MovieEvent);

  return {
    id: String(order.id),
    movie,
    selectedDate: iso,
    selectedTime: time,
    selectedSeats: order.tickets.map((ticket, index) => ({
      id: ticket.seatLabel ?? ticket.tierLabel,
      row: ticket.seatLabel?.[0] ?? "",
      number: index + 1,
      type: "single" as const,
      price: ticket.unitPriceAmount,
      isBooked: true,
    })),
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    totalPrice: order.totalAmount,
    serviceFee: 0,
    discount: 0,
    finalPrice: order.totalAmount,
    paymentMethod: "Ví TixHub",
    deliveryChannel: "email_sms",
    // A refunded order is one the holder can no longer use, which is what `cancelled` means to them.
    status: order.status === "paid" ? "paid" : "cancelled",
    qrStatus: order.tickets.some((t) => t.status === "used") ? "checked_in" : "unused",
    bookingTime: startsAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    qrPayload: order.tickets[0]?.ticketCode ?? "",
  };
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>("home");
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [selectedMovie, setSelectedMovie] = useState<MovieEvent>(SAMPLE_MOVIES[0]);
  const [heroMovie, setHeroMovie] = useState<MovieEvent>(SAMPLE_MOVIES[0]);
  const [events, setEvents] = useState<MovieEvent[]>([]);
  /**
   * The trending row, in the order an Admin put it in (`featured_events`, UC-35).
   *
   * Kept apart from `events` rather than derived from it, because the ordering is the whole point
   * and `events` arrives in the catalogue's own order. Nothing else on the page reads it.
   */
  const [trendingEvents, setTrendingEvents] = useState<MovieEvent[]>([]);
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  /**
   * The three list filters, each as the set of values in force. Empty means the filter is off.
   *
   * Empty rather than a `"all"` sentinel: the sentinel would have to be excluded from every
   * membership test, and "everything" would then be sayable two ways — the token, or all four
   * members ticked — that behave identically and look different.
   */
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeDate, setActiveDate] = useState<DateFilter>(null);
  const [activeCities, setActiveCities] = useState<string[]>([]);
  /**
   * The price ceiling, or `null` for no ceiling at all.
   *
   * Null rather than a large opening number, because there is no such thing as a price too high to
   * exist: `ticket_types.price_amount` is a bare `BIGINT` and the organizer API only refuses
   * negatives, so any figure picked here would be a guess that quietly filters out every event
   * above it. The catalog's own dearest ticket is what the slider opens on (see `priceCeiling`), and
   * until the reader moves it nothing is excluded.
   */
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [availabilities, setAvailabilities] = useState<string[]>([]);

  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  /**
   * The one live hold. Owned here, not by the seat picker, because the seat picker unmounts the
   * moment the buyer steps into checkout — which is exactly what used to wipe the selection and
   * restart the countdown when they stepped back.
   */
  const [hold, setHold] = useState<HoldSession | null>(loadHoldSession);
  /** The showtime the flow is buying — what the hold API locks against. */
  const [bookingShowtimeId, setBookingShowtimeId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(0);
  /** The question on screen; its pending answer lives in a ref so no render can strand it. */
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const pendingConfirmRef = useRef<((answer: boolean) => void) | null>(null);
  /** The hold ran out and the buyer has not acknowledged it yet — see `HoldExpiredDialog`. */
  const [holdExpiredNotice, setHoldExpiredNotice] = useState(false);
  /** A hold/release round trip is in flight; seat clicks are disabled so two do not race. */
  const [holdBusy, setHoldBusy] = useState(false);
  const [finalBooking, setFinalBooking] = useState<Booking | null>(null);
  /** The server's numbers from a rejected checkout, handed to the top-up sheet (UC-12 A2). */
  const [shortfall, setShortfall] = useState<{
    required: number;
    balance: number;
    shortfall: number;
  } | null>(null);

  const [bookingsHistory, setBookingsHistory] = useState<Booking[]>([]);
  const [wishlistedIds, setWishlistedIds] = useState<string[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userName, setUserName] = useState("");
  const [isSignedIn, setIsSignedIn] = useState(false);
  /*
   * What this account is allowed to see in the nav.
   *
   * Both come from the server on every identity read — `isOrganizer` is derived per request from an
   * *approved* organizers row, so a pending or rejected application does not open the door. These
   * only decide what is offered: every route behind them is enforced server-side regardless, since
   * hiding a link is not access control (Principle II, SEC-04).
   */
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOrganizer, setIsOrganizer] = useState(false);
  /** Whether `authClient.restore()` has answered yet. See the restore effect below. */
  const [authReady, setAuthReady] = useState(false);
  /**
   * What the visitor was trying to do when we stopped them to sign in. Browsing, picking a showtime
   * and choosing seats are all open to guests; only the step that creates an order needs an
   * identity, so the click is parked here and replayed once they are in.
   */
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(getInitialAvatar);
  /** Only ever used to seed the default avatar's colour — never displayed in the header. */
  const [userEmail, setUserEmail] = useState<string | null>(getInitialEmail);

  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Move to a screen and put it on the address bar, in that order and in one place.
   *
   * Navigation is explicit rather than derived from `activeScreen` by an effect: the screens that
   * carry a parameter (`/events/:slug`, `/tickets/:id`) know it at the call site, while an effect
   * would have to read it back out of state that is still catching up — and would push the stale
   * value over a deep link before the URL had been read.
   *
   * Every move also returns to the top of the page. Nothing here is a scroll container, so without
   * it a new screen inherits the last one's scroll position: opening "Về chúng tôi" from the footer
   * — which is at the very bottom of a long landing page — landed on the legal page already scrolled
   * past its own heading, as did every other link down there. Call sites that needed this used to
   * ask for it one at a time, and the ones nobody had tried simply did not.
   */
  const goTo = useCallback(
    (screen: Screen, params?: { eventSlug?: string | null; bookingId?: string | null }) => {
      setActiveScreen(screen);
      navigate(screenToPath(screen, params));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [navigate],
  );

  const activeScreenRef = useLatest(activeScreen);
  const selectedMovieRef = useLatest(selectedMovie);
  const bookingShowtimeIdRef = useLatest(bookingShowtimeId);
  const finalBookingRef = useLatest(finalBooking);
  const bookingsHistoryRef = useLatest(bookingsHistory);
  /*
   * Read by the ticket loader, which must not re-run when the catalog arrives.
   *
   * The catalog only enriches a rebuilt booking — it supplies the genre and description a server
   * order does not carry. Listing `events` as a dependency would refetch every ticket the moment
   * the catalog landed, for a detail nothing on the list even prints.
   */
  const eventsRef = useLatest(events);

  /** An overlay route (see routes.ts): the address bar is the only state the account page needs. */
  const showAccountPage = location.pathname === ACCOUNT_PATH;

  /**
   * True once the cached history has been read out of localStorage. `/tickets/:id` cannot decide
   * that a booking is missing before then — on the first frame the list is empty for everyone, and
   * bouncing off it would break every ticket link.
   */
  const [bookingsLoaded, setBookingsLoaded] = useState(false);

  /**
   * The event slug the browser arrived on, if any. Captured once, because the catalog listing
   * resolves later and ends by selecting its first event — which would otherwise overwrite the
   * event the URL actually asked for.
   */
  const deepLinkedEventRef = useRef<string | null>(
    pathToRoute(window.location.pathname)?.eventSlug ?? null,
  );

  /**
   * The payload the event SEO tags were built from. Kept so stepping back onto the event screen can
   * restore them without another round trip — the tags are removed on the way out, and the buyer
   * returning from checkout does not re-fetch the detail.
   */
  const eventSeoRef = useRef<{
    slug: string;
    detail: CatalogEventDetail;
    showtimes: Showtime[];
  } | null>(null);

  /**
   * Single entry point for what the header shows about the account, so state and cache can never
   * drift apart. Passing `null` is the signed-out case and clears everything.
   */
  const applyIdentity = useCallback((user: Me | null) => {
    const name = user ? user.nickname || user.email : "";
    setUserName(name);
    // Roles ride along with the identity rather than being fetched separately, so they cannot lag
    // behind a sign-out and leave an admin link on screen for a visitor.
    setIsAdmin(user?.isAdmin ?? false);
    setIsOrganizer(user?.isOrganizer ?? false);
    setAvatarUrl(user?.avatarUrl ?? null);
    setUserEmail(user?.email ?? null);
    cacheValue(USER_CACHE_KEY, name || null);
    cacheValue(AVATAR_CACHE_KEY, user?.avatarUrl ?? null);
    cacheValue(EMAIL_CACHE_KEY, user?.email ?? null);
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    void aiClient
      .bookmarks()
      .then(setWishlistedIds)
      .catch(() => {});
  }, [isSignedIn]);

  /*
   * The tickets, from the account rather than from the browser.
   *
   * They used to exist only in `localStorage`, written at checkout and never read from anywhere
   * else — so a purchase made on a phone was invisible on a laptop, and clearing site data wiped
   * the only copy the buyer could see while the wallet, which reads the server, still showed the
   * debit. The database always held the order; there was no endpoint to ask for the list.
   *
   * The cache stays, one step down: it is what paints the page on the first frame and what survives
   * an offline reload. The server overwrites it as soon as it answers, so a stale local copy can
   * never outlive the truth.
   *
   * A failure is left alone deliberately. Whatever the cache holds is better than an empty page,
   * and a network blip should not read as "your tickets are gone".
   */
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    void walletClient
      .orders()
      .then((orders) => {
        if (cancelled) return;
        const catalog = new Map(eventsRef.current.map((event) => [event.id, event]));
        const rebuilt = orders.map((order) =>
          bookingFromOrder(order, catalog.get(order.eventSlug)),
        );
        setBookingsHistory(rebuilt);
        try {
          localStorage.setItem(BOOKINGS_CACHE_KEY, JSON.stringify(rebuilt));
        } catch (err) {
          console.error("Failed to cache the ticket list:", err);
        }
      })
      .catch((err) => console.error("Failed to load tickets from the server:", err));
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** Show an in-app notification. Non-blocking, so the map stays visible behind it. */
  const pushToast = useCallback(
    (kind: ToastKind, text: string, ttlMs = 5000) => {
      const id = (toastSeq.current += 1);
      // Keep the stack short: three at once is already a lot to read.
      setToasts((current) => [...current.slice(-2), { id, kind, text }]);
      window.setTimeout(() => dismissToast(id), ttlMs);
    },
    [dismissToast],
  );

  /**
   * `window.confirm` as a promise, answered by the in-app dialog. Keeps every caller reading like
   * the blocking version it replaced (`if (await askConfirm(...))`) instead of splintering each
   * guard into callbacks.
   */
  const askConfirm = useCallback((request: ConfirmRequest): Promise<boolean> => {
    return new Promise((resolve) => {
      // A question superseded by another is answered "no": the guard that asked it must not hang,
      // and declining is always the safe outcome here.
      pendingConfirmRef.current?.(false);
      pendingConfirmRef.current = resolve;
      setConfirmRequest(request);
    });
  }, []);

  const answerConfirm = useCallback((answer: boolean) => {
    pendingConfirmRef.current?.(answer);
    pendingConfirmRef.current = null;
    setConfirmRequest(null);
  }, []);

  const bookingSeats = hold?.seats ?? [];
  const bookingTotalPrice = holdTotalPrice(bookingSeats);
  const inFlow = FLOW_SCREENS.includes(activeScreen);

  // Mirrors `hold` for callbacks that must read it without being re-created on every tick.
  const holdRef = useRef<HoldSession | null>(hold);
  useEffect(() => {
    holdRef.current = hold;
    saveHoldSession(hold);
  }, [hold]);

  /**
   * Give the seats back to everyone else. The server is the one that actually frees them, so a
   * failure here is logged rather than swallowed silently — the TTL is the backstop either way.
   */
  const releaseHold = useCallback(async (session: HoldSession) => {
    setHold(null);
    try {
      await holdsClient.cancel(session.reservationId);
    } catch (e) {
      console.error("Failed to release the hold (the TTL will):", e);
    }
  }, []);

  const handleHoldExpired = useCallback(() => {
    const expired = holdRef.current;
    setHold(null);
    if (!expired) return;

    // UC-11 A2: the whole selection lapses together and the buyer is returned to pick again.
    // Announced by a modal rather than a toast — the selection is gone and the flow has moved the
    // buyer off checkout, which is too large a change to leave in a corner that fades on its own.
    const current = activeScreenRef.current;
    if (current === "seats" || current === "checkout") {
      goTo(expired.mode === "ga" ? "detail" : "seats", { eventSlug: expired.eventId });
    }
    setHoldExpiredNotice(true);
  }, [activeScreenRef, goTo]);

  const holdRemainingMs = useHoldCountdown(hold?.expiresAt ?? null, handleHoldExpired);

  // A reload or a closed tab is also an exit from the flow — warn before the hold is dropped.
  useEffect(() => {
    if (!hold) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hold]);

  // Password-reset deep link (/reset-password?token=…), rendered as a full-page overlay over
  // whatever screen is mounted underneath.
  const resetToken = useMemo(
    () =>
      location.pathname === RESET_PASSWORD_PATH
        ? new URLSearchParams(location.search).get("token")
        : null,
    [location.pathname, location.search],
  );

  // Where VNPay drops the browser after a top-up — another overlay route. Nothing in the query
  // string is trusted: the wallet is credited by the IPN, so the screen asks the server what really
  // happened (UC-13 A6).
  const onVnpayReturn = location.pathname === VNPAY_RETURN_PATH;

  const finishVnpayReturn = (topup: Topup | null) => {
    /** Leaves the overlay for a real screen. `replace` so Back never re-enters the return page. */
    const leaveTo = (screen: Screen) => {
      setActiveScreen(screen);
      navigate(screenToPath(screen), { replace: true });
    };

    if (topup?.status === "paid") {
      pushToast("success", "Đã nạp tiền vào ví.");
      // Straight back to the checkout they left, if the hold outlived the detour (UC-40 step 6).
      if (topup.reservationId !== null && hold?.reservationId === topup.reservationId) {
        setShortfall(null);
        leaveTo("checkout");
        return;
      }
      if (topup.reservationId !== null) {
        pushToast(
          "warning",
          "Chỗ giữ đã hết hạn khi bạn thanh toán. Tiền vẫn ở trong ví — mời chọn lại chỗ.",
          9000,
        );
      }
    }
    leaveTo("wallet");
  };

  /**
   * Closing the account overlay drops back onto the screen underneath rather than out of the app —
   * `navigate(-1)` would leave the site entirely when `/account` was opened from a bookmark.
   */
  const closeAccountPage = useCallback(() => {
    navigate(
      screenToPath(activeScreen, {
        eventSlug: selectedMovie.id,
        bookingId: finalBooking?.id,
      }),
      { replace: true },
    );
  }, [activeScreen, finalBooking?.id, navigate, selectedMovie.id]);

  /**
   * Loads an event the URL named directly — the same two calls a card click makes, minus the
   * optimistic paint: arriving cold there is no card data to show first.
   */
  const openEventBySlug = useCallback(
    async (slug: string) => {
      try {
        const detail = await catalogClient.getEvent(slug);
        const loaded = await catalogClient.getShowtimes(detail.id);
        setSelectedMovie(detailToMovie(detail, loaded));
        setShowtimes(loaded);
        eventSeoRef.current = { slug, detail, showtimes: loaded };
        applyEventSeo(detail, loaded);
      } catch (e) {
        // Same dev-only fallback as the listing: with no API server the samples are the catalog, so
        // an event link has to resolve against them or every deep link bounces home while working
        // on the UI. In production a slug the API does not know is simply not an event.
        const sample = import.meta.env.DEV
          ? SAMPLE_MOVIES.find((movie) => movie.id === slug)
          : undefined;
        if (sample) {
          setSelectedMovie(sample);
          setShowtimes([]);
          return;
        }
        console.error("Failed to open the event named by the URL:", e);
        navigate("/", { replace: true });
      }
    },
    [navigate],
  );

  /**
   * URL → screen. The one automatic direction: it runs on Back/Forward and on a cold deep link,
   * where the address bar is the only thing that knows what to show.
   *
   * A screen whose data the path cannot carry either recovers it here or redirects somewhere
   * honest. None of them is allowed to render empty because the buyer pressed F5.
   *
   * Kept off `hold` / `selectedMovie` / `bookingsHistory` as dependencies on purpose — this reacts
   * to the address bar, not to the flow. `bookingsLoaded` is the exception: the ticket lookup below
   * genuinely cannot answer before the cache has been read.
   */
  useEffect(() => {
    if (isOverlayPath(location.pathname)) return;

    const route = pathToRoute(location.pathname);
    if (!route) {
      navigate("/", { replace: true });
      return;
    }

    if (route.eventSlug && route.eventSlug !== selectedMovieRef.current.id) {
      deepLinkedEventRef.current = route.eventSlug;
      void openEventBySlug(route.eventSlug);
    }

    // The seat map needs a showtime, which the path does not name. A live hold knows which one;
    // without it the buyer has to pick a suất again.
    if (route.screen === "seats" && bookingShowtimeIdRef.current === null) {
      const held = holdRef.current;
      if (held && held.eventId === route.eventSlug) {
        setBookingShowtimeId(held.showtimeId);
        setBookingDate(held.selectedDate);
        setBookingTime(held.selectedTime);
      } else {
        navigate(screenToPath("detail", { eventSlug: route.eventSlug }), { replace: true });
        return;
      }
    }

    // Checkout without a hold has nothing to pay for.
    if (route.screen === "checkout" && !holdRef.current) {
      navigate("/", { replace: true });
      return;
    }

    if (route.screen === "ticket" && route.bookingId) {
      if (finalBookingRef.current?.id !== route.bookingId) {
        if (!bookingsLoaded) return; // the cache decides; until then leave the screen as it was
        const found = bookingsHistoryRef.current.find((b) => b.id === route.bookingId);
        if (!found) {
          navigate("/bookings", { replace: true });
          return;
        }
        setFinalBooking(normalizeBooking(found));
      }
    }

    setActiveScreen(route.screen);
  }, [location.pathname, bookingsLoaded, navigate, openEventBySlug]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_CACHE_KEY, theme);
    } catch (err) {
      console.error("Failed to save TixHub theme:", err);
    }
  }, [theme]);

  useEffect(() => {
    try {
      const cachedBookings =
        localStorage.getItem(BOOKINGS_CACHE_KEY) ||
        LEGACY_BOOKINGS_CACHE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
      const cachedWishlist =
        localStorage.getItem(WISHLIST_CACHE_KEY) || localStorage.getItem(LEGACY_WISHLIST_CACHE_KEY);
      const cachedUser =
        localStorage.getItem(USER_CACHE_KEY) || localStorage.getItem(LEGACY_USER_CACHE_KEY);

      if (cachedBookings) {
        const parsed = JSON.parse(cachedBookings);
        if (Array.isArray(parsed)) {
          setBookingsHistory(parsed.map(normalizeBooking));
        }
      }

      if (cachedWishlist) {
        const parsedWishlist = JSON.parse(cachedWishlist);
        if (Array.isArray(parsedWishlist)) {
          setWishlistedIds(parsedWishlist);
        }
      }

      if (cachedUser) {
        setUserName(cachedUser);
      }
    } catch (err) {
      console.error("Failed to read local TixHub cache:", err);
    } finally {
      // Even a failed read is an answer: /tickets/:id must stop waiting and decide.
      setBookingsLoaded(true);
    }
  }, []);

  // Restore a real session from the httpOnly refresh cookie (reconciles the optimistic
  // cached identity above). Signed out → clear the display.
  useEffect(() => {
    authClient
      .restore()
      .then((user) => {
        setIsSignedIn(Boolean(user));
        applyIdentity(user);
      })
      .catch(() => {})
      // Even a failed restore is an answer. Screens that require an identity must be able to tell
      // "not signed in" from "not known yet", or a reload of /wallet flashes a sign-in prompt at
      // someone who is already signed in.
      .finally(() => setAuthReady(true));
  }, [applyIdentity]);

  // Load the real catalog (replaces the mock browse source). Maps API cards → MovieEvent.
  useEffect(() => {
    /*
     * Dev-only: with no API server (or an unseeded database) the browse grid renders empty, which
     * makes the whole home screen impossible to work on. Fall back to the bundled samples so the UI
     * always has something to draw. Gated on `import.meta.env.DEV` on purpose — in production an
     * empty catalog is real information and must not be papered over with fixtures.
     */
    /**
     * The listing ends by selecting its first event as the default. When the browser arrived on
     * `/events/:slug` that default must not win — the URL already named which event to show, and
     * its own fetch may still be in flight.
     */
    const selectDefault = (movie: MovieEvent) => {
      if (deepLinkedEventRef.current) return;
      setSelectedMovie(movie);
    };

    const useSamplesInDev = (reason: string) => {
      if (!import.meta.env.DEV) return;
      console.warn(`Catalog ${reason}; falling back to SAMPLE_MOVIES (dev only).`);
      setEvents(SAMPLE_MOVIES);
      setHeroMovie(SAMPLE_MOVIES[0]);
      selectDefault(SAMPLE_MOVIES[0]);
    };

    catalogClient
      .listAllEvents()
      .then((cards) => {
        const mapped = cards.map(cardToMovie);
        if (mapped.length === 0) {
          useSamplesInDev("returned no events");
          return;
        }
        setEvents(mapped);
        setHeroMovie(mapped[0]);
        selectDefault(mapped[0]);
      })
      .catch((err) => {
        console.error("Failed to load catalog:", err);
        useSamplesInDev("request failed");
      });
  }, []);

  /*
   * The curated trending row — the moving band under the hero, and nothing else on the page.
   *
   * Its own request, because its order is editorial and the browse listing cannot carry it. An event
   * whose showtimes are all behind it is dropped here rather than server-side: the curation is a
   * list of events, and "hot sắp/đang diễn ra" is a property of the moment, not of the choice an
   * Admin made weeks ago.
   *
   * Ten, because that is what the band is: an editorial shortlist. The API allows fifty entries, so
   * the cap belongs on the reading side — a console that let an Admin add an eleventh and then never
   * showed it would be worse than one that refuses.
   */
  useEffect(() => {
    catalogClient
      .featuredEvents()
      .then((cards) => {
        const upcoming = cards
          .map(cardToMovie)
          .filter((movie) => movie.status !== "finished")
          .slice(0, TRENDING_COUNT);
        if (upcoming.length === 0 && import.meta.env.DEV) {
          setTrendingEvents(SAMPLE_MOVIES.slice(0, TRENDING_COUNT));
          return;
        }
        setTrendingEvents(upcoming);
      })
      .catch((err) => {
        console.error("Failed to load the curated trending row:", err);
        // Same dev-only reasoning as the catalog above: with no API server the landing page would
        // otherwise lose its first band entirely and be impossible to work on.
        if (import.meta.env.DEV) setTrendingEvents(SAMPLE_MOVIES.slice(0, TRENDING_COUNT));
      });
  }, []);

  /** The landing page's four bands. Unfiltered — the landing page no longer carries any filter. */
  const landingSections = useMemo(() => buildLandingSections(events), [events]);

  /**
   * The bookmarked events, in the order the catalog holds them.
   *
   * Derived from `events` rather than fetched, because `wishlistedIds` is a list of slugs and the
   * cards need whole events — and the catalog is already in memory for the browse page. The cost is
   * that a bookmark whose event has since been hidden simply does not appear, which is the right
   * outcome anyway: the API would not return it either.
   */
  const savedEvents = useMemo(
    () => events.filter((event) => wishlistedIds.includes(event.id)),
    [events, wishlistedIds],
  );

  /*
   * What the nav's search dropdown shows while the reader types.
   *
   * Deliberately off `events` rather than off `filteredEvents`: the box is asked a question about
   * the whole catalogue, and answering it through whatever filters happen to be set on `/events`
   * would hide matching events for reasons the reader cannot see from the nav.
   */
  const searchMatchCount = useMemo(
    () =>
      searchQuery.trim() ? events.filter((event) => matchesQuery(event, searchQuery)).length : 0,
    [events, searchQuery],
  );

  const searchSuggestions = useMemo(
    () =>
      searchEvents(events, searchQuery, SEARCH_SUGGESTION_COUNT).map((event) => ({
        id: event.id,
        title: event.title,
        imageUrl: event.imageUrl,
        meta: [event.dates[0] && formatEventDate(event.dates[0], true), event.city, event.venueName]
          .filter(Boolean)
          .join(" · "),
        price: event.price > 0 ? formatVnd(event.price) : "",
      })),
    [events, searchQuery],
  );

  /**
   * Everything that survives every filter except the price one.
   *
   * Split out because the price slider's far end is the dearest of *these*, and the price filter
   * cannot be one of the things that decides it — drag the ceiling down, the dearest survivor drops
   * with it, the rule shrinks to match, and the thumb is at the far end again with more to cut. The
   * filter has to be excluded from its own scale or it eats itself.
   */
  const eventsBeforePriceFilter = useMemo(() => {
    return events.filter((movie) => {
      /*
       * The same test the nav's dropdown runs, imported rather than written twice.
       *
       * It was written out here, accent-sensitive and lowercase-only, which is now a difference
       * that shows: the dropdown offers a row, the reader presses "Xem tất cả", and the grid it
       * lands on is missing the very event they were pointing at.
       */
      const matchesSearch = matchesQuery(movie, searchQuery);
      const matchesCategory =
        activeCategories.length === 0 || activeCategories.includes(movie.category);
      const matchesDate = matchesDateFilter(movie.dates, activeDate);
      const matchesCity = activeCities.length === 0 || activeCities.includes(movie.city);
      const matchesAvailability =
        availabilities.length === 0 || availabilities.includes(movie.status);

      return matchesSearch && matchesCategory && matchesDate && matchesCity && matchesAvailability;
    });
  }, [events, activeCategories, activeCities, activeDate, availabilities, searchQuery]);

  /**
   * How far the price slider reaches: the dearest ticket still on the table.
   *
   * Read off the events rather than written down, because nothing in the system caps a price —
   * `ticket_types.price_amount` is an unconstrained `BIGINT` and the organizer API refuses only
   * negatives and fractions. Any number hardcoded here would be a guess, and the day an event was
   * listed above it the slider would bottom out with no way to reach the top of the catalog.
   *
   * Taken from the other filters' survivors, so the rule always spans exactly the prices that are
   * still reachable. The cost is that narrowing by city or by date rescales it, and a ceiling set
   * before that narrowing lands somewhere else on the rule afterwards — the number is unchanged,
   * the ruler under it is not.
   */
  const priceCeiling = useMemo(() => {
    const dearest = eventsBeforePriceFilter.reduce(
      (top, evt) => (evt.price > top ? evt.price : top),
      0,
    );
    // A span of zero has no fractions in it, so the rule needs *something* until the catalog lands.
    return dearest > 0 ? dearest : PRICE_CEILING_BEFORE_CATALOG;
  }, [eventsBeforePriceFilter]);

  const filteredEvents = useMemo(
    () => eventsBeforePriceFilter.filter((movie) => maxPrice === null || movie.price <= maxPrice),
    [eventsBeforePriceFilter, maxPrice],
  );

  /**
   * The date filter's options, taken from the catalog itself. They are compared verbatim against
   * `movie.dates`, so they have to be the same ISO strings the events carry — a hand-maintained list
   * drifts out of date and quietly filters everything away.
   */
  const dateOptions = useMemo(
    () => [...new Set(events.flatMap((event) => event.dates))].sort(),
    [events],
  );

  /*
   * The categories this catalogue actually contains, most populous first.
   *
   * Derived, like the dates above, because the alternative was tried and failed silently: a fixed
   * list of three could not describe a catalogue of a dozen, so "Phim" matched nothing and "Ca nhạc"
   * matched everything the adapter had quietly relabelled — 461 events of 503. A list built from
   * the events themselves cannot drift from them.
   */
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, { id: string; label: string; n: number }>();
    for (const event of events) {
      if (!event.category) continue;
      const seen = counts.get(event.category);
      if (seen) seen.n += 1;
      else
        counts.set(event.category, {
          id: event.category,
          label: event.categoryLabel || event.category,
          n: 1,
        });
    }
    /*
     * Most populous first, except "Khác", which is last however many events it holds.
     *
     * It is the catalogue's catch-all, so it names nothing: a reader scanning the list for what they
     * want can skip it, and a list that ends in it reads as complete where one that opens with it
     * reads as unsorted.
     */
    return [...counts.values()]
      .sort((a, b) => {
        const catchAllA = isCatchAllCategory(a.id, a.label);
        const catchAllB = isCatchAllCategory(b.id, b.label);
        if (catchAllA !== catchAllB) return catchAllA ? 1 : -1;
        return b.n - a.n || a.label.localeCompare(b.label, "vi");
      })
      .map(({ id, label }) => ({ id, label }));
  }, [events]);

  const relatedEvents = useMemo(() => {
    return events
      .filter((event) => {
        if (event.id === selectedMovie.id) return false;
        return (
          event.category === selectedMovie.category ||
          event.genre.some((genre) => selectedMovie.genre.includes(genre))
        );
      })
      .slice(0, 3);
  }, [events, selectedMovie]);

  /**
   * Asks before an action that leaves the booking flow, and releases the hold if the buyer accepts.
   * Anything inside the flow (stepping between suất / ghế / thanh toán) must NOT go through here —
   * that is the whole point: the hold survives every move within the three screens.
   */
  const confirmLeaveFlow = async (): Promise<boolean> => {
    if (!hold || !inFlow) return true;
    const leaving = await askConfirm({
      title: "Thoát khỏi quy trình đặt vé?",
      message: LEAVE_FLOW_WARNING,
      confirmLabel: "Thoát và hủy giữ chỗ",
      cancelLabel: "Ở lại",
      tone: "danger",
    });
    // Leaving the flow releases the seats server-side, so they are back on sale immediately rather
    // than sitting held until the TTL sweeps them.
    if (leaving) void releaseHold(hold);
    return leaving;
  };

  const leaveFlow = async (action: () => void) => {
    if (await confirmLeaveFlow()) action();
  };

  /** Set when the buyer declines the exit prompt, so typing in the search box cannot re-ask per key. */
  const exitDeclinedRef = useRef(false);
  useEffect(() => {
    exitDeclinedRef.current = false;
  }, [hold?.expiresAt, activeScreen]);

  /**
   * Event SEO belongs to the event screens and nowhere else. One effect owns it rather than each
   * exit remembering to clean up: every screen is a shareable URL now, so a leftover title, og: tag
   * or Event JSON-LD would advertise /wallet or /bookings as somebody's concert.
   */
  useEffect(() => {
    const onEventScreen = activeScreen === "detail" || activeScreen === "seats";
    if (!onEventScreen) {
      clearEventSeo();
      return;
    }
    // Returning from checkout does not re-fetch the detail, so re-apply what was already loaded.
    const cached = eventSeoRef.current;
    if (cached && cached.slug === selectedMovie.id) applyEventSeo(cached.detail, cached.showtimes);
  }, [activeScreen, selectedMovie.id]);

  const goHome = () => {
    void leaveFlow(() => {
      deepLinkedEventRef.current = null;
      goTo("home");
    });
  };

  /**
   * Apply a filter (or a search) and make sure the reader can see what it did.
   *
   * `/events` is the only screen with a grid on it now — the landing page is a stack of curated
   * bands and carries no filter of its own — so every filter change lands there. It used to land on
   * `/` because `/` was also a grid; a query typed into the nav from the landing page would now
   * change a list nobody was looking at.
   */
  const goCatalogAfterFilter = async (update: () => void) => {
    // The filter itself always applies; only the jump to the catalog leaves the flow.
    update();
    // Already on the screen the filter acts on: nothing to leave, nothing to navigate to.
    if (activeScreen === "browse") return;
    if (hold && inFlow) {
      if (exitDeclinedRef.current) return;
      if (!(await confirmLeaveFlow())) {
        exitDeclinedRef.current = true;
        return;
      }
    }
    deepLinkedEventRef.current = null;
    goTo("browse");
  };

  /**
   * A landing band's "Xem thêm": the catalog, filtered to exactly the categories that band drew
   * from. The band and the listing therefore ask the same question — the codes come from the same
   * grouping, not from a second list written by hand.
   */
  const openCategorySection = (codes: string[]) => {
    void leaveFlow(() => {
      setActiveCategories(codes);
      goTo("browse");
    });
  };

  const saveBookingToHistory = (newBooking: Booking) => {
    const updated = [newBooking, ...bookingsHistory];
    setBookingsHistory(updated);
    try {
      localStorage.setItem(BOOKINGS_CACHE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error("Failed to save bookings history:", err);
    }
  };

  const handleToggleWishlist = async (eventId: string) => {
    if (!isSignedIn) {
      pushToast("warning", "Đăng nhập để lưu sự kiện và nhận gợi ý cá nhân hóa.");
      return;
    }
    try {
      const { saved } = await aiClient.bookmark(eventId);
      setWishlistedIds((current) => {
        const next = saved
          ? current.includes(eventId)
            ? current
            : [...current, eventId]
          : current.filter((id) => id !== eventId);
        try {
          localStorage.setItem(WISHLIST_CACHE_KEY, JSON.stringify(next));
        } catch (err) {
          console.error("Failed to save wishlist:", err);
        }
        return next;
      });
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Không thể lưu sự kiện.");
    }
  };
  const handleSelectEventForTrailer = (movie: MovieEvent) => {
    setHeroMovie(movie);
    const heroSection = document.getElementById("hero-trailer-section");
    if (heroSection) {
      heroSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleStartBookingInput = async (movie: MovieEvent) => {
    // Opening a different event abandons the current hold, so it needs the same warning.
    if (hold && hold.eventId !== movie.id && !(await confirmLeaveFlow())) return;

    setSelectedMovie(movie); // optimistic (card data)
    setShowtimes([]);
    deepLinkedEventRef.current = movie.id;
    goTo("detail", { eventSlug: movie.id });
    // enrich with full detail from the API (movie.id carries the event slug)
    catalogClient
      .getEvent(movie.id)
      .then(async (detail) => {
        const loaded = await catalogClient.getShowtimes(detail.id);
        setSelectedMovie(detailToMovie(detail, loaded));
        setShowtimes(loaded);
        eventSeoRef.current = { slug: movie.id, detail, showtimes: loaded };
        applyEventSeo(detail, loaded);
      })
      .catch((err) => console.error("Failed to load event detail:", err));
  };

  // Picking a seat places a hold, and a hold needs an owner — no anonymous holds (schema note,
  // UC-11). So seat selection is the sign-in gate for a seated event; after signing in the visitor
  // lands on the seat picker, not back on the event page.
  const handleProceedToSeats = (showtimeId: number | null, date: string, time: string) => {
    runSignedIn(async () => {
      // One hold per buyer per showtime (FR-011): moving to another suất releases the old one, and
      // the release goes to the server so the seats actually return to inventory for everyone.
      if (hold && hold.showtimeId !== showtimeId) {
        const switching = await askConfirm({
          title: "Đổi sang suất khác?",
          message:
            "Bạn đang giữ chỗ cho một suất khác. Chọn suất này sẽ hủy chỗ đang giữ và trả ghế lại " +
            "cho người khác.",
          confirmLabel: "Đổi suất",
          cancelLabel: "Giữ suất cũ",
          tone: "danger",
        });
        if (!switching) return;
        await releaseHold(hold);
      }

      setBookingDate(date);
      setBookingTime(time);
      setBookingShowtimeId(showtimeId);
      goTo("seats", { eventSlug: selectedMovie.id });

      // A returning owner must see their own live holds, not an empty map (FR-022).
      if (showtimeId !== null && !hold) {
        try {
          const active = await holdsClient.active(showtimeId);
          if (active) {
            setHold(
              sessionFromReservation(active, {
                eventId: selectedMovie.id,
                eventTitle: selectedMovie.title,
                selectedDate: date,
                selectedTime: time,
                mode: "seated",
              }),
            );
          }
        } catch (e) {
          console.error("Failed to restore an active hold:", e);
        }
      }
    });
  };

  /**
   * Every way out of a step, once the order exists: cancel it.
   *
   * Going back used to keep the hold and let the buyer return to it, which meant a selection
   * could be half-committed on the server while the buyer was three screens away editing it.
   * The rule now is the one the ticketing sites use, and it is simpler to hold in the head:
   * forward commits, backward cancels. One way to take seats or tickets, one way to stop.
   *
   * Nothing to cancel — the buyer stepped back off the very first screen — is not a question
   * worth asking, so the confirmation only appears when a hold actually exists.
   */
  const confirmCancelOrder = () =>
    askConfirm({
      title: "Hủy đơn hàng?",
      message: "Bạn có chắc chắn muốn tiếp tục?\nBạn sẽ mất vị trí mình đã lựa chọn.",
      confirmLabel: "Hủy đơn",
      cancelLabel: "Giữ đơn",
      tone: "danger",
    });

  /** Forget the showtime the flow was working on. The server side is `releaseHold`. */
  const clearBookingSelection = () => {
    setBookingShowtimeId(null);
    setBookingDate("");
    setBookingTime("");
  };

  /**
   * Where the address bar was, so a backward move can be told from a forward one.
   *
   * Only the flow screens are ranked. Anything outside the purchase is 0, which makes "left the
   * flow entirely" the same kind of move as "went back a step" — both release the hold.
   */
  const flowRank = (path: string): number => {
    const route = pathToRoute(path);
    if (!route) return 0;
    if (route.screen === "detail") return 1;
    if (route.screen === "seats") return 2;
    if (route.screen === "checkout") return 3;
    return 0;
  };
  const lastFlowPathRef = useRef(location.pathname);
  /** True while a restore navigation is in flight, so the guard does not react to its own undo. */
  const restoringRef = useRef(false);

  /**
   * The browser's back button, held to the same rule as the in-app one.
   *
   * Cancelling on the back *link* only was a rule the buyer could step around without meaning to:
   * a browser back out of checkout left the seats held on the server with no screen left showing
   * them, and they stayed held until the TTL swept them. The address bar is a way out of the flow
   * whoever pressed it.
   *
   * It cannot be intercepted before the fact — by the time React hears about it the history entry
   * has already moved — so a refusal is undone by navigating forward again rather than by
   * preventing the move. `restoringRef` stops that undo from reading as a new backward move.
   */
  useEffect(() => {
    const from = lastFlowPathRef.current;
    const to = location.pathname;
    lastFlowPathRef.current = to;

    if (restoringRef.current) {
      restoringRef.current = false;
      return;
    }
    if (isOverlayPath(to) || from === to) return;

    const live = holdRef.current;
    // Only a *backward* move out of a step that had something held. Going deeper into the flow, or
    // moving around outside it, is not a cancel.
    if (!live || flowRank(from) < 2 || flowRank(to) >= flowRank(from)) return;

    void (async () => {
      if (await confirmCancelOrder()) {
        await releaseHold(live);
        clearBookingSelection();
        return;
      }
      // Kept: put the buyer back where they were. `replace` so the declined step does not pile a
      // second entry onto the history they just used.
      restoringRef.current = true;
      lastFlowPathRef.current = from;
      navigate(from, { replace: true });
    })();
    // `location.pathname` is the whole trigger; the rest are stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const cancelBookingFlow = async () => {
    const live = holdRef.current;

    if (live) {
      if (!(await confirmCancelOrder())) return;
      await releaseHold(live);
    }

    // Back to the first step carrying nothing. The selection is gone on the server, so leaving
    // it on screen would offer the buyer a resume that no longer exists.
    clearBookingSelection();
    goTo("detail", { eventSlug: selectedMovie.id });
  };

  /**
   * Picking or dropping a seat — a real server hold, not local state. The window starts at the first
   * held seat and adding another never extends it (FR-006); dropping the last seat ends the
   * reservation, so the next pick starts a fresh window.
   */
  const handleToggleSeat = async (seat: Seat) => {
    if (bookingShowtimeId === null || seat.showtimeSeatId === undefined || holdBusy) return;

    const context = {
      eventId: selectedMovie.id,
      eventTitle: selectedMovie.title,
      selectedDate: bookingDate,
      selectedTime: bookingTime,
      mode: "seated" as const,
    };
    const mine = hold?.seats.some((s) => s.showtimeSeatId === seat.showtimeSeatId) ?? false;

    setHoldBusy(true);
    try {
      if (mine && hold) {
        const updated = await holdsClient.release(hold.reservationId, [seat.showtimeSeatId]);
        setHold(updated.items.length === 0 ? null : sessionFromReservation(updated, context));
      } else {
        const updated = hold
          ? await holdsClient.add(hold.reservationId, { seatIds: [seat.showtimeSeatId] })
          : await holdsClient.hold({
              showtimeId: bookingShowtimeId,
              seatIds: [seat.showtimeSeatId],
            });
        setHold(sessionFromReservation(updated, context));
      }
    } catch (e) {
      // Every refusal is explainable: seat just taken, cap reached, showtime closed (SC-008).
      pushToast(
        "error",
        e instanceof HoldError ? e.message : "Không giữ được ghế. Vui lòng thử lại.",
      );
      if (e instanceof HoldError && e.status === 404) setHold(null); // the hold ended underneath us
    } finally {
      setHoldBusy(false);
    }
  };

  /**
   * A general-admission stepper press, straight through to the server.
   *
   * The quantity is not local state any more. It used to be picked on the event page and only
   * turned into a hold when the buyer pressed through to checkout, which meant the number on screen
   * was a wish rather than a claim: two buyers could both step to 5 of a tier with 6 left and only
   * discover the conflict at the very end. Holding on the press is what T023 asked for and what
   * makes the remaining count on everyone else's screen true (FR-018).
   *
   * Every press is a round trip, so `holdBusy` disables the steppers in between — two presses racing
   * would both read the same reservation and one would be lost.
   */
  const handleAdjustGaQuantity = (
    tier: { id: string; label: string },
    delta: number,
    showtimeId: number | null,
    date: string,
    time: string,
  ) => {
    runSignedIn(async () => {
      if (showtimeId === null || holdBusy) return;

      // A hold belongs to one showtime (FR-011). Stepping a tier on a different one is a new
      // selection, and the old seats/tickets have to go back before it starts.
      const current = holdRef.current;
      if (current && current.showtimeId !== showtimeId) {
        const switching = await askConfirm({
          title: "Đổi sang suất khác?",
          message:
            "Bạn đang giữ vé cho một suất khác. Chọn suất này sẽ hủy số vé đang giữ và trả lại " +
            "cho người khác.",
          confirmLabel: "Đổi suất",
          cancelLabel: "Giữ suất cũ",
          tone: "danger",
        });
        if (!switching) return;
        await releaseHold(current);
      }

      const live = holdRef.current;
      if (delta < 0 && !live) return;

      const context = {
        eventId: selectedMovie.id,
        eventTitle: selectedMovie.title,
        selectedDate: date,
        selectedTime: time,
        mode: "ga" as const,
      };

      setHoldBusy(true);
      try {
        const tierId = Number(tier.id);
        const updated =
          delta > 0
            ? live
              ? await holdsClient.add(live.reservationId, { ticketTierId: tierId, quantity: delta })
              : await holdsClient.hold({ showtimeId, ticketTierId: tierId, quantity: delta })
            : await holdsClient.releaseQuantity(live!.reservationId, tierId, -delta);

        setBookingDate(date);
        setBookingTime(time);
        setBookingShowtimeId(showtimeId);
        // Stepping the last ticket off closes the reservation server-side, which is the signal that
        // there is nothing left to hold — not an error.
        setHold(updated.status === "active" ? sessionFromReservation(updated, context) : null);
      } catch (e) {
        pushToast(
          "error",
          e instanceof HoldError ? e.message : "Không giữ được vé. Vui lòng thử lại.",
        );
        if (e instanceof HoldError && e.status === 404) setHold(null);
      } finally {
        setHoldBusy(false);
      }
    });
  };

  const handleProceedToCheckout = () => {
    runSignedIn(() => {
      goTo("checkout");
    });
  };

  const handleConfirmPurchase = async (payload: CheckoutPayload) => {
    if (!hold) {
      pushToast("error", "Đơn giữ chỗ không còn hiệu lực. Vui lòng chọn vé lại.");
      return;
    }

    setHoldBusy(true);
    try {
      const order = await walletClient.checkout(hold.reservationId);
      const ticket = order.tickets[0];
      if (!ticket) throw new Error("Đơn hàng chưa có vé.");

      const newBooking: Booking = {
        id: String(order.id),
        movie: selectedMovie,
        selectedDate: bookingDate,
        selectedTime: bookingTime,
        selectedSeats: bookingSeats,
        customerName: payload.customer.name,
        customerEmail: payload.customer.email,
        customerPhone: payload.customer.phone,
        totalPrice: order.totalAmount,
        serviceFee: 0,
        discount: 0,
        finalPrice: order.totalAmount,
        paymentMethod: "Ví TixHub",
        deliveryChannel: "email_sms",
        status: "paid",
        qrStatus: "unused",
        bookingTime: new Date(order.createdAt).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        }),
        qrPayload: ticket.ticketCode,
      };

      saveBookingToHistory(newBooking);
      setFinalBooking(newBooking);
      setHold(null);
      goTo("ticket", { bookingId: newBooking.id });
    } catch (e) {
      // A short balance is not a failed purchase — it is a step the buyer can complete. The server
      // sends the exact numbers, which the checkout screen turns into a pre-filled top-up (UC-12 A2).
      if (e instanceof WalletError && e.code === "insufficient_wallet_balance" && e.details) {
        setShortfall({
          required: Number(e.details.required ?? 0),
          balance: Number(e.details.balance ?? 0),
          shortfall: Number(e.details.shortfall ?? 0),
        });
      }
      pushToast(
        "error",
        e instanceof WalletError ? e.message : "Không thể hoàn tất thanh toán. Vui lòng thử lại.",
      );
    } finally {
      setHoldBusy(false);
    }
  };

  const handleLogin = (user: Me) => {
    setIsSignedIn(true);
    applyIdentity(user);
    setShowAuthModal(false);

    // Resume whatever the sign-in interrupted, so signing in is not a dead end.
    const resume = pendingAction;
    setPendingAction(null);
    resume?.();
  };

  const dismissAuthModal = () => {
    setShowAuthModal(false);
    setPendingAction(null);
  };

  /** Run `action` now when signed in; otherwise ask for a sign-in first and run it afterwards. */
  const runSignedIn = (action: () => void) => {
    if (isSignedIn) {
      action();
      return;
    }
    setPendingAction(() => action);
    setShowAuthModal(true);
  };

  /** Clears everything this browser remembers about the signed-in account. */
  /**
   * Signing out has to drop the per-account caches too, not just the identity. They key on nothing
   * but the browser, and the mount effect reads them back unconditionally — so leaving them behind
   * shows the next account to sign in on this machine the previous one's tickets and wishlist.
   */
  const clearSignedInState = () => {
    setIsSignedIn(false);
    applyIdentity(null);
    setBookingsHistory([]);
    setWishlistedIds([]);
    try {
      localStorage.removeItem(BOOKINGS_CACHE_KEY);
      LEGACY_BOOKINGS_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem(WISHLIST_CACHE_KEY);
      localStorage.removeItem(LEGACY_WISHLIST_CACHE_KEY);
    } catch (err) {
      console.error("Failed to clear cached account data on sign-out:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await authClient.logout();
    } catch (err) {
      console.error("Logout failed:", err);
    }
    clearSignedInState();
  };

  /** Revokes every session for the account, this device included (FR-056). */
  const handleLogoutAll = async () => {
    try {
      await authClient.logoutAll();
    } catch (err) {
      console.error("Logout-all failed:", err);
    }
    clearSignedInState();
  };

  return (
    <div className="flex min-h-screen flex-col bg-xanh-pho text-white selection:bg-burgundy selection:text-white transition-colors duration-300">
      <Header
        searchQuery={searchQuery}
        /*
         * Typing changes the query and nothing else. It used to carry the reader to `/events` on
         * the first keystroke — before they had finished saying what they wanted — and the answer
         * now comes to them, in the dropdown under the box.
         */
        onSearchChange={setSearchQuery}
        // Pressing × means "I am done searching", not "take me to the results of an empty search".
        onSearchClear={() => setSearchQuery("")}
        searchResults={searchSuggestions}
        searchResultCount={searchMatchCount}
        onSelectResult={(slug) => {
          const movie = events.find((event) => event.id === slug);
          if (movie) void handleStartBookingInput(movie);
        }}
        // Enter, or "Xem tất cả": the whole result set, on the screen that can page through it.
        onSubmitSearch={() => void goCatalogAfterFilter(() => {})}
        /*
         * The category shortcuts the menu used to carry are gone with the rows that held them. They
         * were a filtered `/events` under a different name, and the landing page's own bands make
         * the same offer with the events themselves visible under each heading.
         */
        onViewHistory={() => void leaveFlow(() => goTo("history"))}
        onViewWallet={() => void leaveFlow(() => goTo("wallet"))}
        onViewSaved={() => void leaveFlow(() => runSignedIn(() => goTo("saved")))}
        onLogout={() => void leaveFlow(() => void handleLogout())}
        onHomeClick={goHome}
        onLoginClick={() => (userName ? navigate(ACCOUNT_PATH) : setShowAuthModal(true))}
        onOrganizerClick={() =>
          leaveFlow(() => {
            goTo("organizer");
          })
        }
        onAdminClick={() =>
          leaveFlow(() => {
            goTo("admin");
          })
        }
        isOrganizer={isOrganizer}
        isAdmin={isAdmin}
        onBrowse={() => void leaveFlow(() => goTo("browse"))}
        onViewGuide={() => void leaveFlow(() => goTo("about-us"))}
        onViewAbout={() => void leaveFlow(() => goTo("terms-of-service"))}
        onViewPolicy={() => void leaveFlow(() => goTo("refund-policy"))}
        userName={userName}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        overlay={activeScreen === "home"}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />

      {/*
        `overflow-x-clip`, not `overflow-x-hidden`. Both stop a stray wide child from producing a
        horizontal scrollbar, but `hidden` also makes this element a scroll container — and a scroll
        container here is the scrollport every `position: sticky` descendant measures itself
        against. The hero's sticky stage therefore never engaged. `clip` refuses scrolling outright,
        so it clips without capturing the page's scroll.
      */}
      <main className="w-full max-w-full flex-grow overflow-x-clip">
        {activeScreen === "home" && (
          <>
            <HeroVideo
              movie={heroMovie}
              onBookNow={() => void handleStartBookingInput(heroMovie)}
            />
            {/*
             * The curated ten on the moving band, then one band per kind of event.
             *
             * The landing page used to be a filter strip over one long grid, which made the first
             * thing on it a form: the reader had to say what they wanted before the page would show
             * them anything worth wanting. Named bands answer in the other direction, and the filter
             * work moves to `/events` — the screen a reader who already knows goes to.
             */}
            <EventTicker
              events={trendingEvents}
              onSelect={(movie) => void handleStartBookingInput(movie)}
              onViewAll={() => void leaveFlow(() => goTo("browse"))}
            />

            {landingSections.map((section) => (
              <CategoryRow
                key={section.id}
                title={section.title}
                eyebrow={section.eyebrow}
                events={section.events}
                emptyNote={section.emptyNote}
                // No link out of an empty band: `/events` filtered to nothing is a blank page with
                // no way to tell it from a broken one.
                onViewMore={
                  section.codes.length > 0 ? () => openCategorySection(section.codes) : undefined
                }
                selectedEvent={heroMovie}
                onSelectEvent={handleSelectEventForTrailer}
                onBookNow={(movie) => void handleStartBookingInput(movie)}
                wishlistedIds={wishlistedIds}
                onToggleWishlist={handleToggleWishlist}
              />
            ))}
          </>
        )}

        {/*
         * The catalog page opens on the same trailer the landing page does, in its plain variant:
         * one big picture in a fixed band, no television around it and no scroll choreography. It
         * is what the reference puts at the top of a collection — a full-bleed image carrying the
         * section's title — and it means `/events` no longer starts cold on a row of filters.
         */}
        {activeScreen === "browse" && (
          <HeroVideo
            variant="plain"
            movie={heroMovie}
            onBookNow={() => void handleStartBookingInput(heroMovie)}
          />
        )}

        {/*
         * The filtered catalog, and the only screen that carries a filter at all.
         *
         * The landing page used to run the same grid under a horizontal filter strip. It no longer
         * does — it is a stack of curated bands — so the rail beside this grid is the whole filter
         * surface of the app, and `EventFilters` has one shape in use rather than two.
         */}
        {activeScreen === "browse" && (
          <EventGrid
            events={filteredEvents}
            variant="catalog"
            // Pages of 24 — two full rows of four beside the rail, eight without it.
            pageSize={24}
            selectedEvent={heroMovie}
            onSelectEvent={handleSelectEventForTrailer}
            onBookNow={(movie) => void handleStartBookingInput(movie)}
            wishlistedIds={wishlistedIds}
            onToggleWishlist={handleToggleWishlist}
            // The rail is handed to the grid rather than placed beside it, so the two share one
            // measure instead of two that have to be kept equal by hand.
            sidebar={
              <EventFilters
                resultCount={filteredEvents.length}
                activeCategories={activeCategories}
                onCategoryChange={(value) =>
                  void goCatalogAfterFilter(() => setActiveCategories(toggleFilterValue(value)))
                }
                activeDate={activeDate}
                dateOptions={dateOptions}
                categoryOptions={categoryOptions}
                onDateChange={(value) => void goCatalogAfterFilter(() => setActiveDate(value))}
                activeCities={activeCities}
                onCityChange={(value) =>
                  void goCatalogAfterFilter(() => setActiveCities(toggleFilterValue(value)))
                }
                maxPrice={maxPrice}
                priceCeiling={priceCeiling}
                onMaxPriceChange={(value) => void goCatalogAfterFilter(() => setMaxPrice(value))}
                availabilities={availabilities}
                onAvailabilityChange={(value) =>
                  void goCatalogAfterFilter(() => setAvailabilities(toggleFilterValue(value)))
                }
                /*
                 * The search box is deliberately not cleared here. It lives in the nav, above this
                 * rail and outside it, and wiping a query the reader can still see typed up there
                 * from a control down here reads as a bug rather than as a reset.
                 */
                onResetFilters={() =>
                  void goCatalogAfterFilter(() => {
                    setActiveCategories([]);
                    setActiveDate(null);
                    setActiveCities([]);
                    setAvailabilities([]);
                    setMaxPrice(null);
                  })
                }
              />
            }
          />
        )}

        {activeScreen === "detail" && (
          <EventDetail
            event={selectedMovie}
            showtimes={showtimes}
            isSignedIn={isSignedIn}
            relatedEvents={relatedEvents}
            wishlistedIds={wishlistedIds}
            onBack={goHome}
            onOpenReviews={() => goTo("reviews", { eventSlug: selectedMovie.id })}
            onToggleWishlist={handleToggleWishlist}
            onBookRelated={(movie) => void handleStartBookingInput(movie)}
            onProceedToSeatSelection={handleProceedToSeats}
            onProceedToCheckout={handleProceedToCheckout}
            // General admission holds as it steps, so this screen owns a live reservation and needs
            // the clock and the busy flag that used to belong only to the seat map.
            heldQuantities={
              hold?.mode === "ga" && hold.eventId === selectedMovie.id
                ? (hold.quantities ?? {})
                : {}
            }
            onAdjustQuantity={handleAdjustGaQuantity}
            holdBusy={holdBusy}
            holdRemainingMs={hold?.mode === "ga" ? holdRemainingMs : 0}
          />
        )}

        {/*
          The comments in full, on their own route.

          `eventId` is the catalogue's numeric id, which a deep link does not carry: on F5 the slug
          is resolved by the effect above and this waits rather than asking the API about `null`.
          The dev-only sample data has no server row either, and sits in the same branch.
        */}
        {activeScreen === "reviews" &&
          (selectedMovie.eventId !== null ? (
            <ReviewsPage
              event={selectedMovie}
              eventId={selectedMovie.eventId}
              isSignedIn={isSignedIn}
              relatedEvents={relatedEvents}
              onBack={() => goTo("detail", { eventSlug: selectedMovie.id })}
              onOpenEvent={(movie) => void handleStartBookingInput(movie)}
            />
          ) : (
            <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
              <p className="font-meta text-body text-ink-soft">Đang tải bình luận…</p>
            </div>
          ))}

        {activeScreen === "seats" && (
          <SeatLayout
            event={selectedMovie}
            showtimeId={bookingShowtimeId}
            selectedDate={bookingDate}
            selectedTime={bookingTime}
            heldSeats={hold?.showtimeId === bookingShowtimeId ? bookingSeats : []}
            remainingMs={holdRemainingMs}
            busy={holdBusy}
            onToggleSeat={(seat) => void handleToggleSeat(seat)}
            // Backward is a cancel, here and everywhere else in the flow.
            onBack={() => void cancelBookingFlow()}
            onGoToStep={() => void cancelBookingFlow()}
            onProceedToCheckout={handleProceedToCheckout}
          />
        )}

        {activeScreen === "checkout" && (
          <CheckoutForm
            event={selectedMovie}
            selectedDate={bookingDate}
            selectedTime={bookingTime}
            selectedSeats={bookingSeats}
            totalPrice={bookingTotalPrice}
            remainingMs={holdRemainingMs}
            // Named for what it does. It used to say "Quay lại chọn ghế" and keep the hold; it now
            // releases the order, and a back link that quietly destroys the purchase while promising
            // to return to the seat map is the wrong label.
            backLabel="Hủy đơn và quay lại"
            onBack={() => void cancelBookingFlow()}
            onGoToStep={() => void cancelBookingFlow()}
            reservationId={hold?.reservationId ?? null}
            shortfall={shortfall}
            onConfirmBooking={handleConfirmPurchase}
          />
        )}

        {activeScreen === "ticket" && finalBooking && (
          <TicketTicket booking={finalBooking} onHomeClick={goHome} />
        )}

        {activeScreen === "history" && (
          <BookingHistory
            bookings={bookingsHistory}
            onBack={goHome}
            onSelectBooking={(booking) => {
              setFinalBooking(normalizeBooking(booking));
              goTo("ticket", { bookingId: booking.id });
            }}
          />
        )}

        {/*
         * The bookmarks, as a page.
         *
         * The same catalog grid over a different list, rather than a bespoke layout: a saved event
         * is an event, and the reader who saved it wants to compare, open and un-save it exactly as
         * they would on `/events`. Un-saving here removes the card, because the list *is* the set of
         * hearts — there is nothing else for the control to mean on this screen.
         *
         * Guarded like the wallet: the bookmarks belong to an account, so a stranger gets the
         * sign-in prompt instead of an empty page that looks like "you have saved nothing".
         */}
        {activeScreen === "saved" &&
          (!authReady ? (
            <p className="mx-auto max-w-4xl px-4 py-16 font-meta text-body text-ink-soft sm:px-6 lg:px-8">
              Đang kiểm tra phiên đăng nhập…
            </p>
          ) : isSignedIn ? (
            <EventGrid
              events={savedEvents}
              variant="catalog"
              pageSize={24}
              eyebrow="Của bạn"
              title="Sự kiện đã lưu"
              emptyTitle="Chưa có sự kiện nào được lưu"
              emptyHint="Bấm trái tim trên ảnh sự kiện để lưu lại và xem sau."
              selectedEvent={heroMovie}
              onSelectEvent={handleSelectEventForTrailer}
              onBookNow={(movie) => void handleStartBookingInput(movie)}
              wishlistedIds={wishlistedIds}
              onToggleWishlist={handleToggleWishlist}
            />
          ) : (
            <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 className="font-display text-title-m font-black text-beige-kem">
                Sự kiện đã lưu
              </h2>
              <p className="mt-3 text-body leading-6 text-beige-kem/70">
                Sự kiện đã lưu gắn với tài khoản của bạn, nên xem được trên mọi thiết bị. Đăng nhập
                để mở danh sách.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-6">
                <button
                  onClick={() => runSignedIn(() => goTo("saved"))}
                  className="label-eyebrow inline-flex items-center gap-2 text-beige-kem transition hover:text-burgundy-ink"
                >
                  Đăng nhập
                  <span aria-hidden="true">&gt;</span>
                </button>
                <button
                  onClick={goHome}
                  className="label-eyebrow text-ink-soft transition hover:text-beige-kem"
                >
                  Về trang chủ
                </button>
              </div>
            </div>
          ))}

        {activeScreen === "admin" && (
          <AdminPanel events={SAMPLE_MOVIES} bookings={bookingsHistory} onBack={goHome} />
        )}

        {/*
         * The wallet is the one screen with nothing to show a stranger. Without this guard its own
         * fetch 401s and the panel reports "Không tải được ví." over a retry button that can never
         * succeed — a dead end that reads as a broken page rather than as a locked one.
         */}
        {activeScreen === "wallet" &&
          (!authReady ? (
            <p className="mx-auto max-w-4xl px-4 py-16 font-meta text-body text-ink-soft sm:px-6 lg:px-8">
              Đang kiểm tra phiên đăng nhập…
            </p>
          ) : isSignedIn ? (
            <WalletPanel onBack={goHome} />
          ) : (
            <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 className="font-display text-title-m font-black text-beige-kem">Ví TixHub</h2>
              <p className="mt-3 text-body leading-6 text-beige-kem/70">
                Ví gắn với tài khoản của bạn. Đăng nhập để xem số dư và lịch sử giao dịch.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-6">
                <button
                  onClick={() => runSignedIn(() => goTo("wallet"))}
                  className="label-eyebrow inline-flex items-center gap-2 text-beige-kem transition hover:text-burgundy-ink"
                >
                  Đăng nhập
                  <span aria-hidden="true">&gt;</span>
                </button>
                <button
                  onClick={goHome}
                  className="label-eyebrow text-ink-soft transition hover:text-beige-kem"
                >
                  Về trang chủ
                </button>
              </div>
            </div>
          ))}
        {activeScreen === "organizer" && <OrganizerPanel onBack={goHome} />}
        {activeScreen === "moderation" && <AdminModeration onBack={goHome} />}

        {activeScreen === "about-us" && (
          <LegalPage title="Về chúng tôi" content={aboutUsMd} onBack={goHome} />
        )}
        {activeScreen === "terms-of-service" && (
          <LegalPage title="Điều khoản sử dụng" content={termsOfServiceMd} onBack={goHome} />
        )}
        {activeScreen === "website-terms" && (
          <LegalPage title="Điều khoản website" content={websiteTermsMd} onBack={goHome} />
        )}
        {activeScreen === "refund-policy" && (
          <LegalPage title="Chính sách hoàn vé" content={refundPolicyMd} onBack={goHome} />
        )}
      </main>

      {/*
       * `wallet` needs an identity, so a guest clicking it in the footer gets the sign-in prompt
       * and is carried through to the wallet afterwards — rather than landing on a screen that can
       * only report a failure.
       */}
      <Footer
        onNavigate={(screen) =>
          void leaveFlow(() =>
            // Both of these belong to an account, so a guest is asked to sign in and carried
            // through rather than landing on a screen that can only report a failure.
            screen === "wallet" || screen === "saved"
              ? runSignedIn(() => goTo(screen))
              : goTo(screen),
          )
        }
        /*
         * Straight to the application form, and through the sign-in gate if there is one: applying
         * needs an identity, and `runSignedIn` parks the click and replays it afterwards rather
         * than dropping the reader on a login screen with nothing to return to.
         */
        onApplyAsOrganizer={() =>
          void leaveFlow(() => runSignedIn(() => navigate(`${ACCOUNT_PATH}?section=organizer`)))
        }
      />

      {/*
       * The assistant, mounted once for the whole app rather than inside the browse screen.
       *
       * It used to be a full-width bar wedged between the filters and the results, which pushed
       * them apart on every visit whether or not anyone wanted to ask anything, and vanished the
       * moment you opened an event. As a launcher it is available on every screen and costs no
       * layout — and because it is mounted here, the conversation survives moving between screens.
       */}
      <AIChatPanel
        signedIn={isSignedIn}
        /*
         * In-application navigation, not an `<a href>`.
         *
         * The whole catalog is in `events` now, and a recommendation is by construction a publicly
         * visible event, so the lookup effectively always hits. It went through a raw anchor
         * before, which reloaded the entire SPA — losing the conversation the reader had just had,
         * along with every other piece of session state.
         */
        onOpenEvent={(slug) => {
          const movie = eventsRef.current.find((event) => event.id === slug);
          if (movie) void handleStartBookingInput(movie);
        }}
      />

      {showAuthModal && <AuthModal onClose={dismissAuthModal} onLogin={handleLogin} />}
      {showAccountPage && userName && (
        <AccountPage
          onClose={closeAccountPage}
          onLogout={async () => {
            await handleLogout();
            closeAccountPage();
          }}
          onLogoutAll={async () => {
            await handleLogoutAll();
            closeAccountPage();
          }}
          onProfileUpdated={applyIdentity}
          /*
           * `/account?section=organizer` lands on the organizer section, which is what the footer's
           * application link opens. Read once, as the initial value — the sidebar owns the section
           * after that, and writing every click back to the address bar would make each one a
           * history entry the Back button has to walk through before it can close the page.
           */
          initialSection={
            new URLSearchParams(location.search).get("section") === "organizer"
              ? "organizer"
              : "profile"
          }
          onManageEvents={() =>
            leaveFlow(() => {
              // One navigation, not a close followed by a move: `/organizer` replaces `/account`.
              goTo("organizer");
            })
          }
        />
      )}
      {resetToken && <ResetPassword token={resetToken} />}
      {onVnpayReturn && <VnpayReturn onDone={finishVnpayReturn} />}

      {holdExpiredNotice && (
        <HoldExpiredDialog
          onStay={() => setHoldExpiredNotice(false)}
          onGoHome={() => {
            setHoldExpiredNotice(false);
            // No exit prompt: the hold is already gone, so there is nothing left to lose by leaving.
            goTo("home");
          }}
        />
      )}

      {confirmRequest && (
        <ConfirmDialog
          {...confirmRequest}
          onConfirm={() => answerConfirm(true)}
          onCancel={() => answerConfirm(false)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function normalizeBooking(raw: Booking): Booking {
  const matchedEvent = SAMPLE_MOVIES.find((event) => event.id === raw.movie?.id);
  const totalPrice = raw.totalPrice || 0;

  return {
    ...raw,
    movie: matchedEvent || raw.movie || SAMPLE_MOVIES[0],
    totalPrice,
    serviceFee: raw.serviceFee ?? 0,
    discount: raw.discount ?? 0,
    finalPrice: raw.finalPrice ?? totalPrice,
    paymentMethod: raw.paymentMethod ?? "Legacy mock payment",
    deliveryChannel: raw.deliveryChannel ?? "email_sms",
    status: raw.status ?? "paid",
    qrStatus: raw.qrStatus ?? "unused",
    qrPayload: raw.qrPayload ?? JSON.stringify({ bookingId: raw.id, qrStatus: "unused" }),
  };
}
