/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_MOVIES } from "./data";
import { Booking, CheckoutPayload, HoldSession, MovieEvent, Seat } from "./types";
import AdminPanel from "./components/AdminPanel";
import AuthModal from "./components/AuthModal";
import AccountModal from "./components/AccountModal";
import OrganizerPanel from "./components/OrganizerPanel";
import AdminModeration from "./components/AdminModeration";
import ResetPassword from "./components/ResetPassword";
import type { Me } from "@/shared/auth/types";
import type { Showtime } from "@/shared/catalog/types";
import { authClient } from "./services/authClient";
import { catalogClient } from "./services/catalogClient";
import { cardToMovie, detailToMovie } from "./services/catalogAdapter";
import { applyEventSeo, clearEventSeo } from "./services/seo";
import {
  holdTotalPrice,
  loadHoldSession,
  saveHoldSession,
  sessionFromReservation,
} from "./services/holdSession";
import { HoldError, holdsClient } from "./services/holdsClient";
import { walletClient, WalletError } from "./services/walletClient";
import { useHoldCountdown } from "./hooks/useHoldCountdown";
import BookingHistory from "./components/BookingHistory";
import ToastStack, { type ToastKind, type ToastMessage } from "./components/ToastStack";
import ConfirmDialog, { type ConfirmRequest } from "./components/ConfirmDialog";
import CheckoutForm from "./components/CheckoutForm";
import EventDetail, { TierSelection } from "./components/EventDetail";
import EventFilters from "./components/EventFilters";
import EventGrid from "./components/EventGrid";
import Header from "./components/Header";
import HeroVideo from "./components/HeroVideo";
import SeatLayout from "./components/SeatLayout";
import TicketTicket from "./components/TicketTicket";
import { ArrowUp } from "lucide-react";

type Screen =
  | "home"
  | "detail"
  | "seats"
  | "checkout"
  | "ticket"
  | "history"
  | "admin"
  | "organizer"
  | "moderation";
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
const THEME_CACHE_KEY = "tixhub_theme_mode_v1";
const LEGACY_THEME_CACHE_KEY = "ticketbox_theme_mode_v1";

