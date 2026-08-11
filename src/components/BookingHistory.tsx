/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import { QrCode, Ticket } from "lucide-react";
import { Booking } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";

interface BookingHistoryProps {
  bookings: Booking[];
  onBack: () => void;
  onSelectBooking: (booking: Booking) => void;
}

/**
 * Which pile a ticket falls in.
 *
 * There is no "đang xử lý" tab. Checkout debits the wallet, writes the order and issues the QR in
 * one transaction — a ticket that exists is a ticket that is paid for, so a pending pile would be a
 * tab that is empty on every account forever. `pending` and `failed` are folded into the cancelled
 * pile: from the holder's side, a ticket they cannot use is one thing, not three.
 */
type Pile = "upcoming" | "past" | "void";

const PILE_LABEL: Record<Pile, string> = {
  upcoming: "Sắp diễn",
  past: "Đã diễn",
  void: "Đã hủy",
};

/** ISO day comparison, no `Date` — `new Date("2026-08-11")` is UTC midnight and drifts by timezone. */
const todayISO = (): string => {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
};

function pileOf(booking: Booking, today: string): Pile {
  if (booking.status !== "paid") return "void";
  if (booking.qrStatus === "checked_in") return "past";
  return booking.selectedDate >= today ? "upcoming" : "past";
}

/**
 * What the stub says about itself, bottom right.
 *
 * Only bad news is coloured. A row of coloured "valid" badges on a page where every ticket is valid
 * tells the holder nothing they did not already know by the ticket existing.
 */
function statusOf(booking: Booking, today: string): { label: string; className: string } {
  const bad = "text-burgundy-ink";
  const quiet = "text-ink-soft";
  if (booking.status === "cancelled") return { label: "Đã hủy", className: bad };
  if (booking.status !== "paid") return { label: "Không hợp lệ", className: bad };
  if (booking.qrStatus === "checked_in") return { label: "Đã soát vé", className: quiet };
  if (booking.selectedDate < today) return { label: "Đã qua", className: quiet };
  return { label: "Còn hiệu lực", className: quiet };
}

