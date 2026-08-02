/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useState } from "react";
import { CheckoutPayload, MovieEvent, Seat } from "../types";
import { formatHoldClock } from "../services/holdSession";

interface CheckoutFormProps {
  event: MovieEvent;
  selectedDate: string;
  selectedTime: string;
  selectedSeats: Seat[];
  totalPrice: number;
  /** Milliseconds left on the hold placed in step 02 — the same clock, not a new one. */
  remainingMs: number;
  /** "Quay lại chọn ghế" for a seated event, "…chọn số lượng vé" for general admission. */
  backLabel: string;
  onBack: () => void;
  onConfirmBooking: (payload: CheckoutPayload) => Promise<void>;
}

/**
 * Checkout is wallet-only (schema decision D2): money enters through a VNPay top-up into the
 * buyer's store-credit wallet, and buying a ticket debits that wallet in one local transaction.
 * There is no card, bank-transfer or e-wallet leg on an order — offering one here would contradict
 * the schema, the constitution's four-integration cap, and the seat lifecycle (DATA-03).
 *
 */
const PAYMENT_METHOD_LABEL = "Ví TixHub";

export default function CheckoutForm({
  event,
  selectedDate,
  selectedTime,
  selectedSeats,
  totalPrice,
  remainingMs,
  backLabel,
  onBack,
  onConfirmBooking,
}: CheckoutFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const isSeated = event.eventType === "seated";
  const serviceFee = 0;
  const discount = 0;
  const finalPrice = totalPrice;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !email || !phone || !agreeTerms || submitting) return;

    setSubmitting(true);
    try {
      await onConfirmBooking({
        customer: { name, email, phone },
        paymentMethod: PAYMENT_METHOD_LABEL,
        serviceFee,
        discount,
        finalPrice,
      });
    } finally {
      setSubmitting(false);
    }
  };

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
          {backLabel}
        </button>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-beige-kem/45">
          <span className="opacity-60">01 Chọn suất</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span className="opacity-60">02 {isSeated ? "Chọn ghế" : "Chọn số lượng vé"}</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span className="font-semibold text-burgundy">03 Thanh toán</span>

          {/* Same hold, same clock as step 02 — going back does not restart it. */}
          <span className="inline-flex items-center gap-2 rounded-lg border border-cam-dat/30 bg-cam-dat/5 px-2.5 py-1 text-cam-dat">
            Giữ chỗ
            <b className="text-sm font-black text-beige-kem">{formatHoldClock(remainingMs)}</b>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <section className="space-y-6 rounded-2xl border border-beige-kem/10 bg-xanh-pho/50 p-6 sm:p-8 lg:col-span-7">
          <div>
            <h3 className="font-display text-2xl font-black text-beige-kem">
              Thông tin người nhận vé
            </h3>
            <p className="mt-2 text-sm text-la-co">
              Vé điện tử sẽ được gửi qua email và hiển thị trong thông báo trong ứng dụng (không có
              SMS).
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block font-mono text-xs text-beige-kem/75">Họ và tên</label>
              <input
                type="text"
                required
                placeholder="Nhập đầy đủ tên của bạn"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-xl border border-beige-kem/20 bg-xanh-pho px-4 text-sm text-beige-kem outline-none transition focus:border-cam-dat"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block font-mono text-xs text-beige-kem/75">Email nhận vé</label>
                <input
                  type="email"
                  required
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-xl border border-beige-kem/20 bg-xanh-pho px-4 text-sm text-beige-kem outline-none transition focus:border-cam-dat"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-mono text-xs text-beige-kem/75">Số điện thoại</label>
                <input
                  type="tel"
                  required
                  placeholder="09xx xxx xxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 w-full rounded-xl border border-beige-kem/20 bg-xanh-pho px-4 text-sm text-beige-kem outline-none transition focus:border-cam-dat"
                />
              </div>
            </div>

            <div className="space-y-3 border-t border-beige-kem/10 pt-6">
              <h4 className="font-display text-lg font-black text-beige-kem">Thanh toán bằng ví</h4>

              <div className="rounded-xl border border-burgundy bg-burgundy/10 p-4">
                <span className="block font-mono text-sm font-bold text-beige-kem">
                  {PAYMENT_METHOD_LABEL} · số dư tài khoản
                </span>
                <span className="mt-1 block text-xs leading-5 text-beige-kem/62">
                  Mua vé là trừ thẳng vào số dư ví, xong ngay trong một giao dịch — không qua cổng
                  thanh toán nào. Tiền chỉ vào ví bằng cách nạp qua VNPay, và chỉ ra khỏi ví dưới
                  dạng vé; hoàn vé trả tiền về lại ví, không rút ra tiền mặt.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs leading-relaxed text-beige-kem/62">
              <input
                id="agree-terms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 accent-burgundy"
              />
              <label htmlFor="agree-terms" className="cursor-pointer select-none">
                Tôi đồng ý điều khoản bán vé và chính sách hoàn vé (hoàn tiền về ví, trước giờ diễn
                24 tiếng).
              </label>
            </div>

            <button
              type="submit"
              disabled={!name || !email || !phone || !agreeTerms || submitting}
              className="w-full rounded-xl bg-burgundy px-6 py-4 text-sm font-black text-beige-kem shadow-xl transition hover:bg-burgundy/95 disabled:bg-beige-kem/10 disabled:text-beige-kem/35"
            >
              {submitting ? "Đang thanh toán..." : "Trừ tiền từ ví và xuất vé QR"}
            </button>
          </form>
        </section>

        <aside className="space-y-6 rounded-2xl border border-beige-kem/10 bg-xanh-pho/25 p-6 lg:col-span-5">
          <div>
            <h4 className="font-display text-xl font-black text-beige-kem">Tóm tắt đơn hàng</h4>
            <p className="mt-1 font-mono text-xs uppercase text-la-co">
              Hiển thị phí trước khi thanh toán
            </p>
          </div>

          <div className="flex gap-4">
            <img
              src={event.imageUrl}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="h-24 w-20 rounded-xl object-cover shadow"
            />
            <div className="min-w-0 flex-1">
              <h5 className="line-clamp-2 font-display text-lg font-black text-beige-kem">
                {event.title}
              </h5>
              <p className="mt-1 font-mono text-xs text-cam-dat">{event.venueName}</p>
              <p className="mt-3 rounded-lg border border-beige-kem/10 bg-white/[0.035] px-3 py-2 font-mono text-xs text-beige-kem/70">
                {selectedTime} / {selectedDate}
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t border-dashed border-beige-kem/10 pt-4 font-mono text-xs text-beige-kem/78">
            <div className="flex justify-between gap-4">
              <span>{isSeated ? "Ghế" : "Vé"}</span>
              <span className="font-bold text-cam-dat">
                {selectedSeats.map((seat) => seat.id).join(", ")}
              </span>
            </div>
            {/* Seat type is a seated-event concept; general admission counts tickets instead. */}
            <div className="flex justify-between gap-4">
              <span>{isSeated ? "Loại ghế" : "Số lượng"}</span>
              <span>
                {isSeated
                  ? `${selectedSeats.filter((seat) => seat.type === "double").length} đôi / ${selectedSeats.filter((seat) => seat.type === "single").length} đơn`
                  : `${selectedSeats.length} vé`}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Tạm tính</span>
              <span>{formatPrice(totalPrice)}</span>
            </div>
          </div>

          <div className="border-t border-beige-kem/10 pt-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-xs uppercase text-beige-kem/60">Cần thanh toán</span>
              <span className="font-display text-3xl font-black text-burgundy">
                {formatPrice(finalPrice)}
              </span>
            </div>
            <div className="mt-4 rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-[11px] leading-5 text-la-co">
              <span>
                Ví, đơn hàng và mã vé được tạo trong một giao dịch khi thanh toán thành công.
              </span>
            </div>
            <div className="mt-3 rounded-xl border border-cam-dat/20 bg-cam-dat/5 p-3 text-[11px] leading-5 text-cam-dat">
              <span>
                Vé sẽ xuất hiện trong Vé của tôi, có thể in/tải lại/gửi lại email ở màn vé.
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
