/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Calendar, Gift, Heart, MapPin, Star } from "lucide-react";
import { MovieEvent } from "../types";
import { formatEventDate } from "../services/formatDate";

interface EventGridProps {
  events: MovieEvent[];
  selectedEvent: MovieEvent;
  onSelectEvent: (event: MovieEvent) => void;
  onBookNow: (event: MovieEvent) => void;
  wishlistedIds: string[];
  onToggleWishlist: (eventId: string) => void;
}

/**
 * Status badges are solid stickers now rather than tinted glass. The fills are the light accent
 * tints, which keep their value in dark mode, so the label colour is the constant `on-tint` —
 * except `cancelled`, which sits on tomato and takes white (cream drops under 4.5:1 there).
 */
const statusMeta = {
  available: { label: "Còn vé", className: "bg-la-co text-on-tint" },
  low: { label: "Sắp hết", className: "bg-cam-dat text-on-tint" },
  sold_out: { label: "Hết vé", className: "bg-surface-2 text-ink-soft" },
  cancelled: { label: "Đã hủy", className: "bg-burgundy text-white" },
};

/**
 * The scalloped price tag. Drawn as a centre disc plus a ring of overlapping small discs — SVG
 * unions same-fill shapes, so the twelve bumps read as one flower without any path maths.
 */
function ScallopBlob({ children, title }: { children: React.ReactNode; title?: string }) {
  const bumps = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * Math.PI) / 6;
    return { cx: 50 + 38 * Math.cos(angle), cy: 50 + 38 * Math.sin(angle) };
  });

  return (
    <div className="relative h-[68px] w-[68px] shrink-0" title={title}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g fill="var(--color-cam-dat)">
          <circle cx="50" cy="50" r="39" />
          {bumps.map((b, i) => (
            <circle key={i} cx={b.cx} cy={b.cy} r="11" />
          ))}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-on-tint">
        {children}
      </div>
    </div>
  );
}

/**
 * The blob is only ~44px of usable width, so the full `vi-VN` currency string will not fit. Prices
 * are shortened to K/Tr there; the untruncated value stays on the element's `title`.
 */