export default function BookingHistory({ bookings, onBack, onSelectBooking }: BookingHistoryProps) {
  const today = todayISO();
  const [pile, setPile] = useState<Pile | "all">("all");

  const counts = useMemo(() => {
    const base: Record<Pile, number> = { upcoming: 0, past: 0, void: 0 };
    for (const booking of bookings) base[pileOf(booking, today)] += 1;
    return base;
  }, [bookings, today]);

  /*
   * Soonest first inside the upcoming pile, most recent first everywhere else.
   *
   * A holder looking at "sắp diễn" is asking "what is next"; one looking at "đã diễn" is asking
   * "what did I just go to". Same list, opposite ends.
   */
  const visible = useMemo(() => {
    const rows = bookings.filter((b) => pile === "all" || pileOf(b, today) === pile);
    return [...rows].sort((a, b) => {
      const aUpcoming = pileOf(a, today) === "upcoming";
      const bUpcoming = pileOf(b, today) === "upcoming";
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      const key = (x: Booking) => `${x.selectedDate}T${x.selectedTime}`;
      return aUpcoming ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a));
    });
  }, [bookings, pile, today]);

  const tabs: { id: Pile | "all"; label: string; count: number }[] = [
    { id: "all", label: "Tất cả", count: bookings.length },
    { id: "upcoming", label: PILE_LABEL.upcoming, count: counts.upcoming },
    { id: "past", label: PILE_LABEL.past, count: counts.past },
    { id: "void", label: PILE_LABEL.void, count: counts.void },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <button
          onClick={onBack}
          className="font-meta text-meta text-ink-soft transition hover:text-beige-kem"
        >
          ← Quay lại trang chủ
        </button>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-beige-kem/30 pb-5">
          <h1 className="font-display text-title-l font-black uppercase leading-none tracking-[0.02em] text-beige-kem">
            Vé của tôi
          </h1>
          <span className="font-meta text-meta text-ink-soft">{bookings.length} vé</span>
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="hud-dashed mx-auto max-w-lg px-6 py-20 text-center">
          <Ticket aria-hidden="true" className="mx-auto h-8 w-8 text-ink-soft" />
          <h2 className="mt-4 font-display text-title-s font-black uppercase tracking-[0.03em] text-beige-kem">
            Chưa có vé nào
          </h2>
          <p className="mt-3 text-body leading-6 text-beige-kem/70">
            Vé bạn mua sẽ xuất hiện ở đây, kèm mã QR để soát vé tại cửa.
          </p>
        </div>
      ) : (
        <>
          {/*
            Piles, not a filter bar. Four short words on one rule, the current one underlined — the
            shape a "my tickets" page uses everywhere, and the reason it works is that a holder
            arrives with one of exactly these questions in mind.
          */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-beige-kem/25">
            {tabs.map((tab) => {
              const active = pile === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPile(tab.id)}
                  aria-current={active ? "true" : undefined}
                  className={`-mb-px border-b-2 pb-3 font-display text-body font-bold uppercase tracking-[0.06em] transition ${
                    active
                      ? "border-burgundy text-beige-kem"
                      : "border-transparent text-ink-soft hover:text-beige-kem"
                  }`}
                >
                  {tab.label}
                  <span className="ml-2 font-meta text-meta font-normal text-ink-soft">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <p className="py-16 text-center font-meta text-body text-ink-soft">
              Không có vé nào trong mục này.
            </p>
          ) : (
            <ul className="space-y-5">
              {visible.map((booking) => {
                const status = statusOf(booking, today);
                const spent = booking.finalPrice || booking.totalPrice;

                return (
                  <li key={booking.id}>
                    {/*
                      A stub, not a row.

                      `ticket-corners` punches the four quarter-circle bites this codebase already
                      draws on the nav's ticket, and `menu-perf` is the dashed tear that runs
                      between a counterfoil and its body. Both existed and neither had ever been
                      used on an actual ticket. The poster runs the full height of the counterfoil
                      under a dark wash, so a page of these reads as a stack of cinema stubs rather
                      than as a table of transactions — which is what the holder came to look at.
                    */}
                    <button
                      type="button"
                      onClick={() => onSelectBooking(booking)}
                      className="menu-ticket-group ticket-corners group w-full bg-surface-2 text-left transition hover:brightness-[0.98]"
                    >
                      <div className="relative w-28 shrink-0 self-stretch overflow-hidden bg-black sm:w-40">
                        <img
                          src={booking.movie.imageUrl}
                          alt=""
                          aria-hidden="true"
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 h-full w-full object-cover opacity-75 transition duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/40" />
                        <QrCode
                          aria-hidden="true"
                          className="absolute bottom-3 left-3 h-5 w-5 text-white/80"
                        />
                      </div>

                      <div className="menu-perf" />

                      <div className="min-w-0 flex-1 p-5 sm:p-6">
                        <h3 className="line-clamp-2 font-display text-lede font-black uppercase leading-[1.15] tracking-[0.03em] text-beige-kem">
                          {booking.movie.title}
                        </h3>

                        <p className="mt-2 font-meta text-body text-beige-kem/85">
                          {booking.selectedTime} · {formatEventDate(booking.selectedDate, true)}
                        </p>
                        <p className="truncate font-meta text-meta text-ink-soft">
                          {[booking.movie.venueName, booking.movie.city]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>

                        {/*
                          The stub's own line of small print: what seat, what it cost, whether it
                          still works. Ruled off from the title block the way a real ticket rules
                          its tear-off strip.
                        */}
                        <dl className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-beige-kem/25 pt-3">
                          <div>
                            <dt className="label-eyebrow text-ink-soft">
                              {booking.selectedSeats.length > 1 ? "Ghế" : "Vé"}
                            </dt>
                            <dd className="mt-0.5 font-meta text-body text-beige-kem">
                              {booking.selectedSeats.map((seat) => seat.id).join(", ") || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="label-eyebrow text-ink-soft">Mã đơn</dt>
                            <dd className="mt-0.5 font-meta text-body tabular-nums text-beige-kem">
                              {booking.id}
                            </dd>
                          </div>
                          {/*
                            The status labels the price, and the colour belongs to the status, not
                            to the money. Tinting the amount made a valid ticket and a cancelled one
                            differ by the shade of a number, while the word above it — the thing
                            actually being said — sat in the same grey either way.
                          */}
                          <div className="ml-auto text-right">
                            <dt className={`label-eyebrow ${status.className}`}>{status.label}</dt>
                            <dd className="mt-0.5 font-display text-lede font-black leading-none text-beige-kem">
                              {formatVnd(spent)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
