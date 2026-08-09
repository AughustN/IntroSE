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
import { cardToMovie, detailToMovie } from "./services/catalogAdapter";
import { applyEventSeo, clearEventSeo } from "./services/seo";
import { matchesDateFilter, type DateFilter } from "./services/dateFilter";
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
import { walletClient, WalletError, type Topup } from "./services/walletClient";
import WalletPanel from "./components/wallet/WalletPanel";
import VnpayReturn from "./components/wallet/VnpayReturn";
import { useHoldCountdown } from "./hooks/useHoldCountdown";
import BookingHistory from "./components/BookingHistory";
import ToastStack, { type ToastKind, type ToastMessage } from "./components/ToastStack";
import ConfirmDialog, { type ConfirmRequest } from "./components/ConfirmDialog";
import CheckoutForm from "./components/CheckoutForm";
import EventDetail, { TierSelection } from "./components/EventDetail";
import EventFilters from "./components/EventFilters";
import EventGrid from "./components/EventGrid";
import EventTicker from "./components/EventTicker";
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
import { ArrowUp } from "lucide-react";

type ThemeMode = "dark" | "light";

/**
 * The booking flow: chọn suất → chọn ghế → thanh toán. A hold lives for as long as the buyer stays
 * inside these three screens; stepping between them keeps the selection and the countdown, and only
 * leaving the flow (or the TTL) releases it.
 */
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

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>("home");
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [selectedMovie, setSelectedMovie] = useState<MovieEvent>(SAMPLE_MOVIES[0]);
  const [heroMovie, setHeroMovie] = useState<MovieEvent>(SAMPLE_MOVIES[0]);
  const [events, setEvents] = useState<MovieEvent[]>([]);
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeDate, setActiveDate] = useState<DateFilter>(null);
  const [activeCity, setActiveCity] = useState("all");
  const [maxPrice, setMaxPrice] = useState(1500000);
  const [availability, setAvailability] = useState("all");

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
   */
  const goTo = useCallback(
    (screen: Screen, params?: { eventSlug?: string | null; bookingId?: string | null }) => {
      setActiveScreen(screen);
      navigate(screenToPath(screen, params));
    },
    [navigate],
  );

  const activeScreenRef = useLatest(activeScreen);
  const selectedMovieRef = useLatest(selectedMovie);
  const bookingShowtimeIdRef = useLatest(bookingShowtimeId);
  const finalBookingRef = useLatest(finalBooking);
  const bookingsHistoryRef = useLatest(bookingsHistory);

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
    setAvatarUrl(user?.avatarUrl ?? null);
    setUserEmail(user?.email ?? null);
    cacheValue(USER_CACHE_KEY, name || null);
    cacheValue(AVATAR_CACHE_KEY, user?.avatarUrl ?? null);
    cacheValue(EMAIL_CACHE_KEY, user?.email ?? null);
  }, []);

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
    pushToast("warning", "Đã hết thời gian giữ chỗ. Ghế đã được trả lại, vui lòng chọn lại.", 9000);
    const current = activeScreenRef.current;
    if (current === "seats" || current === "checkout") {
      goTo(expired.mode === "ga" ? "detail" : "seats", { eventSlug: expired.eventId });
    }
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
      .listEvents({ page: 1 })
      .then((res) => {
        const mapped = res.events.map(cardToMovie);
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

  const filteredEvents = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return events.filter((movie) => {
      const searchBlob = [
        movie.title,
        movie.originalTitle,
        movie.genre.join(" "),
        movie.director,
        movie.cast.join(" "),
        movie.tags.join(" "),
        movie.location,
        movie.venueName,
        movie.city,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !normalizedQuery || searchBlob.includes(normalizedQuery);
      const matchesCategory = activeCategory === "all" || movie.category === activeCategory;
      const matchesDate = matchesDateFilter(movie.dates, activeDate);
      const matchesCity = activeCity === "all" || movie.city === activeCity;
      const matchesPrice = movie.price <= maxPrice;
      const matchesAvailability = availability === "all" || movie.status === availability;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesDate &&
        matchesCity &&
        matchesPrice &&
        matchesAvailability
      );
    });
  }, [events, activeCategory, activeCity, activeDate, availability, maxPrice, searchQuery]);

  /**
   * The date filter's options, taken from the catalog itself. They are compared verbatim against
   * `movie.dates`, so they have to be the same ISO strings the events carry — a hand-maintained list
   * drifts out of date and quietly filters everything away.
   */
  const dateOptions = useMemo(
    () => [...new Set(events.flatMap((event) => event.dates))].sort(),
    [events],
  );

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
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const goHomeAfterFilter = async (update: () => void) => {
    // The filter itself always applies; only the jump back to the catalog leaves the flow.
    update();
    // Both catalog screens show the grid the filter acts on, so neither needs to be left.
    if (activeScreen === "home" || activeScreen === "browse") return;
    if (hold && inFlow) {
      if (exitDeclinedRef.current) return;
      if (!(await confirmLeaveFlow())) {
        exitDeclinedRef.current = true;
        return;
      }
    }
    deepLinkedEventRef.current = null;
    goTo("home");
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

  const clearHistory = async () => {
    const wiping = await askConfirm({
      title: "Xóa lịch sử đặt vé?",
      message:
        "Toàn bộ lịch sử đặt vé lưu trên trình duyệt này sẽ bị xóa và không khôi phục được. " +
        "Vé đã mua không bị ảnh hưởng.",
      confirmLabel: "Xóa lịch sử",
      cancelLabel: "Giữ lại",
      tone: "danger",
    });
    if (!wiping) return;

    setBookingsHistory([]);
    try {
      localStorage.removeItem(BOOKINGS_CACHE_KEY);
      LEGACY_BOOKINGS_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch (err) {
      console.error("Failed to clear local storage:", err);
    }
  };

  const handleToggleWishlist = (eventId: string) => {
    setWishlistedIds((current) => {
      const next = current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId];

      try {
        localStorage.setItem(WISHLIST_CACHE_KEY, JSON.stringify(next));
      } catch (err) {
        console.error("Failed to save wishlist:", err);
      }

      return next;
    });
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      window.scrollTo({ top: 0, behavior: "smooth" });

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
   * General admission has no seat map to walk through — a chosen quantity per tier is the whole
   * selection, so checkout is the next screen. Each ticket becomes one line item; the seat shape is
   * what the (cinema-derived) checkout and ticket screens still render.
   */
  const handleProceedToQuantityCheckout = (
    selection: TierSelection[],
    showtimeId: number | null,
    date: string,
    time: string,
  ) => {
    runSignedIn(async () => {
      if (showtimeId === null) return;

      setHoldBusy(true);
      try {
        // Any earlier selection for this showtime is replaced wholesale: the tier steppers express
        // an absolute quantity, and the server would otherwise add to what is already held.
        if (hold) await releaseHold(hold);

        let reservation = null;
        for (const line of selection) {
          reservation = await holdsClient.hold({
            showtimeId,
            ticketTierId: Number(line.tierId),
            quantity: line.quantity,
          });
        }
        if (!reservation) return;

        setBookingDate(date);
        setBookingTime(time);
        setBookingShowtimeId(showtimeId);
        setHold(
          sessionFromReservation(reservation, {
            eventId: selectedMovie.id,
            eventTitle: selectedMovie.title,
            selectedDate: date,
            selectedTime: time,
            mode: "ga",
            quantities: Object.fromEntries(selection.map((line) => [line.tierId, line.quantity])),
          }),
        );
        goTo("checkout");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        pushToast(
          "error",
          e instanceof HoldError ? e.message : "Không giữ được vé. Vui lòng thử lại.",
        );
      } finally {
        setHoldBusy(false);
      }
    });
  };

  // Checkout is where an order starts existing, so it is the first step that needs an account.
  // The seats are already held by this point, so this only moves the screen — the hold, its items
  // and its countdown carry straight through.
  const handleProceedToCheckout = () => {
    runSignedIn(() => {
      goTo("checkout");
      window.scrollTo({ top: 0, behavior: "smooth" });
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
      window.scrollTo({ top: 0, behavior: "smooth" });
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
        onSearchChange={(value) => void goHomeAfterFilter(() => setSearchQuery(value))}
        activeCategory={activeCategory}
        onCategoryChange={(value) => void goHomeAfterFilter(() => setActiveCategory(value))}
        onViewHistory={() => void leaveFlow(() => goTo("history"))}
        onViewWallet={() => void leaveFlow(() => goTo("wallet"))}
        onHomeClick={goHome}
        onLoginClick={() => (userName ? navigate(ACCOUNT_PATH) : setShowAuthModal(true))}
        onOrganizerClick={() =>
          leaveFlow(() => {
            goTo("organizer");
            window.scrollTo({ top: 0, behavior: "smooth" });
          })
        }
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
            <EventTicker
              events={events}
              onSelect={(movie) => void handleStartBookingInput(movie)}
              onViewAll={() => void leaveFlow(() => goTo("browse"))}
            />
          </>
        )}

        {/*
         * The catalog is the same on both screens. `/` leads with the hero and the venue list;
         * `/events` is the grid on its own, which is what the nav's ticket icon wants.
         */}
        {(activeScreen === "home" || activeScreen === "browse") && (
          <div className="space-y-4">
            <EventFilters
              activeCategory={activeCategory}
              onCategoryChange={(value) => void goHomeAfterFilter(() => setActiveCategory(value))}
              activeDate={activeDate}
              dateOptions={dateOptions}
              onDateChange={(value) => void goHomeAfterFilter(() => setActiveDate(value))}
              activeCity={activeCity}
              onCityChange={(value) => void goHomeAfterFilter(() => setActiveCity(value))}
              maxPrice={maxPrice}
              onMaxPriceChange={(value) => void goHomeAfterFilter(() => setMaxPrice(value))}
              availability={availability}
              onAvailabilityChange={(value) => void goHomeAfterFilter(() => setAvailability(value))}
              wishlistCount={wishlistedIds.length}
            />

            <EventGrid
              events={filteredEvents}
              selectedEvent={heroMovie}
              onSelectEvent={handleSelectEventForTrailer}
              onBookNow={(movie) => void handleStartBookingInput(movie)}
              wishlistedIds={wishlistedIds}
              onToggleWishlist={handleToggleWishlist}
              // Offered on the landing page only. `/events` is where the link would go, so on that
              // screen it would point at itself.
              onViewAll={
                activeScreen === "home" ? () => void leaveFlow(() => goTo("browse")) : undefined
              }
            />
          </div>
        )}

        {activeScreen === "detail" && (
          <EventDetail
            event={selectedMovie}
            showtimes={showtimes}
            isSignedIn={isSignedIn}
            relatedEvents={relatedEvents}
            wishlistedIds={wishlistedIds}
            onBack={goHome}
            onToggleWishlist={handleToggleWishlist}
            onBookRelated={(movie) => void handleStartBookingInput(movie)}
            onProceedToSeatSelection={handleProceedToSeats}
            onProceedToQuantityCheckout={handleProceedToQuantityCheckout}
            restoreHold={
              hold && hold.eventId === selectedMovie.id
                ? {
                    selectedDate: hold.selectedDate,
                    selectedTime: hold.selectedTime,
                    quantities: hold.quantities ?? {},
                  }
                : null
            }
            holdRemainingMs={holdRemainingMs}
          />
        )}

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
            // Stepping back to the showtime picker stays inside the flow: the hold is kept.
            onBack={() => goTo("detail", { eventSlug: selectedMovie.id })}
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
            backLabel={hold?.mode === "ga" ? "Quay lại chọn số lượng vé" : "Quay lại chọn ghế"}
            // Also inside the flow — the selection and the countdown are still there when they return.
            onBack={() =>
              goTo(hold?.mode === "ga" ? "detail" : "seats", { eventSlug: selectedMovie.id })
            }
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
            onClearHistory={() => void clearHistory()}
          />
        )}

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
            <p className="mx-auto max-w-4xl px-4 py-16 font-mono text-sm text-ink-soft sm:px-6 lg:px-8">
              Đang kiểm tra phiên đăng nhập…
            </p>
          ) : isSignedIn ? (
            <WalletPanel onBack={goHome} />
          ) : (
            <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
              <h2 className="font-display text-3xl font-black text-beige-kem">Ví TixHub</h2>
              <p className="mt-3 text-sm leading-6 text-beige-kem/70">
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
            screen === "wallet" ? runSignedIn(() => goTo(screen)) : goTo(screen),
          )
        }
      />

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed bottom-6 right-6 z-30 grid h-12 w-12 place-items-center rounded-xl border border-cam-dat/20 bg-burgundy text-white transition-all hover:scale-105 hover:brightness-95"
        aria-label="Cuộn lên đầu trang"
        title="Cuộn lên đầu trang"
      >
        <ArrowUp className="h-5 w-5" />
      </button>

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
          onManageEvents={() =>
            leaveFlow(() => {
              // One navigation, not a close followed by a move: `/organizer` replaces `/account`.
              goTo("organizer");
              window.scrollTo({ top: 0, behavior: "smooth" });
            })
          }
        />
      )}
      {resetToken && <ResetPassword token={resetToken} />}
      {onVnpayReturn && <VnpayReturn onDone={finishVnpayReturn} />}

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
