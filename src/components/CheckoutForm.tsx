/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useState } from "react";
import { loadCheckoutDetails, saveCheckoutDetails } from "../services/checkoutDetails";
import { CheckoutPayload, MovieEvent, Seat } from "../types";
import { walletClient, type WalletLimits } from "../services/walletClient";
import TopUpSheet from "./wallet/TopUpSheet";
import {
  type BookingStep,
  BookingHeader,
  BookingLayout,
  BookingSection,
  OrderSummary,
  TicketStub,
  type SummaryLine,
} from "./booking/BookingChrome";
import { formatVnd } from "../services/currency";

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
  /** The hold being bought. Carried into a top-up so the seats survive the VNPay detour. */
  reservationId: number | null;
  /**
   * Set by the parent when checkout came back `insufficient_wallet_balance`, carrying the server's
   * numbers so the top-up opens pre-filled with the exact shortfall (UC-12 A2).
   */
  shortfall: { required: number; balance: number; shortfall: number } | null;
  /**
   * The signed-in account, used to seed the three buyer fields the first time this hold reaches
   * checkout. Checkout already requires an identity, so asking somebody to retype what the account
   * knows is work for nothing — and it is the second line of defence for the top-up round trip, for
   * the case where `sessionStorage` is unavailable and nothing could be restored.
   */
  buyer: { name: string; email: string; phone: string } | null;
  onBack: () => void;
  /** Jump back to a finished step. The last step, so nothing is ahead. */
  onGoToStep?: (step: BookingStep) => void;
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
  reservationId,
  shortfall,
  buyer,
  onBack,
  onGoToStep,
  onConfirmBooking,
}: CheckoutFormProps) {
  /*
   * Seeded once, from what survived the last detour and then from the account.
   *
   * A lazy initialiser rather than an effect: the very first paint has to show the restored values,
   * or a buyer coming back from VNPay sees three empty boxes and starts retyping before the effect
   * that would have filled them has run.
   */
  const restored = useState(() => loadCheckoutDetails(reservationId))[0];
  const [name, setName] = useState(restored?.name || buyer?.name || "");
  const [email, setEmail] = useState(restored?.email || buyer?.email || "");
  const [phone, setPhone] = useState(restored?.phone || buyer?.phone || "");
  const [agreeTerms, setAgreeTerms] = useState(restored?.agreeTerms ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [limits, setLimits] = useState<WalletLimits | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

  // The balance belongs on the order summary: UC-12 step 1 says the buyer reviews the total
  // *alongside* what they have, so a shortfall is visible before they commit rather than after.
  useEffect(() => {
    let cancelled = false;
    walletClient
      .summary()
      .then((summary) => {
        if (cancelled) return;
        setBalance(summary.balanceAmount);
        setLimits(summary.limits);
      })
      .catch(() => {
        // A wallet that cannot be read is not a reason to block the screen — the server re-checks
        // the balance under a row lock when they submit anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Written on every change, so whatever is on screen is what comes back.
   *
   * Saving here rather than at the moment the top-up sheet opens: the buyer can also be sent away
   * by a bank app, a password manager, or simply reloading — and none of those give us a hook to
   * save on the way out.
   */
  useEffect(() => {
    if (reservationId === null) return;
    saveCheckoutDetails({ reservationId, name, email, phone, agreeTerms });
  }, [reservationId, name, email, phone, agreeTerms]);

  // Arriving back with a rejection means the sheet should already be open, pre-filled.
  useEffect(() => {
    if (shortfall) {
      setShowTopUp(true);
      setBalance(shortfall.balance);
    }
  }, [shortfall]);

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

  /**
   * The order, one line per seat or ticket.
   *
   * A seated purchase names every seat, because "3 ghế" is not something a buyer can check against
   * the map they just clicked. General admission has no seat to name, so the same rows read as the
   * tickets they are.
   */
  const summaryLines: SummaryLine[] = selectedSeats.map((seat, index) => ({
    key: String(seat.showtimeSeatId ?? `${seat.id}-${index}`),
    label: isSeated ? `Ghế ${seat.id}` : seat.id,
    detail: isSeated && seat.row ? `Hàng ${seat.row}` : undefined,
    amount: seat.price,
  }));

  const canSubmit = Boolean(name && email && phone && agreeTerms) && !submitting;

  /** The form lives in the left column; the summary's button is what submits it. */
  const formId = "checkout-form";

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <BookingHeader
        backLabel={backLabel}
        onBack={onBack}
        /*
          Last step either way, but "last" is a different number in each flow: a seated purchase
          has three chapters and a general-admission one has two. Hardcoding 3 left the general
          admission bar with nothing highlighted, because there is no third chapter to match.
        */
        current={isSeated ? 3 : 2}
        seated={isSeated}
        onGoToStep={onGoToStep}
      />

      <TicketStub event={event} date={selectedDate} time={selectedTime} />

      <BookingLayout
        aside={
          <OrderSummary
            event={event}
            date={selectedDate}
            time={selectedTime}
            venue={event.venueName || event.location}
            lines={summaryLines}
            total={finalPrice}
            holdMs={remainingMs}
            emptyLabel="Chưa có vé nào"
            ctaLabel={submitting ? "Đang thanh toán…" : "Trừ ví và xuất vé"}
            /*
             * `requestSubmit`, not `submit`: the plain method skips validation and every `onSubmit`
             * handler, so the required fields would go unchecked and `handleSubmit` would never run.
             */
            onCta={() =>
              (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()
            }
            ctaDisabled={!canSubmit}
            note="Ví, đơn hàng và mã vé được tạo trong một giao dịch khi thanh toán thành công."
          >
            {balance !== null && (
              <div className="flex items-baseline justify-between gap-3 font-meta text-meta">
                <span className="text-ink-soft">Số dư ví</span>
                <b className={balance < finalPrice ? "text-burgundy-ink" : "text-beige-kem"}>
                  {formatVnd(balance)}
                </b>
              </div>
            )}
          </OrderSummary>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-10">
          <BookingSection
            step="03"
            title="Người nhận vé"
            hint="Vé điện tử gửi qua email và hiện trong thông báo trong ứng dụng (không có SMS)."
          >
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="checkout-name"
                  className="block font-meta text-eyebrow tracking-[0.08em] text-ink-soft"
                >
                  Họ và tên
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  required
                  placeholder="Nhập đầy đủ tên của bạn"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 w-full border-b border-beige-kem/40 bg-transparent text-body text-beige-kem outline-none transition placeholder:text-ink-soft/60 focus:border-burgundy"
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-email"
                    className="block font-meta text-eyebrow tracking-[0.08em] text-ink-soft"
                  >
                    Email nhận vé
                  </label>
                  <input
                    id="checkout-email"
                    type="email"
                    required
                    placeholder="name@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 w-full border-b border-beige-kem/40 bg-transparent text-body text-beige-kem outline-none transition placeholder:text-ink-soft/60 focus:border-burgundy"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-phone"
                    className="block font-meta text-eyebrow tracking-[0.08em] text-ink-soft"
                  >
                    Số điện thoại
                  </label>
                  <input
                    id="checkout-phone"
                    type="tel"
                    required
                    placeholder="09xx xxx xxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-11 w-full border-b border-beige-kem/40 bg-transparent text-body text-beige-kem outline-none transition placeholder:text-ink-soft/60 focus:border-burgundy"
                  />
                </div>
              </div>
            </div>
          </BookingSection>

          <BookingSection
            step="04"
            title="Thanh toán"
            hint="Mua vé trừ thẳng vào số dư ví, xong trong một giao dịch — không qua cổng thanh toán nào. Tiền vào ví bằng cách nạp qua VNPay; hoàn vé trả tiền về lại ví."
          >
            <div className="space-y-5">
              <div className="flex items-baseline justify-between gap-4 border border-beige-kem/35 px-4 py-3">
                <span className="font-display text-body font-bold uppercase tracking-[0.04em] text-beige-kem">
                  {PAYMENT_METHOD_LABEL}
                </span>
                <span className="font-meta text-meta text-ink-soft">
                  {balance === null ? "Đang tải số dư…" : `Số dư ${formatVnd(balance)}`}
                </span>
              </div>

              {/* UC-12 A2: the shortfall is named, and topping it up is one click — not a dead end. */}
              {shortfall && !showTopUp && (
                <div className="space-y-3 border border-burgundy/50 p-4">
                  <p className="text-body leading-6 text-beige-kem">
                    <span className="font-bold text-burgundy-ink">Số dư không đủ.</span> Cần nạp
                    thêm{" "}
                    <span className="font-meta font-bold">{formatVnd(shortfall.shortfall)}</span> để
                    hoàn tất đơn này.
                  </p>
                  <p className="font-meta text-meta leading-5 text-ink-soft">
                    Chưa có gì được tạo ra: chưa có đơn hàng, chưa trừ tiền, chưa xuất vé. Chỗ bạn
                    giữ vẫn chạy theo đồng hồ cũ; bắt đầu nạp tiền sẽ gia hạn thêm một lần duy nhất.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTopUp(true)}
                    className="label-eyebrow bg-burgundy px-4 py-2 text-white transition hover:brightness-110"
                  >
                    Nạp thêm vào ví
                  </button>
                </div>
              )}

              {showTopUp && limits && (
                <TopUpSheet
                  balance={balance ?? 0}
                  limits={limits}
                  reservationId={reservationId ?? undefined}
                  suggestedAmount={
                    shortfall ? Math.max(shortfall.shortfall, limits.min) : undefined
                  }
                  onCancel={() => setShowTopUp(false)}
                />
              )}

              <div className="flex items-start gap-2.5 text-meta leading-6 text-beige-kem/75">
                <input
                  id="agree-terms"
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-1 accent-burgundy"
                />
                <label htmlFor="agree-terms" className="cursor-pointer select-none">
                  Tôi đồng ý điều khoản bán vé và chính sách hoàn vé (hoàn tiền về ví, trước giờ
                  diễn 24 tiếng).
                </label>
              </div>

              {/*
                A submit button inside the form, for the keyboard and for a narrow screen where the
                summary has fallen below the fold. The summary's button drives this same form
                through `requestSubmit`, so there is one submit path, not two.
              */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full bg-burgundy px-6 py-3.5 font-display text-body font-black uppercase tracking-[0.05em] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-beige-kem/20 disabled:text-ink-soft lg:hidden"
              >
                {submitting ? "Đang thanh toán…" : "Trừ ví và xuất vé"}
              </button>
            </div>
          </BookingSection>
        </form>
      </BookingLayout>
    </div>
  );
}
