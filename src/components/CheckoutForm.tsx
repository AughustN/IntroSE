/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useState } from "react";
import { PROMO_VOUCHERS } from "../data";
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
  onConfirmBooking: (payload: CheckoutPayload) => void;
}

/**
 * Checkout is wallet-only (schema decision D2): money enters through a VNPay top-up into the
 * buyer's store-credit wallet, and buying a ticket debits that wallet in one local transaction.
 * There is no card, bank-transfer or e-wallet leg on an order — offering one here would contradict
 * the schema, the constitution's four-integration cap, and the seat lifecycle (DATA-03).
 *
 * The real balance, debit and ledger arrive with the wallet & checkout feature; this screen is
 * still a mock that writes to localStorage.
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
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);
  /** Simulates the one failure a wallet purchase actually has: not enough balance (UC-12 A2). */
  const [simulateShortfall, setSimulateShortfall] = useState(false);

  const isSeated = event.eventType === "seated";
  const serviceFee = Math.max(Math.round(totalPrice * 0.04), totalPrice ? 10000 : 0);
  const selectedPromo = PROMO_VOUCHERS.find((promo) => promo.code === appliedPromo);
  const discount = selectedPromo ? selectedPromo.discountAmount : 0;
  const finalPrice = Math.max(totalPrice + serviceFee - discount, 0);

  const handleApplyPromo = () => {
    const normalized = promoInput.trim().toUpperCase();
    const voucher = PROMO_VOUCHERS.find((promo) => promo.code === normalized);

    if (!voucher) {
      setAppliedPromo("");
      setPromoMessage("Mã không tồn tại trong mock data.");
      return;
    }

    if (totalPrice < voucher.minOrder) {
      setAppliedPromo("");
      setPromoMessage(`Đơn cần tối thiểu ${formatPrice(voucher.minOrder)} để dùng ${voucher.code}.`);
      return;
    }

    setAppliedPromo(voucher.code);
    setPromoMessage(`${voucher.label} đã được áp dụng.`);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name || !email || !phone || !agreeTerms || simulateShortfall) return;

    onConfirmBooking({
      customer: { name, email, phone },
      paymentMethod: PAYMENT_METHOD_LABEL,
      serviceFee,
      discount,
      finalPrice,
      promoCode: selectedPromo?.code,
    });
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
            <h3 className="font-display text-2xl font-black text-beige-kem">Thông tin người nhận vé</h3>
            <p className="mt-2 text-sm text-la-co">
              Vé điện tử sẽ được gửi qua email và hiển thị trong thông báo trong ứng dụng (không có SMS).
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

              <div className="rounded-xl border border-cam-dat/25 bg-cam-dat/5 p-4 font-mono text-[11px] leading-5 text-cam-dat">
                Số dư ví và giao dịch trừ tiền chưa nối API — màn hình này vẫn là mock, vé được lưu
                trong trình duyệt. Tính năng ví (nạp tiền qua VNPay + thanh toán) sẽ thay thế phần này.
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-beige-kem/62">
                <input
                  type="checkbox"
                  checked={simulateShortfall}
                  onChange={(e) => setSimulateShortfall(e.target.checked)}
                  className="mt-0.5 accent-burgundy"
                />
                <span>Mô phỏng số dư không đủ</span>
              </label>
            </div>

            <div className="space-y-3 border-t border-beige-kem/10 pt-6">
              <h4 className="font-display text-lg font-black text-beige-kem">
                Mã giảm giá
              </h4>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  placeholder="WEEKEND50, FIRSTBOOK, GROUP4"
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value)}
                  className="h-11 rounded-xl border border-beige-kem/20 bg-xanh-pho px-4 text-sm uppercase text-beige-kem outline-none transition focus:border-cam-dat"
                />
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  className="rounded-xl bg-beige-kem px-5 py-3 text-xs font-black uppercase text-xanh-pho transition hover:bg-white"
                >
                  Áp dụng
                </button>
              </div>
              {promoMessage && (
                <p className={`font-mono text-xs ${selectedPromo ? "text-la-co" : "text-cam-dat"}`}>
                  {promoMessage}
                </p>
              )}
            </div>

            {simulateShortfall && (
              <div className="space-y-2 rounded-xl border border-burgundy/40 bg-burgundy/10 p-4 text-sm text-beige-kem">
                <p>
                  <span className="font-bold text-burgundy">Số dư không đủ.</span> Cần nạp thêm{" "}
                  <span className="font-mono font-bold">{formatPrice(finalPrice)}</span> để hoàn tất
                  đơn này.
                </p>
                <p className="font-mono text-[11px] leading-5 text-beige-kem/62">
                  Không có gì được tạo ra: chưa có đơn hàng, chưa trừ tiền, chưa xuất vé. Ghế bạn giữ
                  vẫn chạy theo TTL bình thường, không được gia hạn thêm vì đang chờ nạp tiền.
                </p>
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-burgundy/40 px-4 py-2 text-xs font-bold uppercase text-burgundy/50"
                  title="Nạp tiền sẽ có ở tính năng ví"
                >
                  Nạp thêm vào ví (sắp có)
                </button>
              </div>
            )}

            <div className="flex items-start gap-2 text-xs leading-relaxed text-beige-kem/62">
              <input
                id="agree-terms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 accent-burgundy"
              />
              <label htmlFor="agree-terms" className="cursor-pointer select-none">
                Tôi đồng ý điều khoản bán vé và chính sách hoàn vé (hoàn tiền về ví, trước giờ diễn 24 tiếng).
              </label>
            </div>

            <button
              type="submit"
              disabled={!name || !email || !phone || !agreeTerms || simulateShortfall}
              className="w-full rounded-xl bg-burgundy px-6 py-4 text-sm font-black text-beige-kem shadow-xl transition hover:bg-burgundy/95 disabled:bg-beige-kem/10 disabled:text-beige-kem/35"
            >
              Trừ tiền từ ví và xuất vé QR
            </button>
          </form>
        </section>

        <aside className="space-y-6 rounded-2xl border border-beige-kem/10 bg-xanh-pho/25 p-6 lg:col-span-5">
          <div>
            <h4 className="font-display text-xl font-black text-beige-kem">Tóm tắt đơn hàng</h4>
            <p className="mt-1 font-mono text-xs uppercase text-la-co">Hiển thị phí trước khi thanh toán</p>
          </div>

          <div className="flex gap-4">
            <img
              src={event.imageUrl}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="h-24 w-20 rounded-xl object-cover shadow"
            />
            <div className="min-w-0 flex-1">
              <h5 className="line-clamp-2 font-display text-lg font-black text-beige-kem">{event.title}</h5>
              <p className="mt-1 font-mono text-xs text-cam-dat">{event.venueName}</p>
              <p className="mt-3 rounded-lg border border-beige-kem/10 bg-white/[0.035] px-3 py-2 font-mono text-xs text-beige-kem/70">
                {selectedTime} / {selectedDate}
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t border-dashed border-beige-kem/10 pt-4 font-mono text-xs text-beige-kem/78">
            <div className="flex justify-between gap-4">
              <span>{isSeated ? "Ghế" : "Vé"}</span>
              <span className="font-bold text-cam-dat">{selectedSeats.map((seat) => seat.id).join(", ")}</span>
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
            <div className="flex justify-between gap-4">
              <span>Phí dịch vụ</span>
              <span>{formatPrice(serviceFee)}</span>
            </div>
            <div className="flex justify-between gap-4 text-la-co">
              <span>Giảm giá</span>
              <span>-{formatPrice(discount)}</span>
            </div>
          </div>

          <div className="border-t border-beige-kem/10 pt-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-xs uppercase text-beige-kem/60">Cần thanh toán</span>
              <span className="font-display text-3xl font-black text-burgundy">{formatPrice(finalPrice)}</span>
            </div>
            <div className="mt-4 rounded-xl border border-la-co/20 bg-la-co/5 p-3 text-[11px] leading-5 text-la-co">
              <span>Mock UI cho xác nhận qua email, trừ tiền từ ví trong một giao dịch, và QR dùng một lần.</span>
            </div>
            <div className="mt-3 rounded-xl border border-cam-dat/20 bg-cam-dat/5 p-3 text-[11px] leading-5 text-cam-dat">
              <span>Vé sẽ xuất hiện trong Vé của tôi, có thể in/tải lại/gửi lại email ở màn vé.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
