/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { SAMPLE_MOVIES } from "./data";
import { Booking, CheckoutPayload, MovieEvent, Seat } from "./types";
import AdminPanel from "./components/AdminPanel";
import AuthModal from "./components/AuthModal";
import AccountModal from "./components/AccountModal";
import OrganizerPanel from "./components/OrganizerPanel";
import AdminModeration from "./components/AdminModeration";
import ResetPassword from "./components/ResetPassword";
import type { Me } from "@/shared/auth/types";
import { authClient } from "./services/authClient";
import { catalogClient } from "./services/catalogClient";
import { cardToMovie, detailToMovie } from "./services/catalogAdapter";
import BookingHistory from "./components/BookingHistory";
import CheckoutForm from "./components/CheckoutForm";
import EventDetail from "./components/EventDetail";
import EventFilters from "./components/EventFilters";
import EventGrid from "./components/EventGrid";
import Header from "./components/Header";
import HeroVideo from "./components/HeroVideo";
import SeatLayout from "./components/SeatLayout";
import TicketTicket from "./components/TicketTicket";
import { ArrowUp } from "lucide-react";

type Screen = "home" | "detail" | "seats" | "checkout" | "ticket" | "history" | "admin" | "organizer" | "moderation";
type ThemeMode = "dark" | "light";

const BOOKINGS_CACHE_KEY = "ticketbox_bookings_cache_v2";
const LEGACY_BOOKINGS_CACHE_KEY = "ticketbox_bookings_cache_v1";
const WISHLIST_CACHE_KEY = "ticketbox_wishlist_cache_v1";
const USER_CACHE_KEY = "ticketbox_mock_user_v1";
const THEME_CACHE_KEY = "ticketbox_theme_mode_v1";

