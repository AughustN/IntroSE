/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Booking, MovieEvent } from "../types";

interface AdminPanelProps {
  events: MovieEvent[];
  bookings: Booking[];
  onBack: () => void;
}

const adminTabs = [
  { id: "events", label: "Sự kiện" },
  { id: "orders", label: "Đơn hàng" },
  { id: "promos", label: "Voucher" },
  { id: "checkin", label: "Check-in" },
  { id: "reports", label: "Báo cáo" },
  { id: "roles", label: "Phân quyền" },
];

export default function AdminPanel({ events, bookings, onBack }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState("events");
  const [scanCode, setScanCode] = useState(bookings[0]?.id || "TB123456");
  const revenue = bookings.reduce((sum, booking) => sum + (booking.finalPrice || booking.totalPrice), 0);
  const soldSeats = bookings.reduce((sum, booking) => sum + booking.selectedSeats.length, 0);
  const capacity = events.length * 84;
  const fillRate = capacity ? Math.round((soldSeats / capacity) * 100) : 0;

  const formatPrice = (price: number) =>
    new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(price);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-beige-kem/25 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 font-mono text-sm text-ink-soft transition hover:text-beige-kem"
        >
          Quay lại trang bán vé
        </button>
        <div className="text-left lg:text-right">
          <h1 className="font-display text-3xl font-black text-beige-kem">Admin Console Mock</h1>
          <p className="mt-1 text-sm text-beige-kem/65">
            Frontend-only dashboard cho đội backend nối API và phân quyền sau.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Doanh thu mock" value={formatPrice(revenue)} />
        <Metric label="Đơn đã tạo" value={`${bookings.length}`} />
        <Metric label="Vé đã bán" value={`${soldSeats}`} />
        <Metric label="Tỷ lệ lấp đầy" value={`${fillRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-2">
          {adminTabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition ${
                  selected
                    ? "bg-beige-kem text-xanh-pho"
                    : "text-beige-kem/70 hover:bg-surface-2 hover:text-beige-kem"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <section className="min-h-[520px] rounded-2xl border-2 border-beige-kem bg-xanh-pho p-6">
          {activeTab === "events" && (
            <div className="space-y-5">
              <PanelTitle title="Quản lý sự kiện, suất diễn, địa điểm, sơ đồ ghế" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-beige-kem/25 font-mono text-xs uppercase text-beige-kem/50">
                    <tr>
                      <th className="py-3 pr-4">Sự kiện</th>
                      <th className="py-3 pr-4">Thành phố</th>
                      <th className="py-3 pr-4">Suất diễn</th>
                      <th className="py-3 pr-4">Trạng thái</th>
                      <th className="py-3 pr-4">Sơ đồ ghế</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id} className="border-b border-beige-kem/25">
                        <td className="py-4 pr-4">
                          <p className="font-display font-bold text-beige-kem">{event.title}</p>
                          <p className="font-mono text-xs text-ink-soft">{event.venueName}</p>
                        </td>
                        <td className="py-4 pr-4 text-beige-kem/75">{event.city}</td>
                        <td className="py-4 pr-4 font-mono text-xs text-beige-kem/75">
                          {event.dates.length} ngày / {event.times.length} giờ
                        </td>
                        <td className="py-4 pr-4">
                          <span className="rounded-full border-2 border-beige-kem bg-cam-dat px-2.5 py-1 font-mono text-[10px] uppercase text-on-tint">
                            {event.status}
                          </span>
                        </td>
                        <td className="py-4 pr-4 font-mono text-xs text-ink-soft">84 ghế mock / row A-H</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "orders" && (
            <div className="space-y-5">
              <PanelTitle title="Quản lý đơn hàng, thanh toán, hoàn tiền" />
              {bookings.length === 0 ? (
                <EmptyState text="Chưa có đơn mock. Hãy đặt thử một vé ở frontend để bảng này có dữ liệu." />
              ) : (
                <div className="grid gap-4">
                  {bookings.map((booking) => (
                    <div key={booking.id} className="rounded-xl border-2 border-beige-kem bg-surface-2 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-display text-lg font-bold text-beige-kem">{booking.movie.title}</p>
                          <p className="font-mono text-xs text-ink-soft">{booking.id} / {booking.paymentMethod} / {booking.status}</p>
                        </div>
                        <div className="font-display text-xl font-black text-burgundy">
                          {formatPrice(booking.finalPrice || booking.totalPrice)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-beige-kem/65">
                        <span className="rounded border-2 border-beige-kem px-2 py-1">Ghế {booking.selectedSeats.map((seat) => seat.id).join(", ")}</span>
                        <span className="rounded border-2 border-beige-kem px-2 py-1">Email {booking.customerEmail}</span>
                        <span className="rounded border border-burgundy/30 px-2 py-1 text-burgundy">Hoàn tiền mock</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "promos" && (
            <div className="space-y-5">
              <PanelTitle title="Quản lý mã giảm giá, combo vé, affiliate" />
              <div className="grid gap-4 md:grid-cols-3">
                {["WEEKEND50", "FIRSTBOOK", "GROUP4"].map((code, index) => (
                  <div key={code} className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-5">
                    <p className="font-display text-2xl font-black text-beige-kem">{code}</p>
                    <p className="mt-2 text-sm text-beige-kem/65">
                      {index === 0 ? "Cuối tuần" : index === 1 ? "Khách mới" : "Nhóm bạn"}
                    </p>
                    <p className="mt-4 font-mono text-xs text-ink-soft">Còn hiệu lực / cần API validate</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border-2 border-beige-kem bg-la-co p-4 text-sm leading-6 text-on-tint">
                Combo vé và affiliate hiện đang là mock field trên từng event. Backend cần quản lý campaign, usage limit, min order và commission.
              </div>
            </div>
          )}

          {activeTab === "checkin" && (
            <div className="space-y-5">
              <PanelTitle title="Check-in vé bằng QR" />
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <input
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  className="h-12 rounded-xl border-2 border-beige-kem bg-xanh-pho px-4 font-mono text-sm text-beige-kem outline-none focus:border-burgundy"
                />
                <button className="rounded-xl bg-burgundy px-6 py-3 text-sm font-black text-white">
                  Xác nhận check-in
                </button>
              </div>
              <div className="rounded-2xl border-2 border-beige-kem bg-la-co p-5">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg border-2 border-beige-kem bg-la-co px-3 py-2 font-mono text-xs font-black uppercase text-on-tint">QR</span>
                  <div>
                    <p className="font-display text-xl font-black text-beige-kem">Mã {scanCode}</p>
                    <p className="text-sm text-ink-soft">Mock result: hợp lệ nếu mã khớp booking id trong local history.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "reports" && (
            <div className="space-y-5">
              <PanelTitle title="Báo cáo doanh thu, số vé bán, tỷ lệ lấp đầy" />
              <div className="grid gap-4 md:grid-cols-3">
                <Metric label="GMV" value={formatPrice(revenue)} />
                <Metric label="Seats sold" value={`${soldSeats}`} />
                <Metric label="Fill rate" value={`${fillRate}%`} />
              </div>
              <div className="rounded-2xl border-2 border-beige-kem p-5">
                <div className="mb-3 flex items-center justify-between font-mono text-xs text-beige-kem/60">
                  <span>Biểu đồ mock</span>
                  <span>7 ngày gần nhất</span>
                </div>
                <div className="flex h-56 items-end gap-3">
                  {[40, 72, 56, 88, 64, 92, 76].map((height, index) => (
                    <div key={index} className="flex flex-1 flex-col items-center gap-2">
                      <div className="w-full rounded-t-xl bg-cam-dat" style={{ height: `${height}%` }} />
                      <span className="font-mono text-[10px] text-beige-kem/45">D{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "roles" && (
            <div className="space-y-5">
              <PanelTitle title="Phân quyền admin, nhân viên, đối tác" />
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  ["Admin", "Toàn quyền sự kiện, thanh toán, hoàn tiền, báo cáo"],
                  ["Nhân viên", "Check-in QR, xem đơn, gửi lại email/SMS"],
                  ["Đối tác", "Quản lý sự kiện và xem báo cáo của chính mình"],
                ].map(([role, desc]) => (
                  <div key={role} className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-5">
                    <p className="font-display text-xl font-black text-beige-kem">{role}</p>
                    <p className="mt-2 text-sm leading-6 text-beige-kem/65">{desc}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border-2 border-beige-kem bg-la-co p-4 text-sm leading-6 text-on-tint">
                <span>Backend cần RBAC/ABAC, audit log, tenant id cho đối tác tổ chức sự kiện và khóa quyền hoàn tiền.</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-5">
      <p className="font-mono text-xs uppercase text-beige-kem/50">{label}</p>
      <p className="mt-2 font-display text-2xl font-black text-beige-kem">{value}</p>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-black text-beige-kem">{title}</h2>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-beige-kem/25 p-12 text-center text-sm text-beige-kem/55">
      {text}
    </div>
  );
}