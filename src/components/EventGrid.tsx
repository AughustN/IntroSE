/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MovieEvent } from "../types";

interface EventGridProps {
  events: MovieEvent[];
  selectedEvent: MovieEvent;
  onSelectEvent: (event: MovieEvent) => void;
  onBookNow: (event: MovieEvent) => void;
  wishlistedIds: string[];
  onToggleWishlist: (eventId: string) => void;
}

const statusMeta = {
  available: { label: "Còn vé", className: "border-la-co/40 bg-la-co/10 text-la-co" },
  low: { label: "Sắp hết", className: "border-cam-dat/45 bg-cam-dat/10 text-cam-dat" },
  sold_out: { label: "Hết vé", className: "border-stone-500/45 bg-stone-500/10 text-stone-300" },
  cancelled: { label: "Đã hủy", className: "border-burgundy/50 bg-burgundy/10 text-burgundy" },
};

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
      <div className="flex flex-col gap-4 border-b border-beige-kem/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="font-display text-4xl font-black tracking-normal text-beige-kem sm:text-5xl">
            Khám phá lịch diễn đang mở bán
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-beige-kem/70">
            Tìm theo tên sự kiện, nghệ sĩ, phim, rạp, nhà hát hoặc địa điểm. Bộ lọc phía trên đang chạy bằng mock data để đội backend thay bằng API sau.
          </p>
        </div>
        <p className="font-mono text-sm text-cam-dat">
          {events.length} sự kiện phù hợp
        </p>
      </div>

      {featuredEvents.length > 0 && (
        <div className="grid grid-flow-dense grid-cols-1 gap-4 lg:grid-cols-6">
          {featuredEvents.map((evt, index) => (
            <article
              key={evt.id}
              className={`group relative min-h-[280px] overflow-hidden rounded-2xl border border-beige-kem/10 bg-xanh-pho shadow-2xl ${
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
                <span className="mb-4 inline-flex w-fit items-center rounded-full border border-cam-dat/40 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-normal text-cam-dat backdrop-blur">
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
        <div className="mx-auto max-w-lg rounded-2xl border border-beige-kem/10 bg-xanh-pho/50 px-4 py-20 text-center">
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
                className={`group flex flex-col overflow-hidden rounded-2xl border bg-xanh-pho shadow-2xl transition-all duration-300 hover:-translate-y-1 ${
                  isActiveHero
                    ? "border-burgundy ring-2 ring-burgundy/35"
                    : "border-beige-kem/10 hover:border-cam-dat/45"
                }`}
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={evt.imageUrl}
                    alt={evt.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                  <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-normal backdrop-blur ${meta.className}`}>
                      {meta.label}
                    </span>
                    <span className="rounded-full border border-white/20 bg-black/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-normal text-white backdrop-blur">
                      {evt.genre[0]}
                    </span>
                  </div>
                  <button
                    onClick={() => onToggleWishlist(evt.id)}
                    className="absolute right-4 top-4 inline-flex h-9 items-center justify-center rounded-full border border-white/25 bg-black/35 px-3 text-[10px] font-bold uppercase text-white backdrop-blur transition hover:bg-white hover:text-xanh-pho"
                    title="Thêm vào wishlist hoặc nhắc lịch"
                  >
                    {isWishlisted ? "Đã lưu" : "Lưu"}
                  </button>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => onSelectEvent(evt)}
                      className="inline-flex items-center rounded-full border border-cam-dat/50 bg-xanh-pho px-4 py-2 text-xs font-bold text-beige-kem transition hover:border-cam-dat"
                    >
                      Xem trailer
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-between space-y-5 p-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded border border-cam-dat/25 bg-cam-dat/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-cam-dat">
                        {evt.ageRating}
                      </span>
                      <span className="font-mono text-xs text-la-co">
                        Điểm {evt.rating} ({evt.reviewCount})
                      </span>
                    </div>

                    <div>
                      <h3 className="line-clamp-2 min-h-[3.1rem] font-display text-xl font-black leading-tight text-beige-kem">
                        {evt.title}
                      </h3>
                      {evt.originalTitle && (
                        <p className="mt-1 line-clamp-1 font-mono text-[11px] text-cam-dat">
                          {evt.originalTitle}
                        </p>
                      )}
                    </div>

                    <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-beige-kem/70">
                      {evt.description}
                    </p>
                  </div>

                  <div className="space-y-2.5 border-t border-beige-kem/5 pt-4 font-mono text-xs text-beige-kem/62">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-la-co">Ngày</span>
                      <span className="truncate">{evt.dates.join(", ")} | {evt.times[0]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-la-co">Địa điểm</span>
                      <span className="truncate" title={evt.location}>
                        {evt.city} / {evt.venueName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-cam-dat">
                      <span className="font-bold">Vé</span>
                      <span>{evt.status === "sold_out" ? "Bấm Lưu để nhắc khi mở thêm suất" : `Còn khoảng ${evt.ticketsLeft} vé`}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-beige-kem/10 bg-white/[0.035] p-3 text-xs text-beige-kem/72">
                    <span className="font-mono font-bold text-la-co">Combo/Voucher: </span>
                    {evt.comboOffer || "Nhập mã ưu đãi tại bước thanh toán."}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] uppercase text-la-co">Giá vé từ</span>
                      <span className="font-mono text-sm font-bold text-cam-dat">
                        {formatPrice(evt.price)}
                      </span>
                    </div>

                    <button
                      onClick={() => onBookNow(evt)}
                      disabled={bookingDisabled}
                      className="inline-flex items-center rounded-xl bg-burgundy px-4 py-3 text-xs font-black uppercase text-beige-kem shadow-md transition hover:bg-burgundy/85 disabled:cursor-not-allowed disabled:bg-beige-kem/10 disabled:text-beige-kem/35"
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
