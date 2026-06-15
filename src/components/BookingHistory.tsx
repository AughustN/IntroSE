/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Booking } from "../types";

interface BookingHistoryProps {
  bookings: Booking[];
  onBack: () => void;
  onSelectBooking: (booking: Booking) => void;
  onClearHistory: () => void;
}

export default function BookingHistory({
  bookings,
  onBack,
  onSelectBooking,
  onClearHistory,
}: BookingHistoryProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(price);
  };

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
      
      {/* Header heading */}
      <div className="flex items-center justify-between border-b border-beige-kem/10 pb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-la-co hover:text-beige-kem transition font-mono"
        >
          QUAY LẠI CỬA SỔ CHỦ
        </button>

        <h2 className="font-display text-2xl font-bold text-beige-kem">Vé Của Tôi</h2>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-20 px-4 bg-xanh-pho/50 border border-beige-kem/10 rounded-2xl max-w-md mx-auto">
          <h3 className="font-display text-lg text-beige-kem font-semibold">Hiện chưa có vé nào</h3>
          <p className="text-sm text-beige-kem/60 mt-2 font-mono">
            Bạn chưa thực hiện giao dịch mua vé nào bằng tài khoản này. Các vé đã mua sẽ được hệ thống lưu trong ổ cứng thiết bị.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex justify-between items-baseline font-mono text-xs text-beige-kem/65 px-2">
            <span>Danh sách vé đã đặt ({bookings.length} giao dịch)</span>
            <button
              onClick={onClearHistory}
              className="text-stone-400 hover:text-burgundy flex items-center transition cursor-pointer"
            >
              XÓA LỊCH SỬ ĐẶT VÉ
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {bookings.map((b) => (
              <div
                key={b.id}
                onClick={() => onSelectBooking(b)}
                className="bg-xanh-pho/50 border border-beige-kem/10 hover:border-cam-dat/65 p-5 rounded-xl cursor-pointer transition duration-200 hover:scale-[1.01] shadow-lg flex flex-col md:flex-row md:items-center md:justify-between gap-4"
              >
                <div className="flex items-start gap-4">
                  <img
                    src={b.movie.imageUrl}
                    alt={b.movie.title}
                    referrerPolicy="no-referrer"
                    className="w-14 h-16 object-cover rounded shadow border border-beige-kem/5"
                  />
                  <div className="space-y-1">
                    <h4 className="font-display font-bold text-lg text-beige-kem leading-tight">
                      {b.movie.title}
                    </h4>
                    <p className="text-xs text-cam-dat font-mono">
                      Mã giao dịch: <span className="font-bold">{b.id}</span> / {b.paymentMethod}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs text-beige-kem/60">
                      <span className="flex items-center gap-1 bg-beige-kem/5 border border-beige-kem/10 px-2 py-0.5 rounded">
                        {b.selectedDate} • {b.selectedTime}
                      </span>
                      <span className="bg-burgundy/15 text-burgundy border border-burgundy/30 px-2 py-0.5 rounded font-bold">
                        {b.selectedSeats.map(s => s.id).join(", ")}
                      </span>
                      <span className="bg-la-co/10 text-la-co border border-la-co/25 px-2 py-0.5 rounded font-bold">
                        {b.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-baseline md:flex-col md:items-end justify-between border-t md:border-t-0 border-beige-kem/5 pt-3 md:pt-0">
                  <span className="text-[10px] font-mono text-la-co uppercase tracking-wider block">Tổng tiền</span>
                  <span className="font-display text-base font-bold text-beige-kem font-mono mt-0.5">
                    {formatPrice(b.finalPrice || b.totalPrice)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
    </div>
  );
}