function getInitialTheme(): ThemeMode {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
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

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeDate, setActiveDate] = useState("all");
  const [activeCity, setActiveCity] = useState("all");
  const [maxPrice, setMaxPrice] = useState(1500000);
  const [availability, setAvailability] = useState("all");

  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingSeats, setBookingSeats] = useState<Seat[]>([]);
  const [bookingTotalPrice, setBookingTotalPrice] = useState(0);
  const [finalBooking, setFinalBooking] = useState<Booking | null>(null);

  const [bookingsHistory, setBookingsHistory] = useState<Booking[]>([]);
  const [wishlistedIds, setWishlistedIds] = useState<string[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [userName, setUserName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
      console.error("Failed to save TicketBox theme:", err);
    }
  }, [theme]);

  useEffect(() => {
    try {
      const cachedBookings =
        localStorage.getItem(BOOKINGS_CACHE_KEY) ||
        localStorage.getItem(LEGACY_BOOKINGS_CACHE_KEY);
      const cachedWishlist = localStorage.getItem(WISHLIST_CACHE_KEY);
      const cachedUser = localStorage.getItem(USER_CACHE_KEY);

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
      console.error("Failed to read local TicketBox cache:", err);
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
    return events.filter((event) => {
      if (event.id === selectedMovie.id) return false;
      return (
        event.category === selectedMovie.category ||
        event.genre.some((genre) => selectedMovie.genre.includes(genre))
      );
    }).slice(0, 3);
  }, [events, selectedMovie]);

  const goHome = () => {
    setActiveScreen("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goHomeAfterFilter = (update: () => void) => {
    update();
    if (activeScreen !== "home") {
      setActiveScreen("home");
    }
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

  const clearHistory = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử đặt vé trên trình duyệt này?")) {
      setBookingsHistory([]);
      try {
        localStorage.removeItem(BOOKINGS_CACHE_KEY);
        localStorage.removeItem(LEGACY_BOOKINGS_CACHE_KEY);
      } catch (err) {
        console.error("Failed to clear local storage:", err);
      }
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

  const handleStartBookingInput = (movie: MovieEvent) => {
    setSelectedMovie(movie); // optimistic (card data)
    setActiveScreen("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
    // enrich with full detail from the API (movie.id carries the event slug)
    catalogClient
      .getEvent(movie.id)
      .then(async (detail) => {
        const showtimes = await catalogClient.getShowtimes(detail.id);
        setSelectedMovie(detailToMovie(detail, showtimes));
      })
      .catch((err) => console.error("Failed to load event detail:", err));
  };

  const handleProceedToSeats = (date: string, time: string) => {
    setBookingDate(date);
    setBookingTime(time);
    setActiveScreen("seats");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleProceedToCheckout = (selectedSeats: Seat[], totalPrice: number) => {
    setBookingSeats(selectedSeats);
    setBookingTotalPrice(totalPrice);
    setActiveScreen("checkout");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleConfirmPurchase = (payload: CheckoutPayload) => {
    const trackingId = "TB" + Math.floor(100000 + Math.random() * 900000);
    const timeNow = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Saigon" });

    const newBooking: Booking = {
      id: trackingId,
      movie: selectedMovie,
      selectedDate: bookingDate,
      selectedTime: bookingTime,
      selectedSeats: bookingSeats,
      customerName: payload.customer.name,
      customerEmail: payload.customer.email,
      customerPhone: payload.customer.phone,
      totalPrice: bookingTotalPrice,
      serviceFee: payload.serviceFee,
      discount: payload.discount,
      finalPrice: payload.finalPrice,
      paymentMethod: payload.paymentMethod,
      promoCode: payload.promoCode,
      deliveryChannel: "email_sms",
      status: "paid",
      qrStatus: "unused",
      bookingTime: timeNow,
      qrPayload: JSON.stringify({
        bookingId: trackingId,
        eventId: selectedMovie.id,
        event: selectedMovie.title,
        seats: bookingSeats.map((seat) => seat.id).join(","),
        time: `${bookingTime} - ${bookingDate}`,
        qrStatus: "unused",
      }),
    };

    saveBookingToHistory(newBooking);
    setFinalBooking(newBooking);
    setActiveScreen("ticket");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLogin = (user: Me) => {
    const name = user.nickname || user.email;
    setUserName(name);
    setAvatarUrl(user.avatarUrl);
    setShowAuthModal(false);
    try {
      localStorage.setItem(USER_CACHE_KEY, name);
    } catch (err) {
      console.error("Failed to save user:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await authClient.logout();
    } catch (err) {
      console.error("Logout failed:", err);
    }
    setUserName("");
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
        onSearchChange={(value) => goHomeAfterFilter(() => setSearchQuery(value))}
        onViewHistory={() => setActiveScreen("history")}
        onHomeClick={goHome}
        onLoginClick={() => (userName ? setShowAccountModal(true) : setShowAuthModal(true))}
        onAdminClick={() => {
          setActiveScreen("moderation");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
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
              onBookNow={() => handleStartBookingInput(heroMovie)}
            />

            <EventFilters
              activeCategory={activeCategory}
              onCategoryChange={(value) => goHomeAfterFilter(() => setActiveCategory(value))}
              activeDate={activeDate}
              onDateChange={(value) => goHomeAfterFilter(() => setActiveDate(value))}
              activeCity={activeCity}
              onCityChange={(value) => goHomeAfterFilter(() => setActiveCity(value))}
              maxPrice={maxPrice}
              onMaxPriceChange={(value) => goHomeAfterFilter(() => setMaxPrice(value))}
              availability={availability}
              onAvailabilityChange={(value) => goHomeAfterFilter(() => setAvailability(value))}
              wishlistCount={wishlistedIds.length}
            />

            <EventGrid
              events={filteredEvents}
              selectedEvent={heroMovie}
              onSelectEvent={handleSelectEventForTrailer}
              onBookNow={handleStartBookingInput}
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
            relatedEvents={relatedEvents}
            wishlistedIds={wishlistedIds}
            onBack={goHome}
            onToggleWishlist={handleToggleWishlist}
            onBookRelated={handleStartBookingInput}
            onProceedToSeatSelection={handleProceedToSeats}
          />
        )}

        {activeScreen === "seats" && (
          <SeatLayout
            event={selectedMovie}
            selectedDate={bookingDate}
            selectedTime={bookingTime}
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
            onBack={() => setActiveScreen("seats")}
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
            onClearHistory={clearHistory}
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
            <h5 className="font-display text-sm font-bold tracking-normal text-beige-kem">TICKETBOX FRONTEND MVP</h5>
            <p className="text-[10px] text-la-co">Mock data cho vé ca nhạc, hòa nhạc, kịch và phim</p>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-beige-kem/60">
            <span className="cursor-pointer transition hover:text-cam-dat">Chính sách hoàn vé</span>
            <span className="cursor-pointer transition hover:text-cam-dat">Điều khoản sử dụng</span>
            <span className="cursor-pointer transition hover:text-cam-dat">Hỗ trợ email/SMS</span>
          </div>

          <p className="text-center text-[10px] text-beige-kem/40 md:text-right">
            © 2026 TicketBox Mock. Frontend only.
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

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onLogin={handleLogin} />
      )}
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
          onManageEvents={() => {
            setShowAccountModal(false);
            setActiveScreen("organizer");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      {resetToken && <ResetPassword token={resetToken} />}
    </div>
  );
}

function TrustCard({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
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
