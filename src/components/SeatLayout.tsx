/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { MovieEvent, Seat } from "../types";

interface SeatLayoutProps {
  event: MovieEvent;
  selectedDate: string;
  selectedTime: string;
  onBack: () => void;
  onProceedToCheckout: (selectedSeats: Seat[], totalPrice: number) => void;
}

export default function SeatLayout({
  event,
  selectedDate,
  selectedTime,
  onBack,
  onProceedToCheckout,
}: SeatLayoutProps) {
  const HOLD_SECONDS = 5 * 60;
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [holdSeconds, setHoldSeconds] = useState(HOLD_SECONDS);

  // Initialize a mock seat layout for the cinema
  useEffect(() => {
    const rows = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const seatsPerRow = 12;
    const initialSeats: Seat[] = [];

    // Simple deterministic random generator for booked seats based on date/time
    const stringSeed = `${event.id}-${selectedDate}-${selectedTime}`;
    let seedCount = 0;
    const pseudoRandom = () => {
      let hash = 0;
      for (let i = 0; i < stringSeed.length; i++) {
        hash = stringSeed.charCodeAt(i) + ((hash << 5) - hash);
      }
      const x = Math.sin(hash + seedCount++) * 10000;
      return x - Math.floor(x);
    };

    rows.forEach((row) => {
      // G and H are sweetbox double seats! Others are standard single seats.
      const isDoubleRow = row === "G" || row === "H";
      
      for (let col = 1; col <= (isDoubleRow ? 6 : seatsPerRow); col++) {
        const id = `${row}${col}`;
        const isBooked = pseudoRandom() < 0.35; // ~35% seats are booked
        
        initialSeats.push({
          id,
          row,
          number: col,
          type: isDoubleRow ? "double" : "single",
          price: isDoubleRow ? event.doublePrice : event.price,
          isBooked,
        });
      }
    });

    setSeats(initialSeats);
    setSelectedSeatIds([]);
    setHoldSeconds(HOLD_SECONDS);
  }, [event, selectedDate, selectedTime]);

  useEffect(() => {
    if (selectedSeatIds.length === 0) {
      setHoldSeconds(HOLD_SECONDS);
      return;
    }

    if (holdSeconds <= 0) {
      setSelectedSeatIds([]);
      setHoldSeconds(HOLD_SECONDS);
      return;
    }

    const timer = window.setTimeout(() => {
      setHoldSeconds((current) => current - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [HOLD_SECONDS, holdSeconds, selectedSeatIds.length]);

  const toggleSeatSelection = (seatId: string) => {
    const seat = seats.find((s) => s.id === seatId);
    if (!seat || seat.isBooked) return;

    if (selectedSeatIds.includes(seatId)) {
      setSelectedSeatIds(selectedSeatIds.filter((id) => id !== seatId));
    } else {
      setSelectedSeatIds([...selectedSeatIds, seatId]);
    }
  };

  const getSelectedSeatsData = (): Seat[] => {
    return seats.filter((seat) => selectedSeatIds.includes(seat.id));
  };

  const getPriceSum = (): number => {
    return getSelectedSeatsData().reduce((sum, s) => sum + s.price, 0);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(price);
  };

  const selectedSeatsList = getSelectedSeatsData();
  const holdTimeLabel = `${String(Math.floor(holdSeconds / 60)).padStart(2, "0")}:${String(holdSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
      
      {/* Header and indicator step */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-beige-kem/10 pb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-la-co hover:text-beige-kem transition font-mono"
        >
          QUAY LẠI SUẤT CHIẾU
        </button>

        <div className="flex items-center gap-2 sm:gap-4 font-mono text-xs text-beige-kem/40">
          <span className="opacity-60">01. CHỌN SUẤT CHIẾU</span>
          <span className="h-[1px] w-6 bg-beige-kem/20" />
          <span className="text-burgundy font-semibold">02. CHỌN GHẾ</span>
          <span className="h-[1px] w-6 bg-beige-kem/20" />
          <span>03. THANH TOÁN VÀ NHẬN VÉ</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left column: Cinema auditorium seat selector (8 cols) */}
        <div className="lg:col-span-8 bg-xanh-pho/50 border border-beige-kem/10 rounded-2xl p-6 sm:p-10 flex flex-col items-center">
          
          {/* Cinema Screen simulation */}
          <div className="relative w-full max-w-lg mb-12 text-center">
            <h4 className="text-[10px] font-mono tracking-widest text-cam-dat uppercase mb-2">MÀN HÌNH CHÍNH</h4>
            
            {/* Curved cinema screen visual overlay */}
            <div className="relative h-4 bg-gradient-to-t from-beige-kem/40 to-transparent border-t-2 border-beige-kem/75 rounded-[100%] filter blur-[1px]" />
            <div className="absolute inset-x-0 -bottom-8 h-20 bg-gradient-to-b from-beige-kem/10 to-transparent pointer-events-none" />
          </div>

          {/* Interactive Seat Layout Grid */}
          <div className="w-full overflow-x-auto pb-4 no-scrollbar">
            <div className="min-w-[500px] flex flex-col gap-3 items-center">
              
              {seats.reduce((acc: any[], seat) => {
                const lastRow = acc[acc.length - 1];
                if (lastRow && lastRow[0].row === seat.row) {
                  lastRow.push(seat);
                } else {
                  acc.push([seat]);
                }
                return acc;
              }, []).map((rowSeats, rowIndex) => {
                const rowLabel = rowSeats[0].row;
                const isDoubleRow = rowLabel === "G" || rowLabel === "H";
                
                return (
                  <div key={rowLabel} className="flex items-center gap-4">
                    {/* Row Label (Left) */}
                    <span className="w-5 text-center font-mono font-bold text-xs text-cam-dat">
                      {rowLabel}
                    </span>

                    {/* Row Seats list */}
                    <div className="flex items-center gap-2">
                      {rowSeats.map((seat: Seat) => {
                        const isSelected = selectedSeatIds.includes(seat.id);
                        
                        // Seat type details
                        let buttonClasses = "font-mono text-[10px] font-bold transition-all relative flex items-center justify-center cursor-pointer select-none ";
                        
                        if (seat.type === "double") {
                          // Double seat styles
                          buttonClasses += "w-14 h-8 rounded-lg border-2 ";
                          if (seat.isBooked) {
                            buttonClasses += "bg-stone-800 border-stone-800 text-stone-600 cursor-not-allowed";
                          } else if (isSelected) {
                            buttonClasses += "bg-burgundy border-burgundy text-beige-kem ring-2 ring-burgundy/40 shadow-inner";
                          } else {
                            // Empty double seat status color uses Xanh Lá Cọ Nhật (#A6A15E) as requested
                            buttonClasses += "bg-transparent border-[#A6A15E] text-la-co hover:bg-la-co/10";
                          }
                        } else {
                          // Standard single seat styles
                          buttonClasses += "w-8 h-8 rounded-md border ";
                          if (seat.isBooked) {
                            buttonClasses += "bg-stone-800 border-stone-800 text-stone-600 cursor-not-allowed";
                          } else if (isSelected) {
                            buttonClasses += "bg-burgundy border-burgundy text-beige-kem shadow-inner";
                          } else {
                            buttonClasses += "bg-transparent border-beige-kem/25 text-beige-kem/80 hover:border-cam-dat hover:text-white";
                          }
                        }

                        return (
                          <button
                            key={seat.id}
                            id={`seat-${seat.id}`}
                            disabled={seat.isBooked}
                            onClick={() => toggleSeatSelection(seat.id)}
                            className={buttonClasses}
                            title={`${seat.type === "double" ? "Ghế đôi" : "Ghế đơn"} ${seat.id} (${formatPrice(seat.price)})`}
                          >
                            <span className="z-10">{seat.id}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Row Label (Right) */}
                    <span className="w-5 text-center font-mono font-bold text-xs text-cam-dat">
                      {rowLabel}
                    </span>
                  </div>
                );
              })}

            </div>
          </div>

          {/* Seat Layout Legend Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-beige-kem/10 w-full max-w-lg font-mono text-xs text-beige-kem/70">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-transparent border border-beige-kem/25 rounded" />
              <span>Ghế Đơn ({formatPrice(event.price)})</span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Double seat status empty color must be Xanh Lá Cọ Nhật (#A6A15E) */}
              <span className="w-10 h-5 bg-transparent border-2 border-[#A6A15E] rounded" />
              <span>Ghế Đôi ({formatPrice(event.doublePrice)})</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-burgundy rounded" />
              <span>Đóng Burgundy (Đang Chọn)</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-stone-800 border border-stone-800 rounded" />
              <span>Đã Bán / Hết Vé</span>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] font-mono text-la-co bg-la-co/5 px-4 py-2 border border-la-co/20 rounded-lg max-w-lg">
            Khuyên dùng: Ghế đôi có khung viền <span className="underline font-semibold text-[#A6A15E]">Xanh Lá Cọ Nhật (#A6A15E)</span> thích hợp cho các cặp đôi rạp phim văn hóa!
          </div>

        </div>

        {/* Right column: Dynamic Sidebar calculations (4 cols) */}
        <div className="lg:col-span-4 bg-xanh-pho/30 border border-beige-kem/10 rounded-2xl p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="font-display font-bold text-lg text-beige-kem">Thông Tin Suất Chiếu</h3>
            <p className="text-xs text-la-co font-mono uppercase tracking-wider">{event.genre.join(" | ")}</p>
          </div>

          <div className="rounded-xl border border-cam-dat/25 bg-cam-dat/5 p-4 font-mono text-xs text-beige-kem/75">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center font-bold text-cam-dat">
                Giữ ghế tạm thời
              </span>
              <span className="text-base font-black text-beige-kem">
                {selectedSeatsList.length ? holdTimeLabel : "--:--"}
              </span>
            </div>
            <p className="mt-2 leading-5">
              Frontend đang mô phỏng khóa ghế trong vài phút. Backend sau này cần tạo reservation thật để chống đặt trùng khi nhiều người cùng mua.
            </p>
          </div>

          <div className="space-y-3 pt-4 border-t border-beige-kem/10 text-sm">
            <div className="flex justify-between font-mono">
              <span className="text-beige-kem/60">Tên tác phẩm:</span>
              <span className="font-bold text-beige-kem shrink-0 max-w-[180px] text-right truncate">{event.title}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-beige-kem/60">Suất chiếu:</span>
              <span className="font-bold text-beige-kem text-right">{selectedTime} • {selectedDate}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-beige-kem/60">Rạp chiếu:</span>
              <span className="font-bold text-beige-kem text-right max-w-[200px] truncate" title={event.location}>
                {event.location.split("-")[1] || "Sảnh Pasteur"}
              </span>
            </div>
          </div>

          {/* Selected Seat list details */}
          <div className="space-y-3 pt-4 border-t border-beige-kem/10">
            <h4 className="font-display text-sm font-semibold text-beige-kem">Ghế ngồi đã chọn:</h4>
            
            {selectedSeatsList.length === 0 ? (
              <div className="py-6 text-center text-xs text-beige-kem/40 border border-dashed border-beige-kem/15 rounded-lg">
                Vui lòng chọn ghế trên sơ đồ rạp
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {selectedSeatsList.map((seat) => (
                  <div key={seat.id} className="flex justify-between items-center bg-xanh-pho/60 px-3 py-2 border border-beige-kem/5 rounded-lg text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${seat.type === "double" ? "bg-la-co" : "bg-beige-kem/50"}`} />
                      <span className="font-bold text-beige-kem">GHẾ {seat.id}</span>
                      <span className="text-[10px] text-cam-dat uppercase font-light">({seat.type === "double" ? "Đôi Sweet" : "Đơn Standard"})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-bold text-beige-kem">{formatPrice(seat.price)}</span>
                      <button
                        onClick={() => toggleSeatSelection(seat.id)}
                        className="font-mono text-[10px] uppercase text-stone-500 transition hover:text-burgundy cursor-pointer"
                        title="Xóa ghế này"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Real-time total pricing block */}
          <div className="pt-4 border-t border-beige-kem/10 flex flex-col gap-1.5">
            <div className="flex justify-between items-baseline font-mono">
              <span className="text-xs text-beige-kem/60 uppercase">Tổng tiền phải trả:</span>
              <span className="text-2xl font-black text-burgundy font-display">
                {formatPrice(getPriceSum())}
              </span>
            </div>
            <p className="text-[10px] text-right font-mono text-cam-dat tracking-wide">
              Đã bao gồm thuế giá trị gia tăng & phụ thu cinema
            </p>
          </div>

          <button
            onClick={() => onProceedToCheckout(selectedSeatsList, getPriceSum())}
            disabled={selectedSeatsList.length === 0 || holdSeconds <= 0}
            className="w-full py-3.5 bg-burgundy hover:bg-burgundy/90 disabled:bg-beige-kem/10 disabled:text-beige-kem/35 text-beige-kem hover:text-white font-bold rounded-xl transition shadow-lg hover:shadow-burgundy/30 cursor-pointer text-center text-sm"
          >
            TIẾP TỤC: ĐIỀN THÔNG TIN THÀNH VIÊN
          </button>
        </div>

      </div>
    </div>
  );
}