function compactPrice(price: number) {
  if (price >= 1_000_000) {
    const millions = price / 1_000_000;
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}Tr`;
  }
  if (price >= 1_000) return `${Math.round(price / 1_000)}K`;
  return String(price);
}

export default function EventGrid({
  events,
  selectedEvent,
  onSelectEvent,
  onBookNow,
  wishlistedIds,
  onToggleWishlist,
}: EventGridProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const featuredEvents = events.filter((evt) => evt.isFeatured).slice(0, 2);

  return (
    <section className="mx-auto max-w-7xl space-y-10 px-4 py-16 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-beige-kem/25 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="font-display text-4xl font-black tracking-normal text-beige-kem sm:text-5xl">
            Khám phá lịch diễn đang mở bán
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-beige-kem/70">
            Tìm theo tên sự kiện, nghệ sĩ, phim, rạp, nhà hát hoặc địa điểm. Bộ lọc phía trên đang chạy bằng mock data để đội backend thay bằng API sau.
          </p>
        </div>
        <p className="font-mono text-sm text-ink-soft">
          {events.length} sự kiện phù hợp
        </p>
      </div>

      {featuredEvents.length > 0 && (
        <div className="grid grid-flow-dense grid-cols-1 gap-4 lg:grid-cols-6">
          {featuredEvents.map((evt, index) => (
            <article
              key={evt.id}
              className={`group relative min-h-[280px] overflow-hidden rounded-[20px] border-2 border-beige-kem bg-xanh-pho shadow-hard ${
                index === 0 ? "lg:col-span-4" : "lg:col-span-2"
              }`}
            >
              <img
                src={evt.imageUrl}
                alt={evt.title}
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-xanh-pho via-xanh-pho/65 to-transparent" />
              <div className="relative z-10 flex h-full min-h-[280px] flex-col justify-end p-6">
                <span className="label-eyebrow mb-4 inline-flex w-fit -rotate-3 items-center rounded-full border-2 border-beige-kem bg-bubblegum px-3 py-1 text-on-tint shadow-hard">
                  Banner nổi bật
                </span>
                <h3 className="max-w-xl font-display text-3xl font-black leading-none text-white sm:text-4xl">
                  {evt.title}
                </h3>
                <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-white/78">
                  {evt.description}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => onBookNow(evt)}
                    disabled={evt.status === "sold_out" || evt.status === "cancelled"}
                    className="inline-flex items-center rounded-xl bg-beige-kem px-5 py-3 text-xs font-black uppercase text-xanh-pho transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
                  >
                    {evt.status === "sold_out" ? "Hết vé" : "Mua vé"}
                  </button>
                  <button
                    onClick={() => onSelectEvent(evt)}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-white/40 bg-black/25 px-4 text-xs font-bold uppercase text-white transition hover:border-white hover:bg-white hover:text-black"
                    title="Xem trailer"
                  >
                    Xem trailer
                  </button>
                  <button
                    onClick={() => onToggleWishlist(evt.id)}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-white/40 bg-black/25 px-4 text-xs font-bold uppercase text-white transition hover:border-white hover:bg-white hover:text-black"
                    title="Yêu thích hoặc nhắc lịch"
                  >
                    {wishlistedIds.includes(evt.id) ? "Đã lưu" : "Lưu"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <div className="mx-auto max-w-lg rounded-2xl border-2 border-beige-kem bg-xanh-pho px-4 py-20 text-center">
          <h3 className="font-display text-lg font-semibold text-beige-kem">Không tìm thấy kết quả</h3>
          <p className="mt-2 text-sm text-beige-kem/60">
            Thử đổi từ khóa, ngày, thành phố, giá vé hoặc trạng thái còn vé.
          </p>
        </div>
      ) : (
        <div className="grid grid-flow-dense grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((evt) => {
            const isActiveHero = selectedEvent.id === evt.id;
            const isWishlisted = wishlistedIds.includes(evt.id);
            const meta = statusMeta[evt.status];
            const bookingDisabled = evt.status === "sold_out" || evt.status === "cancelled";

            return (
              <article
                key={evt.id}
                className={`group flex flex-col overflow-hidden rounded-[20px] border-2 bg-surface-2 transition-all duration-200 hover:-translate-x-[3px] hover:-translate-y-[3px] hover:shadow-hard-lg ${
                  isActiveHero ? "border-burgundy shadow-hard-lg" : "border-beige-kem shadow-hard"
                }`}
              >
                <div className="relative aspect-[16/10] overflow-hidden border-b-2 border-beige-kem">
                  <img
                    src={evt.imageUrl}
                    alt={evt.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute left-3 top-3 z-10 flex flex-wrap items-start gap-2">
                    <span
                      className={`label-eyebrow -rotate-3 rounded-full border-2 border-beige-kem px-2.5 py-1 shadow-hard ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    <span className="label-eyebrow rotate-2 rounded-full border-2 border-beige-kem bg-bubblegum px-2.5 py-1 text-on-tint shadow-hard">
                      {evt.genre[0]}
                    </span>
                  </div>
                  <button
                    onClick={() => onToggleWishlist(evt.id)}
                    className={`absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border-2 border-beige-kem shadow-hard transition hover:-translate-y-0.5 ${
                      isWishlisted ? "bg-burgundy text-white" : "bg-surface-2 text-beige-kem"
                    }`}
                    aria-pressed={isWishlisted}
                    title={isWishlisted ? "Bỏ khỏi wishlist" : "Thêm vào wishlist hoặc nhắc lịch"}
                  >
                    <Heart
                      className="h-4 w-4"
                      strokeWidth={2.5}
                      fill={isWishlisted ? "currentColor" : "none"}
                    />
                  </button>
                  {/*
                    The scrim is inert: it is the last child of the image, so without
                    `pointer-events-none` it sits over the wishlist button and swallows its clicks
                    even at `opacity-0`. Only the trailer button itself takes pointer events, and it
                    is centred so it never overlaps the corner controls.
                  */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      onClick={() => onSelectEvent(evt)}
                      className="label-eyebrow pointer-events-auto rounded-full border-2 border-beige-kem bg-surface-2 px-5 py-2.5 text-beige-kem shadow-hard transition hover:-translate-y-0.5"
                    >
                      Xem trailer
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="label-eyebrow rounded-full bg-bubblegum px-2.5 py-1 text-on-tint">
                      {evt.ageRating}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-beige-kem">
                      <Star className="h-3.5 w-3.5 fill-cam-dat text-ink-soft" strokeWidth={2.5} />
                      {evt.rating}
                    </span>
                  </div>

                  <div>
                    <h3 className="line-clamp-2 min-h-[3.4rem] font-display text-[22px] font-bold leading-tight text-beige-kem">
                      {evt.title}
                    </h3>
                    {evt.originalTitle && (
                      <p className="mt-1 line-clamp-1 font-mono text-[11px] text-ink-soft">
                        {evt.originalTitle}
                      </p>
                    )}
                  </div>

                  {/* Word labels ("Ngày", "Địa điểm") became icon chips — same meaning, one column narrower. */}
                  <div className="space-y-2 text-xs text-beige-kem">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-la-co text-on-tint">
                        <Calendar className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </span>
                      {/*
                        Only the nearest date: joining every date overflowed the row on events
                        running a week or more, and the full schedule is on the detail page. The
                        title carries the rest so the card still answers "when else?" on hover.
                      */}
                      <span
                        className="truncate font-mono"
                        title={
                          evt.dates.length > 1
                            ? evt.dates.map((d) => formatEventDate(d, true)).join(", ")
                            : undefined
                        }
                      >
                        {[evt.dates[0] && formatEventDate(evt.dates[0]), evt.times[0]]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-la-co text-on-tint">
                        <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </span>
                      <span className="truncate font-mono" title={evt.location}>
                        {evt.city} · {evt.venueName}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 rounded-2xl bg-bubblegum px-3 py-2.5 text-xs leading-relaxed text-on-tint">
                    <Gift className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
                    <span>{evt.comboOffer || "Nhập mã ưu đãi tại bước thanh toán."}</span>
                  </div>

                  <p className="text-xs text-ink-soft">
                    {evt.status === "sold_out"
                      ? "Bấm ♥ để được nhắc khi mở thêm suất."
                      : `Còn khoảng ${evt.ticketsLeft} vé`}
                  </p>

                  <div className="mt-auto flex items-center gap-3 pt-1">
                    <ScallopBlob title={formatPrice(evt.price)}>
                      <span className="label-eyebrow text-[9px] opacity-75">Từ</span>
                      <span className="font-mono text-sm font-bold leading-none">
                        {compactPrice(evt.price)}
                      </span>
                    </ScallopBlob>

                    <button
                      onClick={() => onBookNow(evt)}
                      disabled={bookingDisabled}
                      className="label-eyebrow ml-auto rounded-full border-2 border-beige-kem bg-burgundy px-6 py-3 text-white shadow-hard transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-ink-soft disabled:bg-surface-2 disabled:text-ink-soft disabled:shadow-none disabled:hover:translate-y-0"
                    >
                      {bookingDisabled ? "Nhắc tôi" : "Đặt vé"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