function getInitialTheme(): ThemeMode {
  try {
    const cached =
      localStorage.getItem(THEME_CACHE_KEY) || localStorage.getItem(LEGACY_THEME_CACHE_KEY);
    if (cached === "dark" || cached === "light") return cached;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
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
  const [activeDate, setActiveDate] = useState("all");
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

  const [bookingsHistory, setBookingsHistory] = useState<Booking[]>([]);
  const [wishlistedIds, setWishlistedIds] = useState<string[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [userName, setUserName] = useState("");
  const [isSignedIn, setIsSignedIn] = useState(false);
  /**
   * What the visitor was trying to do when we stopped them to sign in. Browsing, picking a showtime
   * and choosing seats are all open to guests; only the step that creates an order needs an
   * identity, so the click is parked here and replayed once they are in.
   */
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
    setActiveScreen((current) =>
      current === "seats" || current === "checkout"
        ? expired.mode === "ga"
          ? "detail"
          : "seats"
        : current,
    );
  }, []);

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

  // Password-reset deep link (/reset-password?token=…). No router in this app, so read
  // the URL directly and show the reset screen as a full-page overlay.
  const resetToken = useMemo(() => {
    const url = new URL(window.location.href);
    return url.pathname === "/reset-password" ? url.searchParams.get("token") : null;
  }, []);

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
    }
  }, []);

  // Restore a real session from the httpOnly refresh cookie (reconciles the optimistic
  // cached name above). Signed out → clear the display.
  useEffect(() => {
    authClient
      .restore()
      .then((user) => {
        const name = user ? user.nickname || user.email : "";
        setUserName(name);
        setIsSignedIn(Boolean(user));
        setAvatarUrl(user?.avatarUrl ?? null);
        try {
          if (name) localStorage.setItem(USER_CACHE_KEY, name);
          else localStorage.removeItem(USER_CACHE_KEY);
        } catch (err) {
          console.error("Failed to sync cached user:", err);
        }
      })
      .catch(() => {});
  }, []);

  // Load the real catalog (replaces the mock browse source). Maps API cards → MovieEvent.
  useEffect(() => {
    catalogClient
      .listEvents({ page: 1 })
      .then((res) => {
        const mapped = res.events.map(cardToMovie);
        setEvents(mapped);
        if (mapped[0]) {
          setHeroMovie(mapped[0]);
          setSelectedMovie(mapped[0]);
        }
      })
      .catch((err) => console.error("Failed to load catalog:", err));
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
      const matchesDate = activeDate === "all" || movie.dates.includes(activeDate);
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

  const goHome = () => {
    void leaveFlow(() => {
      setActiveScreen("home");
      clearEventSeo();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const goHomeAfterFilter = async (update: () => void) => {
    // The filter itself always applies; only the jump back to the catalog leaves the flow.
    update();
    if (activeScreen === "home") return;
    if (hold && inFlow) {
      if (exitDeclinedRef.current) return;
      if (!(await confirmLeaveFlow())) {
        exitDeclinedRef.current = true;
        return;
      }
    }
    setActiveScreen("home");
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
    setActiveScreen("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
    // enrich with full detail from the API (movie.id carries the event slug)
    catalogClient
      .getEvent(movie.id)
      .then(async (detail) => {
        const loaded = await catalogClient.getShowtimes(detail.id);
        setSelectedMovie(detailToMovie(detail, loaded));
        setShowtimes(loaded);
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
      setActiveScreen("seats");
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
        setActiveScreen("checkout");
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
      setActiveScreen("checkout");
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
      setActiveScreen("ticket");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      pushToast(
        "error",
        e instanceof WalletError ? e.message : "Không thể hoàn tất thanh toán. Vui lòng thử lại.",
      );
    } finally {
      setHoldBusy(false);
    }
  };

  const handleLogin = (user: Me) => {
    const name = user.nickname || user.email;
    setUserName(name);
    setIsSignedIn(true);
    setAvatarUrl(user.avatarUrl);
    setShowAuthModal(false);
    try {
      localStorage.setItem(USER_CACHE_KEY, name);
    } catch (err) {
      console.error("Failed to save user:", err);
    }

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

  const handleLogout = async () => {
    try {
      await authClient.logout();
    } catch (err) {
      console.error("Logout failed:", err);
    }
    setUserName("");
    setIsSignedIn(false);
    setAvatarUrl(null);
    try {
      localStorage.removeItem(USER_CACHE_KEY);
    } catch (err) {
      console.error("Failed to clear cached user:", err);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-xanh-pho text-beige-kem selection:bg-burgundy selection:text-white transition-colors duration-300">
      <Header
        searchQuery={searchQuery}
        onSearchChange={(value) => void goHomeAfterFilter(() => setSearchQuery(value))}
        onViewHistory={() => void leaveFlow(() => setActiveScreen("history"))}
        onHomeClick={goHome}
        onLoginClick={() => (userName ? setShowAccountModal(true) : setShowAuthModal(true))}
        onAdminClick={() =>
          leaveFlow(() => {
            setActiveScreen("moderation");
            window.scrollTo({ top: 0, behavior: "smooth" });
          })
        }
        userName={userName}
        avatarUrl={avatarUrl}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />

      <main className="w-full max-w-full flex-grow overflow-x-hidden">
        {activeScreen === "home" && (
          <div className="space-y-4">
            <HeroVideo
              movie={heroMovie}
              onBookNow={() => void handleStartBookingInput(heroMovie)}
            />

            <EventFilters
              activeCategory={activeCategory}
              onCategoryChange={(value) => void goHomeAfterFilter(() => setActiveCategory(value))}
              activeDate={activeDate}
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
            />

            <section className="border-t border-beige-kem/10 bg-xanh-pho/30 px-4 py-20 sm:px-6 lg:px-8">
              <div className="mx-auto grid max-w-7xl grid-flow-dense grid-cols-1 gap-5 md:grid-cols-3">
                <TrustCard
                  title="Wishlist và nhắc lịch"
                  text="Lưu sự kiện yêu thích, nhắc gần ngày diễn và xử lý case hết vé bằng dữ liệu local mock."
                />
                <TrustCard
                  title="Email/SMS xác nhận"
                  text="Sau thanh toán, vé QR có thể in, tải lại hoặc gửi lại qua email/SMS ở màn vé."
                />
                <TrustCard
                  title="QR một lần"
                  text="UI thể hiện trạng thái QR unused/checked-in để backend triển khai khóa vé thật."
                />
              </div>
            </section>
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
            onBack={() => setActiveScreen("detail")}
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
            onBack={() => setActiveScreen(hold?.mode === "ga" ? "detail" : "seats")}
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
              setActiveScreen("ticket");
            }}
            onClearHistory={() => void clearHistory()}
          />
        )}

        {activeScreen === "admin" && (
          <AdminPanel events={SAMPLE_MOVIES} bookings={bookingsHistory} onBack={goHome} />
        )}

        {activeScreen === "organizer" && <OrganizerPanel onBack={goHome} />}
        {activeScreen === "moderation" && <AdminModeration onBack={goHome} />}
      </main>

      <footer className="border-t border-beige-kem/10 bg-xanh-pho px-4 py-12 font-mono text-xs sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
          <div className="space-y-1 text-center md:text-left">
            <h5 className="font-display text-sm font-bold tracking-normal text-beige-kem">
              TIXHUB FRONTEND MVP
            </h5>
            <p className="text-[10px] text-la-co">
              Mock data cho vé ca nhạc, hòa nhạc, kịch và phim
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-beige-kem/60">
            <span className="cursor-pointer transition hover:text-cam-dat">Chính sách hoàn vé</span>
            <span className="cursor-pointer transition hover:text-cam-dat">Điều khoản sử dụng</span>
            <span className="cursor-pointer transition hover:text-cam-dat">Hỗ trợ email/SMS</span>
          </div>

          <p className="text-center text-[10px] text-beige-kem/40 md:text-right">
            © 2026 TixHub Mock. Frontend only.
          </p>
        </div>
      </footer>

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed bottom-6 right-6 z-30 grid h-12 w-12 place-items-center rounded-xl border border-cam-dat/20 bg-burgundy/90 text-beige-kem shadow-xl transition-all hover:scale-105 hover:bg-burgundy"
        aria-label="Cuộn lên đầu trang"
        title="Cuộn lên đầu trang"
      >
        <ArrowUp className="h-5 w-5" />
      </button>

      {showAuthModal && <AuthModal onClose={dismissAuthModal} onLogin={handleLogin} />}
      {showAccountModal && userName && (
        <AccountModal
          onClose={() => setShowAccountModal(false)}
          onLogout={async () => {
            await handleLogout();
            setShowAccountModal(false);
          }}
          onProfileUpdated={(user) => {
            setUserName(user.nickname || user.email);
            setAvatarUrl(user.avatarUrl);
          }}
          onManageEvents={() =>
            leaveFlow(() => {
              setShowAccountModal(false);
              setActiveScreen("organizer");
              window.scrollTo({ top: 0, behavior: "smooth" });
            })
          }
        />
      )}
      {resetToken && <ResetPassword token={resetToken} />}

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

function TrustCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-beige-kem/10 bg-white/[0.035] p-6">
      <h4 className="font-display text-lg font-black text-beige-kem">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-beige-kem/65">{text}</p>
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
