/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check, Copy, Download, Home, Printer, Send } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Booking } from "../types";
import { formatEventDate } from "../services/formatDate";
import { formatVnd } from "../services/currency";
import { walletClient } from "../services/walletClient";

interface TicketTicketProps {
  booking: Booking;
  onHomeClick: () => void;
}

/**
 * The QR's own two colours, which are not the page's.
 *
 * A scanner wants maximum luminance contrast and a quiet zone it can find; the palette's dark red
 * on cream is 8.9:1 to a human eye and considerably less to a camera pointed at a phone screen at
 * an angle. Near-black on white is the one pair every reader is calibrated for, so the code sits on
 * its own white tile rather than adopting the ticket's colours.
 */
const QR_DARK = "#141414";
const QR_LIGHT = "#ffffff";

export default function TicketTicket({ booking, onHomeClick }: TicketTicketProps) {
  const [copied, setCopied] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const ticketCode = booking.qrPayload;

  const seats = booking.selectedSeats.map((seat) => seat.id).join(", ");
  const when = `${booking.selectedTime} · ${formatEventDate(booking.selectedDate, true)}`;
  const where = [booking.movie.venueName, booking.movie.city].filter(Boolean).join(" · ");

  useEffect(() => {
    let current = true;
    void QRCode.toDataURL(ticketCode, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: QR_DARK, light: QR_LIGHT },
    }).then((url) => {
      if (current) setQrImage(url);
    });
    return () => {
      current = false;
    };
  }, [ticketCode]);

  /*
   * Tell the mask where the seam is.
   *
   * The holes are cut by `ticket-punch`, which needs a Y — and the seam is wherever the header
   * happens to end, which is one line taller the moment a long ticket code wraps or the viewport
   * narrows. A hardcoded offset was the first attempt and it drifted off the seam exactly when the
   * layout changed; measuring means the holes cannot be anywhere else.
   *
   * `useLayoutEffect` so the value is in place for the first paint — set in a passive effect the
   * card renders once with its holes in the wrong place and then jumps.
   */
  useLayoutEffect(() => {
    const card = ticketRef.current;
    const head = headRef.current;
    if (!card || !head) return;

    const place = () => card.style.setProperty("--punch-y", `${head.offsetHeight}px`);
    place();

    // `border-box`, to match the `offsetHeight` being read. A default observer watches the content
    // box, so anything that moves the seam without moving the text — a padding change at a
    // breakpoint, the dashed rule getting thicker — would resize the band and never fire.
    const observer = new ResizeObserver(place);
    observer.observe(head, { box: "border-box" });
    return () => observer.disconnect();
  }, []);

  const handleCopyCode = () => {
    void navigator.clipboard.writeText(ticketCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePrint = () => {
    const ticket = ticketRef.current;
    if (!ticket) return;
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join("");
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;
    printWindow.document.write(
      `<!doctype html><html><head><title>Vé TixHub</title>${styles}<style>@page{margin:12mm}body{margin:0;background:#fff}.print-ticket{max-width:760px!important;margin:0 auto!important;box-shadow:none!important}.print-ticket *{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><main class="print-ticket">${ticket.outerHTML}</main><script>window.addEventListener('load', () => { window.print(); window.onafterprint = () => window.close(); });</script></body></html>`,
    );
    printWindow.document.close();
  };

  /**
   * Draw the ticket onto a canvas rather than photographing the DOM.
   *
   * This used to call `html2canvas` on the live element, which cannot work here: it reimplements a
   * CSS engine in JavaScript, and Tailwind v4 emits `oklch()` and `color-mix()` for every colour on
   * the page. Those are colour syntaxes its parser predates, so it threw before producing anything —
   * and the `finally` around it reset the button and swallowed the reason, which is why the button
   * appeared to simply do nothing.
   *
   * Painting the few fields the ticket actually carries is both smaller and exact: no CSS to
   * misinterpret, no web font to wait on, no cross-origin poster to taint the canvas.
   */
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const scale = 2;
      const w = 900;
      const h = 420;
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Trình duyệt không hỗ trợ tải ảnh vé.");
      ctx.scale(scale, scale);

      const cream = "#fdf6ea";
      const ink = "#8a0c24";
      const soft = "#b4566a";

      ctx.fillStyle = cream;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

      // The tear line, in the same place the rendered ticket puts it.
      const perfX = w - 300;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(perfX, 28);
      ctx.lineTo(perfX, h - 28);
      ctx.stroke();
      ctx.setLineDash([]);

      const line = (
        text: string,
        x: number,
        y: number,
        size: number,
        color: string,
        weight = "",
      ) => {
        ctx.fillStyle = color;
        ctx.font = `${weight} ${size}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.trim();
        ctx.fillText(text, x, y);
      };
      const label = (text: string, x: number, y: number) =>
        line(text.toUpperCase(), x, y, 11, soft);

      line("VÉ ĐIỆN TỬ TIXHUB", 40, 52, 12, soft, "bold");

      // Wrapped by hand: a title is the one field here long enough to need it.
      const title = booking.movie.title.toUpperCase();
      ctx.font = 'bold 30px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      const words = title.split(" ");
      const lines: string[] = [];
      let row = "";
      for (const word of words) {
        const next = row ? `${row} ${word}` : word;
        if (ctx.measureText(next).width > perfX - 80 && row) {
          lines.push(row);
          row = word;
        } else row = next;
      }
      if (row) lines.push(row);
      lines.slice(0, 2).forEach((text, i) => line(text, 40, 100 + i * 36, 30, ink, "bold"));

      const top = 100 + Math.min(lines.length, 2) * 36 + 24;
      label("Thời gian", 40, top);
      line(when, 40, top + 24, 17, ink, "bold");
      label("Địa điểm", 40, top + 60);
      line(where || "—", 40, top + 84, 17, ink, "bold");
      label(booking.selectedSeats.length > 1 ? "Ghế" : "Vé", 40, top + 120);
      line(seats || "—", 40, top + 144, 17, ink, "bold");
      label("Mã đơn", 300, top + 120);
      line(`#${booking.id}`, 300, top + 144, 17, ink, "bold");

      line(formatVnd(booking.finalPrice), 40, h - 40, 22, ink, "bold");

      if (qrImage) {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Không dựng được mã QR."));
          img.src = qrImage;
        });
        const box = 190;
        ctx.fillStyle = QR_LIGHT;
        ctx.fillRect(perfX + 55, 70, box, box);
        ctx.drawImage(img, perfX + 55, 70, box, box);
        ctx.textAlign = "center";
        line(ticketCode, perfX + 150, 300, 13, ink, "bold");
        line("Quét mã này tại cổng", perfX + 150, 324, 12, soft);
        ctx.textAlign = "left";
      }

      const link = document.createElement("a");
      link.download = `tixhub-ve-${ticketCode}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      // Named, not swallowed. A button that silently does nothing is the bug this replaces.
      setDownloadError(error instanceof Error ? error.message : "Không tải được vé.");
    } finally {
      setDownloading(false);
    }
  };

  const handleResend = async () => {
    const orderId = Number(booking.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      setResendError("Không xác định được đơn vé để gửi lại.");
      return;
    }
    setResending(true);
    setResendError(null);
    try {
      await walletClient.resendTicket(orderId);
      setResent(true);
    } catch (error) {
      setResendError(error instanceof Error ? error.message : "Không thể gửi lại vé.");
    } finally {
      setResending(false);
    }
  };

  const action =
    "label-eyebrow inline-flex items-center gap-2 border border-beige-kem/45 px-4 py-2.5 " +
    "text-beige-kem transition hover:border-beige-kem disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-beige-kem/30 pb-6 text-center">
        <p className="label-eyebrow text-ink-soft">Đã thanh toán</p>
        <h1 className="mt-3 font-display text-title-l font-black uppercase leading-none tracking-[0.02em] text-beige-kem">
          Đặt vé thành công
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-body leading-7 text-beige-kem/80">
          Đơn <span className="font-meta font-bold text-beige-kem">#{booking.id}</span> đã trừ qua{" "}
          {booking.paymentMethod}. Vé QR được gửi về email đăng ký.
        </p>
      </div>

      {/*
        The coupon, in the palette it is actually rendered on.

        The anatomy is the one this screen always had and the one worth keeping: a coloured header
        band, a bite punched out of each side where a stub would tear, a dashed rule under the head,
        and a barcode strip along the foot. That is what makes it read as a ticket rather than as a
        receipt, and no amount of hairline restraint replaces it.

        What was wrong was never the shape — it was every colour. The card was `bg-beige-kem`,
        written when that token was a beige; it is `#8a0c24` now, the page's dark red ink, so the
        ticket rendered as a maroon slab with `text-gray-500` labels and `text-burgundy-ink` values
        on it: grey on dark red, and red on dark red. Same anatomy here, cream card and ink type.

        The side bites are drawn in `xanh-pho`, the page's own colour, so they read as holes rather
        than as dots — which means this block must sit directly on the page and not inside a tinted
        wrapper.
      */}
      {/*
        No outline: a border runs the whole way round, including straight through the two bites, and
        the hole ended up with a wall across it. A shadow gives the card its edge instead — and being
        part of the element, the mask below removes it at the bites along with everything else.
      */}
      <div
        ref={ticketRef}
        className="ticket-punch relative mx-auto max-w-3xl overflow-hidden bg-surface-2 shadow-[0_2px_28px_rgba(138,12,36,0.13)]"
      >
        {/*
          Head: the issuer, and the code the gate reads back to it.

          The tear line is drawn in white, not in ink. It was `border-beige-kem/45` — dark red at
          45% laid along the bottom of a burgundy band, so it was red on red and simply did not
          exist. Everything on this band is white or near-white for the same reason.

          Two pixels rather than one, at 80% rather than 50%: `border-dashed` sizes its dashes off
          the border width, so a hairline produces a dotted whisper where a perforation wants to
          read as something you could tear along.
        */}
        <div
          ref={headRef}
          className="relative flex items-start justify-between gap-4 border-b-2 border-dashed border-white/80 bg-burgundy px-6 py-5 text-white sm:px-8"
        >
          <div>
            <p className="label-eyebrow text-white/75">Vé điện tử</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-display text-title-s font-black uppercase tracking-[0.04em]">
                TixHub
              </span>
              <span className="label-eyebrow bg-white px-1.5 py-0.5 text-burgundy-ink">
                QR Pass
              </span>
            </div>
          </div>

          <div className="min-w-0 text-right">
            <p className="label-eyebrow text-white/75">Mã vé</p>
            <p className="mt-1.5 break-all font-meta text-meta font-bold">{ticketCode}</p>
          </div>
        </div>

        {/* Body: what was bought on the left, what the gate scans on the right. */}
        <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 md:grid-cols-12 md:gap-8">
          <div className="min-w-0 md:col-span-8">
            <span className="label-eyebrow border border-beige-kem/40 px-2 py-0.5 text-ink-soft">
              {booking.movie.ageRating}
            </span>

            <h2 className="mt-3 font-display text-title-m font-black uppercase leading-[1.1] tracking-[0.02em] text-beige-kem">
              {booking.movie.title}
            </h2>
            {booking.movie.originalTitle && (
              <p className="mt-1 font-meta text-meta text-ink-soft">
                {booking.movie.originalTitle}
              </p>
            )}

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
              {[
                ["Thời gian", when],
                ["Địa điểm", where],
                [booking.selectedSeats.length > 1 ? "Ghế" : "Vé", seats],
                ["Khán giả", booking.customerName],
              ]
                .filter(([, value]) => value)
                .map(([term, value]) => (
                  <div key={term} className="min-w-0">
                    <dt className="label-eyebrow text-ink-soft">{term}</dt>
                    <dd className="mt-1 truncate font-meta text-body text-beige-kem" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
            </dl>

            {/* The money, ruled off. Only the lines that carry a number are printed. */}
            <dl className="mt-6 space-y-2 border-t border-beige-kem/25 pt-4 font-meta text-meta">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Tạm tính</dt>
                <dd className="text-beige-kem">{formatVnd(booking.totalPrice)}</dd>
              </div>
              {booking.serviceFee > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Phí dịch vụ</dt>
                  <dd className="text-beige-kem">{formatVnd(booking.serviceFee)}</dd>
                </div>
              )}
              {booking.discount > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Giảm giá</dt>
                  <dd className="text-beige-kem">−{formatVnd(booking.discount)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-beige-kem/25 pt-3">
                <dt className="label-eyebrow text-ink-soft">Tổng thanh toán</dt>
                <dd className="font-display text-title-s font-black leading-none text-burgundy-ink">
                  {formatVnd(booking.finalPrice)}
                </dd>
              </div>
            </dl>
          </div>

          {/*
            The code sits on its own white tile. See `QR_DARK` — a scanner is not reading this in
            the page's colours, and the tile is what gives it the quiet zone it looks for.
          */}
          <div className="flex flex-col items-center justify-center gap-3 border border-beige-kem/25 p-5 md:col-span-4">
            <div className="grid h-36 w-36 place-items-center bg-white p-2">
              {qrImage ? (
                <img src={qrImage} alt={`Mã QR vé ${ticketCode}`} className="h-full w-full" />
              ) : (
                <span className="font-meta text-meta text-ink-soft">Đang tạo QR…</span>
              )}
            </div>
            <p className="label-eyebrow text-center text-beige-kem">Vé vào cửa</p>
            <p className="text-center font-meta text-eyebrow leading-5 text-ink-soft">
              {booking.qrStatus === "unused" ? "Quét mã này tại cổng" : "Đã soát vé"}
            </p>
          </div>
        </div>

        {/* Foot: the small print, and the barcode that makes the whole thing look printed. */}
        <div className="flex flex-col gap-4 border-t border-dashed border-beige-kem/45 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="font-meta text-eyebrow leading-5 text-ink-soft">
            <p>Đơn #{booking.id}</p>
            <p>Đặt lúc {booking.bookingTime}</p>
          </div>

          {/*
            Decoration, and honest about it: these bars encode nothing. The scannable code is the QR
            above, so this carries `aria-hidden` rather than inviting a reader to look for meaning.
          */}
          <div aria-hidden="true" className="flex h-8 items-center gap-[2px] overflow-hidden">
            {[
              2, 1, 4, 1, 2, 3, 1, 2, 4, 1, 3, 1, 2, 1, 4, 1, 2, 2, 3, 1, 4, 1, 2, 3, 1, 2, 4, 1,
            ].map((width, index) => (
              <span
                key={index}
                className="h-full bg-beige-kem/70"
                style={{ width: `${width}px` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3">
        <button
          onClick={handlePrint}
          className={`${action} border-burgundy bg-burgundy text-white hover:brightness-95`}
        >
          <Printer aria-hidden className="h-3.5 w-3.5" />
          In vé
        </button>
        <button onClick={() => void handleDownload()} disabled={downloading} className={action}>
          <Download aria-hidden className="h-3.5 w-3.5" />
          {downloading ? "Đang tải…" : "Tải ảnh vé"}
        </button>
        <button onClick={handleCopyCode} className={action}>
          {copied ? (
            <Check aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Copy aria-hidden className="h-3.5 w-3.5" />
          )}
          {copied ? "Đã sao chép" : "Sao chép mã"}
        </button>
        <button onClick={() => void handleResend()} disabled={resending} className={action}>
          <Send aria-hidden className="h-3.5 w-3.5" />
          {resending ? "Đang gửi…" : resent ? "Đã gửi lại" : "Gửi lại email"}
        </button>
        <button onClick={onHomeClick} className={action}>
          <Home aria-hidden className="h-3.5 w-3.5" />
          Về trang chủ
        </button>
      </div>

      {(downloadError || resendError) && (
        <p className="text-center font-meta text-body text-burgundy-ink">
          {downloadError ?? resendError}
        </p>
      )}

      <p className="mx-auto max-w-3xl border-t border-beige-kem/25 pt-6 text-center font-meta text-meta leading-6 text-ink-soft">
        Vé đã lưu trong <b className="text-beige-kem">Vé của tôi</b>. Có thể gửi lại email tối đa 3
        lần mỗi giờ.
      </p>
    </div>
  );
}
