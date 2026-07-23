/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { MovieEvent } from "../types";

interface EventDetailProps {
  event: MovieEvent;
  relatedEvents: MovieEvent[];
  wishlistedIds: string[];
  onBack: () => void;
  onToggleWishlist: (eventId: string) => void;
  onBookRelated: (event: MovieEvent) => void;
  onProceedToSeatSelection: (date: string, time: string) => void;
}

const statusLabels = {
  available: "Còn vé",
  low: "Sắp hết vé",
  sold_out: "Hết vé",
  cancelled: "Đã hủy",
};

export default function EventDetail({
  event,
  relatedEvents,
  wishlistedIds,
  onBack,
  onToggleWishlist,
  onBookRelated,
  onProceedToSeatSelection,
}: EventDetailProps) {
  const [selectedDate, setSelectedDate] = useState<string>(event.dates[0] || "");
  const [selectedTime, setSelectedTime] = useState<string>(event.times[0] || "");
  const bookingDisabled = event.status === "sold_out" || event.status === "cancelled";
  const isWishlisted = wishlistedIds.includes(event.id);

  useEffect(() => {
    setSelectedDate(event.dates[0] || "");
    setSelectedTime(event.times[0] || "");
  }, [event.id, event.dates, event.times]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-beige-kem/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 font-mono text-sm text-la-co transition hover:text-beige-kem"
        >
          Quay lại danh sách
        </button>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-beige-kem/45">
          <span className="font-semibold text-burgundy">01 Chọn suất</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span>02 Chọn ghế</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span>03 Thanh toán</span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <aside className="space-y-6 rounded-2xl border border-beige-kem/10 bg-xanh-pho/50 p-5 lg:col-span-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-2xl">
            <img
              src={event.imageUrl}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-xanh-pho/90 via-transparent to-transparent" />
            <button
              onClick={() => onToggleWishlist(event.id)}
              className="absolute right-4 top-4 inline-flex h-10 items-center justify-center rounded-full border border-white/25 bg-black/35 px-3 text-[10px] font-bold uppercase text-white backdrop-blur transition hover:bg-white hover:text-xanh-pho"
              title="Wishlist hoặc nhắc lịch"
            >
              {isWishlisted ? "Đã lưu" : "Lưu"}
            </button>
            <div className="absolute bottom-4 left-4 rounded-lg bg-burgundy px-3 py-1 font-mono text-xs font-bold text-beige-kem shadow">
              {statusLabels[event.status]} / còn {event.ticketsLeft} vé
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-cam-dat px-2 py-0.5 font-mono text-xs font-bold text-xanh-pho">
                {event.ageRating}
              </span>
              <span className="font-mono text-xs font-semibold text-la-co">
                {event.rating} / {event.reviewCount} đánh giá
              </span>
            </div>

            <div>
              <h2 className="font-display text-3xl font-black leading-tight text-beige-kem sm:text-4xl">
                {event.title}
              </h2>
              {event.originalTitle && (
                <p className="mt-1 font-mono text-sm text-cam-dat">{event.originalTitle}</p>
              )}
            </div>

            <p className="rounded-xl border border-beige-kem/10 bg-beige-kem/5 p-3 text-xs leading-relaxed text-la-co">
              <span className="mb-1 block font-semibold text-beige-kem">Độ tuổi phù hợp</span>
              {event.ageDescription}
            </p>

            <p className="text-sm leading-7 text-beige-kem/80">{event.description}</p>

            <div className="space-y-3 border-t border-beige-kem/10 pt-4 text-xs text-beige-kem/72">
              <div className="flex items-center gap-3">
                <span className="font-bold text-cam-dat">Thời lượng</span>
                <span>{event.duration} phút</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-cam-dat">Thể loại</span>
                <span>{event.genre.join(", ")}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-cam-dat">Đơn vị/nghệ sĩ</span>
                <span>{event.cast.join(", ")}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="shrink-0 font-bold text-cam-dat">Địa điểm</span>
                <span>{event.location}</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-6 lg:col-span-7">
          <section className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
            <h3 className="mb-4 font-display text-xl font-black text-beige-kem">
              Hạng vé đang bán
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              {event.ticketTiers.map((tier) => (
                <div key={tier.id} className="rounded-xl border border-beige-kem/10 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-base font-black text-beige-kem">{tier.label}</span>
                    {tier.badge && (
                      <span className="rounded-full border border-cam-dat/35 bg-cam-dat/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cam-dat">
                        {tier.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-sm font-bold text-cam-dat">{formatPrice(tier.price)}</p>
                  <p className="mt-2 text-xs leading-5 text-beige-kem/62">{tier.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
              <h3 className="mb-4 font-display text-lg font-black text-beige-kem">
                Chọn ngày
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {event.dates.map((date) => {
                  const isSelected = selectedDate === date;
                  return (
                    <button
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      className={`rounded-xl border p-3 text-center transition ${
                        isSelected
                          ? "border-burgundy bg-burgundy text-beige-kem"
                          : "border-beige-kem/10 bg-white/[0.035] text-beige-kem/78 hover:border-cam-dat"
                      }`}
                    >
                      <span className="block font-mono text-xs font-bold">{date}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
              <h3 className="mb-4 font-display text-lg font-black text-beige-kem">
                Chọn giờ
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {event.times.map((time) => {
                  const isSelected = selectedTime === time;
                  return (
                    <button
                      key={time}
                      onClick={() => setSelectedTime(time)}
                      className={`rounded-xl border px-2 py-3.5 text-center font-mono text-sm font-bold transition ${
                        isSelected
                          ? "border-burgundy bg-burgundy text-beige-kem"
                          : "border-beige-kem/10 bg-white/[0.035] text-beige-kem/78 hover:border-cam-dat"
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-la-co/25 bg-la-co/5 p-4">
              <h4 className="font-display font-bold text-beige-kem">Hoàn/đổi vé</h4>
              <p className="mt-2 text-xs leading-5 text-beige-kem/68">{event.refundPolicy}</p>
            </div>
            <div className="rounded-2xl border border-cam-dat/25 bg-cam-dat/5 p-4">
              <h4 className="font-display font-bold text-beige-kem">Hướng dẫn đến nơi</h4>
              <p className="mt-2 text-xs leading-5 text-beige-kem/68">{event.venueGuide}</p>
            </div>
            <div className="rounded-2xl border border-burgundy/30 bg-burgundy/5 p-4">
              <h4 className="font-display font-bold text-beige-kem">Nhắc lịch</h4>
              <p className="mt-2 text-xs leading-5 text-beige-kem/68">
                Bấm Lưu để thêm vào wishlist và nhắc lịch gần ngày diễn. Trạng thái này đang lưu local trong frontend.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-beige-kem/10 bg-xanh-pho/40 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-xs uppercase text-la-co">Suất bạn chọn</p>
                <h4 className="mt-1 font-display text-lg font-black text-beige-kem">
                  {selectedDate || "Chưa chọn"} / {selectedTime || "Chưa chọn"} / {event.venueName}
                </h4>
              </div>
              <button
                onClick={() => onProceedToSeatSelection(selectedDate, selectedTime)}
                disabled={!selectedDate || !selectedTime || bookingDisabled}
                className="inline-flex items-center justify-center rounded-xl bg-burgundy px-7 py-4 text-sm font-black text-beige-kem shadow-xl transition hover:bg-burgundy/90 disabled:cursor-not-allowed disabled:bg-beige-kem/10 disabled:text-beige-kem/35"
              >
                {bookingDisabled ? "Chưa thể đặt vé" : "Tiếp tục chọn ghế"}
              </button>
            </div>
          </section>

          {relatedEvents.length > 0 && (
            <section className="rounded-2xl border border-beige-kem/10 bg-white/[0.025] p-6">
              <h3 className="mb-4 font-display text-xl font-black text-beige-kem">Gợi ý tương tự</h3>
              <div className="grid gap-3 md:grid-cols-3">
                {relatedEvents.map((related) => (
                  <button
                    key={related.id}
                    onClick={() => onBookRelated(related)}
                    className="group overflow-hidden rounded-xl border border-beige-kem/10 bg-xanh-pho text-left transition hover:border-cam-dat"
                  >
                    <img
                      src={related.imageUrl}
                      alt={related.title}
                      referrerPolicy="no-referrer"
                      className="h-24 w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <span className="block p-3">
                      <span className="line-clamp-2 font-display text-sm font-bold text-beige-kem">{related.title}</span>
                      <span className="mt-1 block font-mono text-[11px] text-cam-dat">{formatPrice(related.price)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
