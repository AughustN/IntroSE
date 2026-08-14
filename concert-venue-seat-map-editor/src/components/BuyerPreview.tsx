import React, { useState, useEffect } from 'react';
import { VenueMap, CartItem, CategoryTier, Seat } from '../types/seatmap';
import { 
  ShoppingCart, 
  Trash2, 
  Check, 
  Clock, 
  Tv, 
  Sparkles, 
  Filter, 
  Info, 
  X,
  CreditCard,
  Ticket
} from 'lucide-react';

interface BuyerPreviewProps {
  venue: VenueMap;
}

export const BuyerPreview: React.FC<BuyerPreviewProps> = ({ venue }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCatFilter, setSelectedCatFilter] = useState<string | null>(null);
  const [holdTimerSeconds, setHoldTimerSeconds] = useState<number>(600); // 10 minutes timer
  const [isCheckoutSuccess, setIsCheckoutSuccess] = useState(false);

  const categoryMap = new Map<string, CategoryTier>(
    venue.categories.map((c) => [c.id, c])
  );

  // Countdown timer effect
  useEffect(() => {
    if (cart.length === 0) {
      setHoldTimerSeconds(600);
      return;
    }
    const interval = setInterval(() => {
      setHoldTimerSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cart]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  // Toggle seat in cart
  const handleSeatClick = (elementId: string, seat: Seat, sectionName: string, category: CategoryTier) => {
    if (seat.status === 'blocked' || seat.status === 'reserved' || seat.status === 'sold') return;

    const cartKey = `${elementId}-${seat.id}`;
    const existsIndex = cart.findIndex((item) => `${item.elementId}-${item.seatId}` === cartKey);

    if (existsIndex >= 0) {
      // Remove from cart
      setCart(cart.filter((_, idx) => idx !== existsIndex));
    } else {
      // Max 6 tickets limit
      if (cart.length >= 6) {
        alert('Maximum 6 tickets allowed per order.');
        return;
      }
      setCart([
        ...cart,
        {
          elementId,
          seatId: seat.id,
          seatLabel: seat.label,
          rowLabel: seat.rowLabel,
          sectionName,
          category,
          price: category.price
        }
      ]);
    }
  };

  // Calculate order subtotal and fees
  const subtotal = cart.reduce((acc, item) => acc + item.price, 0);
  const serviceFee = cart.length * 8.5; // $8.50 service fee per ticket
  const totalPrice = subtotal + serviceFee;

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-[#0A0A0A] text-[#E0E0E0] select-none overflow-hidden font-sans">
      
      {/* Left Main Interactive Canvas Seat Selection View */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* Top Concert Header Banner */}
        <div className="bg-[#121212] border-b border-white/10 p-3 px-6 flex flex-wrap items-center justify-between gap-3 z-10 shadow-lg">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-orange-500 text-black font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                Live Interactive Seating
              </span>
              <h2 className="text-sm font-extrabold text-white">{venue.name}</h2>
            </div>
            <p className="text-xs text-white/50 mt-0.5">Click any available seat on the map below to choose your ticket position.</p>
          </div>

          {/* Category Tier Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <button
              onClick={() => setSelectedCatFilter(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                selectedCatFilter === null
                  ? 'bg-white/20 text-white shadow'
                  : 'bg-white/5 text-white/50 hover:text-white/80'
              }`}
            >
              All Tiers
            </button>
            {venue.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCatFilter(selectedCatFilter === c.id ? null : c.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all border ${
                  selectedCatFilter === c.id
                    ? 'ring-2 ring-white text-white font-bold'
                    : 'bg-white/5 border-white/10 text-white/70 hover:border-white/20'
                }`}
                style={{
                  borderColor: selectedCatFilter === c.id ? c.color : undefined,
                  backgroundColor: selectedCatFilter === c.id ? `${c.color}22` : undefined
                }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                <span>{c.name}</span>
                <span className="text-[11px] font-mono text-orange-400">${c.price}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Interactive SVG Seat Canvas Container */}
        <div className="flex-1 overflow-auto bg-[#080808] p-6 flex items-center justify-center relative">
          
          <div className="relative bg-[#121212]/80 p-8 rounded-3xl border border-white/10 shadow-2xl">
            {/* Stage Direction Banner */}
            <div className="w-full bg-gradient-to-r from-orange-950/40 via-amber-900/60 to-orange-950/40 border border-orange-500/30 rounded-xl py-2 mb-8 text-center shadow-lg">
              <div className="text-xs font-black tracking-widest text-orange-300 uppercase flex items-center justify-center gap-2">
                <Tv className="w-4 h-4 text-orange-400" />
                <span>STAGE / PERFORMANCE AREA</span>
              </div>
            </div>

            {/* Render Venue Layout Elements */}
            <svg
              width={venue.canvasWidth * 0.85}
              height={venue.canvasHeight * 0.85}
              viewBox={`0 0 ${venue.canvasWidth} ${venue.canvasHeight}`}
              className="block"
            >
              {venue.elements.map((el) => {
                const defaultCat = categoryMap.get(el.categoryId || '') || venue.categories[0];

                // Filter opacity effect
                const isDimmedByFilter = selectedCatFilter && el.categoryId !== selectedCatFilter;

                return (
                  <g
                    key={el.id}
                    transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation || 0}, ${el.width / 2}, ${el.height / 2})`}
                    opacity={isDimmedByFilter ? 0.25 : 1}
                    className="transition-opacity duration-300"
                  >
                    {/* Stage */}
                    {el.type === 'stage' && (
                      <rect
                        width={el.width}
                        height={el.height}
                        rx={8}
                        fill="#1a1a1a"
                        stroke="#f97316"
                        strokeWidth={2}
                      />
                    )}

                    {/* GA Pit Zone */}
                    {el.type === 'ga-zone' && (
                      <rect
                        width={el.width}
                        height={el.height}
                        rx={12}
                        fill={el.fillColor || 'rgba(249, 115, 22, 0.15)'}
                        stroke="#f97316"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                      />
                    )}

                    {/* Seating Block Seats */}
                    {(el.type === 'seating-block' || el.type === 'curved-row' || el.type === 'single-row') && (
                      <g>
                        <text
                          x={el.width / 2}
                          y={-8}
                          textAnchor="middle"
                          fill="#888888"
                          fontSize={11}
                          fontWeight="bold"
                        >
                          {el.title}
                        </text>

                        {(el.seats || []).map((seat) => {
                          const cat = categoryMap.get(seat.categoryId) || defaultCat;
                          const isSelectedInCart = cart.some(
                            (item) => item.elementId === el.id && item.seatId === seat.id
                          );

                          return (
                            <g
                              key={seat.id}
                              transform={`translate(${seat.x + 10}, ${seat.y + 10})`}
                              onClick={() => handleSeatClick(el.id, seat, el.title, cat)}
                              className="cursor-pointer group"
                            >
                              <circle
                                r={isSelectedInCart ? 10 : 8}
                                fill={isSelectedInCart ? '#f97316' : cat.color}
                                stroke={isSelectedInCart ? '#ffffff' : '#0a0a0a'}
                                strokeWidth={isSelectedInCart ? 2.5 : 1}
                                className="transition-all hover:scale-125 origin-center"
                              />
                              {isSelectedInCart ? (
                                <path
                                  d="M-3 0 L-1 2 L3 -2"
                                  fill="none"
                                  stroke="#ffffff"
                                  strokeWidth={2}
                                />
                              ) : (
                                <text
                                  y={3}
                                  textAnchor="middle"
                                  fill="#ffffff"
                                  fontSize={7}
                                  fontWeight="bold"
                                  className="pointer-events-none select-none font-mono"
                                >
                                  {seat.label}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </g>
                    )}

                    {/* VIP Table */}
                    {el.type === 'vip-table' && (
                      <g>
                        <circle
                          cx={el.width / 2}
                          cy={el.height / 2}
                          r={22}
                          fill="#1c1c1c"
                          stroke={defaultCat.color}
                          strokeWidth={2}
                        />
                        <text
                          x={el.width / 2}
                          y={el.height / 2 + 4}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={10}
                          fontWeight="bold"
                        >
                          {el.label}
                        </text>
                        {(el.seats || []).map((seat) => {
                          const cat = categoryMap.get(seat.categoryId) || defaultCat;
                          const isSelectedInCart = cart.some(
                            (item) => item.elementId === el.id && item.seatId === seat.id
                          );

                          return (
                            <circle
                              key={seat.id}
                              cx={seat.x}
                              cy={seat.y}
                              r={isSelectedInCart ? 9 : 7}
                              fill={isSelectedInCart ? '#f97316' : cat.color}
                              stroke="#0a0a0a"
                              strokeWidth={1}
                              onClick={() => handleSeatClick(el.id, seat, el.title, cat)}
                              className="cursor-pointer hover:scale-125 transition-transform"
                            />
                          );
                        })}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* Right Cart & Order Summary Sidebar */}
      <div className="w-full lg:w-96 bg-[#121212] border-t lg:border-t-0 lg:border-l border-white/10 p-5 flex flex-col justify-between shadow-2xl z-20">
        <div>
          {/* Cart Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-orange-400" />
              <h3 className="font-bold text-base text-white">Your Ticket Cart</h3>
            </div>
            <span className="bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold">
              {cart.length} / 6
            </span>
          </div>

          {/* Seat Hold Reservation Timer Banner */}
          {cart.length > 0 && (
            <div className="bg-amber-950/40 border border-amber-500/30 text-amber-200 px-3 py-2 rounded-xl text-xs flex items-center justify-between mb-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Seats Held For You</span>
              </div>
              <span className="font-mono font-bold text-sm text-amber-400">
                {formatTimer(holdTimerSeconds)}
              </span>
            </div>
          )}

          {/* Cart Items List */}
          {cart.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <Ticket className="w-12 h-12 text-white/20 mx-auto" />
              <p className="text-xs text-white/40">No seats selected yet. Click on any seat in the venue layout to add to your order.</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[45vh] overflow-y-auto pr-1">
              {cart.map((item, idx) => (
                <div
                  key={`${item.elementId}-${item.seatId}`}
                  className="bg-black/40 border border-white/10 rounded-xl p-3 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-bold text-white flex items-center gap-2">
                      <span>{item.sectionName}</span>
                      <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/70 font-mono">
                        Row {item.rowLabel} • Seat {item.seatLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-white/50">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.category.color }} />
                      <span>{item.category.name}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-orange-400 text-sm">
                      ${item.price}
                    </span>
                    <button
                      onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                      className="p-1 text-white/40 hover:text-rose-400 rounded transition-colors"
                      title="Remove Seat"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Price Breakdown & Checkout */}
        {cart.length > 0 && (
          <div className="pt-4 border-t border-white/10 space-y-3">
            <div className="space-y-1.5 text-xs text-white/50">
              <div className="flex justify-between">
                <span>Subtotal ({cart.length} tickets)</span>
                <span className="font-mono font-medium text-white/80">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Facility & Processing Fees</span>
                <span className="font-mono font-medium text-white/80">${serviceFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-white/10">
                <span>Total Due</span>
                <span className="font-mono text-orange-400 text-base">${totalPrice.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={() => setIsCheckoutSuccess(true)}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>Proceed to Checkout</span>
            </button>
          </div>
        )}
      </div>

      {/* Checkout Success Modal */}
      {isCheckoutSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-[#121212] border border-white/10 text-center p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl">
            <div className="w-12 h-12 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Tickets Reserved!</h3>
            <p className="text-xs text-white/60">
              Your {cart.length} concert tickets for {venue.name} have been locked and confirmed.
            </p>
            <button
              onClick={() => {
                setIsCheckoutSuccess(false);
                setCart([]);
              }}
              className="w-full py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Done & Return
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
