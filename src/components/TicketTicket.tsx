import { useState } from "react";
import { Booking } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";

interface TicketTicketProps {
  booking: Booking;
  onHomeClick: () => void;
}

export default function TicketTicket({ booking, onHomeClick }: TicketTicketProps) {
  const [copied, setCopied] = useState(false);
  const [resent, setResent] = useState(false);


  const handleCopyCode = () => {
    navigator.clipboard.writeText(booking.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleResend = () => {
    setResent(true);
    setTimeout(() => setResent(false), 2500);
  };

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
      
      {/* Success Banner */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center rounded-full border-2 border-beige-kem bg-la-co px-4 py-2 font-mono text-xs font-bold uppercase text-on-tint">
          Đã thanh toán
        </div>
        <h2 className="font-display text-4xl font-black text-beige-kem">Đặt vé thành công</h2>
        <p className="text-sm text-beige-kem/80 max-w-lg mx-auto leading-relaxed">
          Giao dịch mã số <span className="font-mono text-ink-soft font-bold">{booking.id}</span> đã được hạch toán qua {booking.paymentMethod}. Vé QR đã được gửi mock về <span className="text-ink-soft font-semibold">{booking.customerEmail}</span> và SMS {booking.customerPhone}.
        </p>
      </div>

      {/* Retro Perforated Ticket Coupon */}
      <div className="bg-beige-kem border-4 border-xanh-pho rounded-2xl relative overflow-hidden text-xanh-pho max-w-2xl mx-auto">
        
        {/* Decorative Ticket Side Notch Circles */}
        <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-xanh-pho rounded-full z-10 border-r-4 border-xanh-pho" />
        <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-xanh-pho rounded-full z-10 border-l-4 border-xanh-pho" />

        {/* Part A: Ticket Header */}
        <div className="bg-burgundy text-white p-6 flex justify-between items-center border-b-4 border-dashed border-xanh-pho">
          <div className="space-y-1">
            <span className="text-[13px] font-mono tracking-widest text-ink-soft uppercase font-bold">CINEMA VINTAGE STUB</span>
            <div className="flex items-baseline gap-1.5">
              <h3 className="font-display font-black text-2xl">TIXHUB</h3>
              <span className="text-[13px] font-mono bg-[#E0E2CA] text-burgundy-ink px-1 py-0.2 rounded font-black">STUB</span>
            </div>
          </div>

          <div className="text-right font-mono text-xs">
            <p className="opacity-75">Mã Vé</p>
            <p className="font-bold text-ink-soft text-sm">{booking.id}</p>
          </div>
        </div>

        {/* Part B: Ticket Content Body */}
        <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          
          {/* Main info columns (8 cols) */}
          <div className="md:col-span-8 space-y-5">
            <div className="space-y-1">
              <span className="text-[12px] font-mono font-semibold bg-bubblegum text-on-tint border-2 border-beige-kem px-2 py-0.5 rounded">
                Rated: {booking.movie.ageRating}
              </span>
              <h4 className="font-display font-black text-3xl text-burgundy-ink leading-tight pt-1">
                {booking.movie.title}
              </h4>
              {booking.movie.originalTitle && (
                <p className="text-xs font-mono text-burgundy-ink/75">{booking.movie.originalTitle}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 font-mono text-xs">
              <div className="space-y-1">
                <span className="text-gray-500">
                  Ngày chiếu
                </span>
                <span className="font-bold text-xanh-pho">{formatEventDate(booking.selectedDate, true)}</span>
              </div>
              <div className="space-y-1">
                <span className="text-gray-500">
                  Giờ chiếu
                </span>
                <span className="font-bold text-xanh-pho">{booking.selectedTime}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 font-mono text-xs pt-1">
              <div className="space-y-1">
                <span className="text-gray-500">
                  Khán giả
                </span>
                <span className="font-bold text-xanh-pho truncate block max-w-[170px]" title={booking.customerName}>
                  {booking.customerName}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-gray-500">
                  Số Ghế Đã Đặt
                </span>
                <span className="font-bold text-burgundy-ink text-sm">
                  {booking.selectedSeats.map((s) => s.id).join(", ")}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-2.5 border-t border-gray-300 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Tạm tính:</span>
                <span className="font-bold text-xanh-pho">{formatVnd(booking.totalPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Phí dịch vụ:</span>
                <span className="font-bold text-xanh-pho">{formatVnd(booking.serviceFee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Giảm giá:</span>
                <span className="font-bold text-ink-soft">-{formatVnd(booking.discount)}</span>
              </div>
              <div className="flex justify-between items-baseline border-t border-gray-300 pt-2">
                <span className="text-gray-500">Tổng thanh toán:</span>
                <span className="font-black text-burgundy-ink text-lg">{formatVnd(booking.finalPrice)}</span>
              </div>
            </div>
          </div>

          {/* QR Scan Column (4 cols) */}
          <div className="md:col-span-4 flex flex-col items-center justify-center p-4 bg-xanh-pho border border-xanh-pho/15 rounded-xl space-y-3">
            
            {/* Elegant SVG custom QR code code */}
            <div className="w-28 h-28 bg-xanh-pho p-2 rounded-lg shadow-inner flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-full h-full text-beige-kem" fill="currentColor">
                {/* Simulated vintage QR Code pixels grid */}
                <rect x="5" y="5" width="20" height="20" />
                <rect x="10" y="10" width="10" height="10" fill="#E0E2CA" />
                <rect x="75" y="5" width="20" height="20" />
                <rect x="80" y="10" width="10" height="10" fill="#E0E2CA" />
                <rect x="5" y="75" width="20" height="20" />
                <rect x="10" y="80" width="10" height="10" fill="#E0E2CA" />
                {/* Noise blocks */}
                <rect x="35" y="15" width="10" height="5" />
                <rect x="40" y="30" width="20" height="10" />
                <rect x="15" y="45" width="5" height="15" />
                <rect x="30" y="55" width="15" height="15" />
                <rect x="65" y="45" width="10" height="25" />
                <rect x="55" y="75" width="15" height="5" />
                <rect x="75" y="80" width="15" height="15" />
                <rect x="35" y="85" width="10" height="10" />
              </svg>
            </div>

            <div className="text-center font-mono">
              <p className="text-[13px] font-bold text-burgundy-ink uppercase tracking-widest">VÉ VÀO CỬA QR</p>
              <p className="text-[12px] text-gray-500 mt-0.5">QR một lần / {booking.qrStatus === "unused" ? "Chưa check-in" : "Đã check-in"}</p>
            </div>
          </div>

        </div>

        {/* Part C: Stylized printable barcode footer */}
        <div className="bg-beige-kem border-t-2 border-dashed border-xanh-pho/35 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col items-start gap-1 font-mono text-[12px] text-gray-500 leading-none">
            <span>RẠP: {booking.movie.location}</span>
            <span>THỜI GIAN ĐẶT: {booking.bookingTime}</span>
            <span>TRẠNG THÁI: {booking.status.toUpperCase()} / {booking.deliveryChannel.toUpperCase()}</span>
          </div>

          {/* Barcode representation lines */}
          <div className="h-8 flex gap-[1.5px] items-center overflow-hidden">
            {[2,1,4,1,2,3,1,2,4,1,3,1,2,1,4,1,2,2,3,1,4,1,2,3,1,2,4,1].map((w, idx) => (
              <span
                key={idx}
                className="bg-xanh-pho h-full"
                style={{ width: `${w}px` }}
              />
            ))}
          </div>
        </div>

      </div>

      {/* Action list */}
      <div className="flex flex-wrap justify-center items-center gap-4 py-4 font-mono text-sm">
        <button
          onClick={onHomeClick}
          className="flex items-center px-5 py-2.5 bg-xanh-pho border-2 border-beige-kem hover:border-beige-kem/60 text-beige-kem rounded-lg transition"
        >
          VỀ TRANG CHỦ
        </button>

        <button
          onClick={handleCopyCode}
          className="flex items-center px-5 py-2.5 bg-xanh-pho border-2 border-beige-kem hover:border-beige-kem/60 text-beige-kem rounded-lg transition"
        >
          {copied ? "ĐÃ SAO CHÉP" : "SAO CHÉP MÃ VÉ"}
        </button>

        <button
          onClick={handlePrint}
          className="flex items-center px-6 py-2.5 bg-burgundy text-white rounded-lg hover:brightness-95 transition"
        >
          IN VÉ NÀY
        </button>

        <button
          onClick={handlePrint}
          className="flex items-center px-5 py-2.5 bg-xanh-pho border-2 border-beige-kem hover:border-beige-kem/60 text-beige-kem rounded-lg transition"
        >
          TẢI VÉ
        </button>

        <button
          onClick={handleResend}
          className="flex items-center px-5 py-2.5 bg-xanh-pho border border-la-co/25 hover:border-burgundy text-ink-soft rounded-lg transition"
        >
          {resent ? "ĐÃ GỬI LẠI" : "GỬI LẠI EMAIL/SMS"}
        </button>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border-2 border-beige-kem bg-la-co p-4 text-xs leading-6 text-on-tint">
        Đây là vé frontend mock. Backend sau này cần khóa QR theo trạng thái một lần, ghi log check-in và cho phép gửi lại email/SMS từ lịch sử đơn hàng.
      </div>

    </div>
  );
}
