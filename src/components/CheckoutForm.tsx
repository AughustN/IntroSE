/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useMemo, useState } from "react";
import { PROMO_VOUCHERS } from "../data";
import { CheckoutPayload, MovieEvent, Seat } from "../types";

interface CheckoutFormProps {
  event: MovieEvent;
  selectedDate: string;
  selectedTime: string;
  selectedSeats: Seat[];
  totalPrice: number;
  onBack: () => void;
  onConfirmBooking: (payload: CheckoutPayload) => void;
}

const paymentMethods = [
  { id: "wallet", label: "Ví điện tử", detail: "MoMo / ZaloPay / ShopeePay" },
  { id: "card", label: "Thẻ quốc tế", detail: "Visa / Mastercard / JCB" },
  { id: "bank", label: "Chuyển khoản", detail: "ATM / Internet Banking" },
  { id: "qr", label: "QR Pay", detail: "Quét mã thanh toán nhanh" },
];

export default function CheckoutForm({
  event,
  selectedDate,
  selectedTime,
  selectedSeats,
  totalPrice,
  onBack,
  onConfirmBooking,
}: CheckoutFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("wallet");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [paymentError, setPaymentError] = useState("");

  const serviceFee = Math.max(Math.round(totalPrice * 0.04), totalPrice ? 10000 : 0);
  const selectedPromo = PROMO_VOUCHERS.find((promo) => promo.code === appliedPromo);
  const discount = selectedPromo ? selectedPromo.discountAmount : 0;
  const finalPrice = Math.max(totalPrice + serviceFee - discount, 0);

  const paymentLabel = useMemo(() => {
    return paymentMethods.find((method) => method.id === paymentMethod)?.label || "Thanh toán";
  }, [paymentMethod]);

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
    setPaymentError("");
    if (!name || !email || !phone || !agreeTerms) return;

    onConfirmBooking({
      customer: { name, email, phone },
      paymentMethod: paymentLabel,
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
          Quay lại chọn ghế
        </button>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-beige-kem/45">
          <span className="opacity-60">01 Chọn suất</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span className="opacity-60">02 Chọn ghế</span>
          <span className="h-px w-6 bg-beige-kem/20" />
          <span className="font-semibold text-burgundy">03 Thanh toán</span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <section className="space-y-6 rounded-2xl border border-beige-kem/10 bg-xanh-pho/50 p-6 sm:p-8 lg:col-span-7">
          <div>
            <h3 className="font-display text-2xl font-black text-beige-kem">Thông tin người nhận vé</h3>
            <p className="mt-2 text-sm text-la-co">
              Vé điện tử sẽ được gửi mock qua email/SMS và lưu trong lịch sử mua vé của trình duyệt.
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
                <label className="block font-mono text-xs text-beige-kem/75">Số điện thoại SMS</label>
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
              <h4 className="font-display text-lg font-black text-beige-kem">Phương thức thanh toán</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {paymentMethods.map((method) => {
                  const selected = paymentMethod === method.id;
                  return (
                    <label
                      key={method.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${
                        selected
                          ? "border-burgundy bg-burgundy/10 text-beige-kem"
                          : "border-beige-kem/10 bg-white/[0.035] text-beige-kem/70 hover:border-cam-dat"
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={method.id}
                        checked={selected}
                        onChange={() => setPaymentMethod(method.id)}
                        className="sr-only"
                      />
                      <span>
                        <span className="block font-mono text-sm font-bold">{method.label}</span>
                        <span className="block text-xs text-beige-kem/55">{method.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {paymentMethod === "qr" && (
                <div className="grid gap-4 rounded-xl border border-la-co/25 bg-la-co/5 p-4 sm:grid-cols-[auto_1fr]">
                  <div className="grid h-28 w-28 place-items-center rounded-xl bg-beige-kem p-3 text-center font-mono text-xs font-black uppercase text-xanh-pho">
                    QR mock
                  </div>
                  <div className="text-sm leading-6 text-beige-kem/75">
                    <p className="font-display text-base font-bold text-beige-kem">QR thanh toán mock</p>
                    <p>Quét mã để mô phỏng thanh toán. Backend sau này cần webhook xác nhận trạng thái giao dịch.</p>
                  </div>
                </div>
              )}

              {paymentMethod === "bank" && (
                <div className="rounded-xl border border-cam-dat/25 bg-cam-dat/5 p-4 font-mono text-xs leading-6 text-beige-kem/75">
                  Ngân hàng mock: TICKETBANK / STK 20260611 / Nội dung: {event.affiliateCode}-{selectedSeats.map((seat) => seat.id).join("")}
                </div>
              )}
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

            {paymentError && (
              <div className="flex gap-3 rounded-xl border border-burgundy/40 bg-burgundy/10 p-4 text-sm text-beige-kem">
                <span className="font-bold text-burgundy">Lỗi:</span>
                <span>{paymentError}</span>
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
                Tôi đồng ý điều khoản bán vé, chính sách hoàn/đổi và xác nhận email/SMS có thể được gửi lại khi cần.
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <button
                type="submit"
                disabled={!name || !email || !phone || !agreeTerms}
                className="rounded-xl bg-burgundy px-6 py-4 text-sm font-black text-beige-kem shadow-xl transition hover:bg-burgundy/95 disabled:bg-beige-kem/10 disabled:text-beige-kem/35"
              >
                Hoàn tất thanh toán và xuất vé QR
              </button>
              <button
                type="button"
                onClick={() => setPaymentError("Thanh toán mock thất bại. Người dùng có thể đổi phương thức hoặc quay lại giữ ghế nếu reservation còn hạn.")}
                className="rounded-xl border border-burgundy/40 px-5 py-4 text-xs font-bold uppercase text-burgundy transition hover:bg-burgundy/10"
              >
                Mô phỏng lỗi
              </button>
            </div>
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
              <span>Ghế</span>
              <span className="font-bold text-cam-dat">{selectedSeats.map((seat) => seat.id).join(", ")}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Loại ghế</span>
              <span>{selectedSeats.filter((seat) => seat.type === "double").length} đôi / {selectedSeats.filter((seat) => seat.type === "single").length} đơn</span>
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
              <span>Mock UI cho xác nhận email/SMS, thanh toán an toàn, QR một lần và xử lý hủy/lỗi giao dịch.</span>
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
