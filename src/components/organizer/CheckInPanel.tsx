/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import {
  ApiError,
  organizerApi,
  type ConcessionRedemption,
  type ScanTicket,
} from "../../services/catalogClient";
import { formatVnd } from "../../services/currency";
import { formatShowtimeAt } from "../../services/formatDate";

/**
 * What one scanned code turned out to be. The counter scans TWO kinds of QR — a ticket admits its
 * holder, a concession voucher (014) hands over the whole order's snacks — and staff should not
 * have to know which is which.
 */
type ScanOutcome =
  | { kind: "ticket"; ticket: ScanTicket; already: boolean }
  | { kind: "concession"; voucher: ConcessionRedemption }
  | { kind: "error"; message: string };

/** Ticket first; only "no such ticket of yours" falls through to the voucher lookup. */
async function scanCode(value: string): Promise<ScanOutcome> {
  try {
    const { ticket, already } = await organizerApi.checkIn(value);
    return { kind: "ticket", ticket, already };
  } catch (e) {
    // A void ticket must keep its own refusal — only a clean miss tries the other kind.
    if (!(e instanceof ApiError) || e.apiCode !== "ticket_not_found") {
      return { kind: "error", message: e instanceof Error ? e.message : "Mã không đọc được." };
    }
  }
  try {
    const voucher = await organizerApi.concessionsRedeem(value);
    return { kind: "concession", voucher };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "Mã không đọc được." };
  }
}

/*
 * The scanner, and its 316KB of `jsqr`, fetched when the camera is switched on.
 *
 * Door staff open this panel; everybody else on the organizer console never does, and before the
 * split the decoder shipped to every visitor of the landing page. It is behind a button that the
 * reader has to press, which is as good a load trigger as exists.
 */
const QrCameraScan = lazy(() => import("../QrCameraScan"));

/**
 * Account-wide admission desk on the organizer's event list (US6). The API enforces ownership,
 * ticket validity and entry times; results name the actual event/showtime read from the QR.
 * Opening this panel does not request camera access until the organizer chooses to scan.
 *
 * Two ways in, deliberately. The camera is what a queue at the door needs; the text field is what
 * works when the camera will not focus, when a handheld barcode gun is plugged in (they type and
 * press Enter), or when a guest reads their code off a screen.
 */
export default function CheckInPanel({
  eventTitle,
  onCheckedIn,
}: {
  eventTitle: string;
  /** A ticket actually flipped to `checked_in` — the caller refreshes attendance counts. */
  onCheckedIn?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedRef = useRef(false);
  const sessionRef = useRef(0);
  const [code, setCode] = useState("");
  const [ticketResult, setTicketResult] = useState<ScanTicket | null>(null);
  const [concessionResult, setConcessionResult] = useState<ConcessionRedemption | null>(null);
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  /*
   * Which way the last scan arrived. The camera keeps running and the log under it is the readout;
   * a full card per guest would push that log off the screen. A deliberate look-up still gets one.
   */
  const [viaCamera, setViaCamera] = useState(false);
  const [log, setLog] = useState<{ id: number; kind: "ok" | "warning" | "bad"; text: string }[]>(
    [],
  );
  const [okCount, setOkCount] = useState(0);
  const [failCount, setFailCount] = useState(0);

  /** In flight. Serializes check-ins so a reply can never land after the scan that replaced it. */
  const busyRef = useRef(false);
  /** Presented while another was in flight — held rather than dropped, and run next. */
  const pendingRef = useRef<string | null>(null);
  /*
   * The 3-second gap between admissions.
   *
   * Without it a code that stays in frame is read again the moment the previous check-in returns,
   * and the second read answers "already checked in" for a guest who was admitted a blink earlier —
   * an alarm about nothing, in the one workflow where staff cannot stop to read.
   */
  const cooldownRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCooldown = () => {
    if (cooldownTimerRef.current !== null) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  };

  const resetCooldown = () => {
    pendingRef.current = null;
    clearCooldown();
    cooldownRef.current = false;
  };

  // Leaving the list must stop queued scans as well as unmounting the camera itself.
  useEffect(
    () => () => {
      sessionRef.current++;
      pendingRef.current = null;
      clearCooldown();
    },
    [],
  );

  useEffect(() => {
    if (open) {
      openedRef.current = true;
      inputRef.current?.focus();
    } else if (openedRef.current) {
      triggerRef.current?.focus();
    }
  }, [open]);

  const addLog = (kind: "ok" | "warning" | "bad", text: string) =>
    setLog((entries) => [{ id: Date.now() + Math.random(), kind, text }, ...entries].slice(0, 30));

  /** Apply a finished scan to the panel's readouts. Shared by the typed and camera paths. */
  const applyOutcome = (outcome: ScanOutcome): boolean => {
    setTicketResult(null);
    setConcessionResult(null);
    setError(null);
    setAlready(false);
    if (outcome.kind === "error") {
      setError(outcome.message);
      return false;
    }
    if (outcome.kind === "ticket") {
      setTicketResult(outcome.ticket);
      setAlready(outcome.already);
      return !outcome.already;
    }
    setConcessionResult(outcome.voucher);
    return !outcome.voucher.already;
  };

  const concessionSummary = (voucher: ConcessionRedemption): string => {
    const units = voucher.lines.reduce((sum, line) => sum + line.quantity, 0);
    return `${voucher.eventTitle} · ${voucher.buyerName} · bắp nước ×${units}`;
  };

  /** The deliberate path: typed, pressed, or confirmed from the card. Earns the full readout. */
  const checkIn = async (raw: string) => {
    const value = raw.trim();
    if (!value || busyRef.current || cameraOn) return;
    const session = sessionRef.current;
    busyRef.current = true;
    setViaCamera(false);
    setBusy(true);
    try {
      const outcome = await scanCode(value);
      if (session !== sessionRef.current) return;
      if (applyOutcome(outcome)) onCheckedIn?.();
    } finally {
      busyRef.current = false;
      if (session === sessionRef.current) setBusy(false);
    }
  };

  /** The camera path: stays open, admits one guest after another, never reopens between tickets. */
  const detect = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (busyRef.current || cooldownRef.current) {
      pendingRef.current = value;
      return;
    }

    const session = sessionRef.current;
    busyRef.current = true;
    cooldownRef.current = true;
    clearCooldown();
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      cooldownRef.current = false;
      if (busyRef.current) return;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) void detect(next);
    }, 3000);

    setViaCamera(true);
    setCode(value);
    try {
      const outcome = await scanCode(value);
      if (session !== sessionRef.current) return;
      const admitted = applyOutcome(outcome);
      if (outcome.kind === "error") {
        setFailCount((n) => n + 1);
        addLog("bad", `${value} — ${outcome.message}`);
      } else if (outcome.kind === "concession") {
        setOkCount((n) => n + 1);
        addLog(
          outcome.voucher.already ? "warning" : "ok",
          outcome.voucher.already
            ? `${concessionSummary(outcome.voucher)} — đã nhận từ trước`
            : `${concessionSummary(outcome.voucher)} — OK`,
        );
      } else {
        setOkCount((n) => n + 1);
        const ticket = outcome.ticket;
        const seat = ticket.seatLabel ? ` · ${ticket.seatLabel}` : "";
        addLog(
          outcome.already ? "warning" : "ok",
          outcome.already
            ? `${ticket.eventTitle} · ${formatShowtimeAt(ticket.startsAt)} · ${ticket.customerName} — đã soát vé từ trước`
            : `${ticket.eventTitle} · ${formatShowtimeAt(ticket.startsAt)} · ${ticket.customerName} · ${ticket.tierLabel}${seat} — OK`,
        );
      }
      if (admitted) onCheckedIn?.();
    } finally {
      busyRef.current = false;
      if (session === sessionRef.current && !cooldownRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) void detect(next);
      }
    }
  };

  const close = () => {
    sessionRef.current++;
    setOpen(false);
    setCameraOn(false);
    setTicketResult(null);
    setConcessionResult(null);
    setError(null);
    setBusy(false);
    resetCooldown();
  };

  return (
    <section
      aria-label="Check-in sự kiện"
      className="min-w-0 border-2 border-beige-kem/30 bg-surface-2 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-beige-kem">Check-in sự kiện</h2>
          <p className="mt-1 break-words text-sm text-ink-soft">
            {eventTitle} · Quét QR hoặc nhập mã vé, không cần mở trang chỉnh sửa.
          </p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-2 border-beige-kem/40 px-4 text-sm font-bold text-beige-kem transition hover:border-beige-kem hover:bg-beige-kem/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy"
        >
          <ScanLine aria-hidden="true" className="h-4 w-4" />
          {open ? "Đóng check-in" : "Quét QR check-in"}
        </button>
      </div>
      {open && (
        <div id={panelId} className="mt-4 space-y-3 border-t border-beige-kem/20 pt-4">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch">
            <input
              ref={inputRef}
              aria-label="Mã vé hoặc mã nhận bắp nước"
              type="text"
              disabled={busy || cameraOn}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              // A barcode gun is a keyboard that types the code and presses Enter, so Enter has to be
              // the same action as the button beside it.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void checkIn(code);
              }}
              placeholder="Quét hoặc nhập mã vé…"
              className="col-span-2 h-10 min-w-0 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 font-mono text-sm text-beige-kem outline-none focus:border-burgundy sm:flex-1"
            />
            <button
              type="button"
              onClick={() => void checkIn(code)}
              disabled={busy || cameraOn || !code.trim()}
              className="h-10 w-full bg-burgundy px-3 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50 sm:w-auto sm:px-4"
            >
              Check-in
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setCameraOn((on) => {
                  if (on) resetCooldown();
                  return !on;
                })
              }
              className={`h-10 w-full border-2 px-2 py-1.5 text-xs font-bold transition sm:w-auto sm:px-3 ${
                cameraOn
                  ? "border-burgundy bg-burgundy text-white"
                  : "border-beige-kem text-beige-kem/80 hover:bg-beige-kem/10"
              }`}
            >
              {cameraOn ? "Tắt camera" : "Mở camera"}
            </button>
          </div>

          {cameraOn && (
            <div className="overflow-hidden border border-beige-kem/30">
              <Suspense
                fallback={
                  <p className="p-6 text-center font-meta text-body text-ink-soft">
                    Đang mở camera…
                  </p>
                }
              >
                <QrCameraScan
                  onDetect={(scanned) => void detect(scanned)}
                  onError={(message) => setError(message)}
                  onClose={() => {
                    resetCooldown();
                    setCameraOn(false);
                  }}
                />
              </Suspense>
            </div>
          )}

          {/* The tally and the log appear only once scanning has happened — nothing to show before. */}
          {(okCount > 0 || failCount > 0) && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                <span className="border border-la-co/40 bg-la-co/20 px-2.5 py-0.5 text-la-co-ink">
                  ✓ {okCount} vé
                </span>
                <span className="border border-burgundy/40 bg-burgundy/20 px-2.5 py-0.5 text-burgundy-ink">
                  ✕ {failCount} lỗi
                </span>
                <span className="font-meta font-normal text-ink-soft">
                  Quét liên tục — đưa lần lượt từng vé vào khung.
                </span>
              </div>
              <ul className="max-h-36 space-y-1 overflow-y-auto border border-beige-kem/20 bg-surface-2 p-2">
                {log.map((entry) => (
                  <li
                    key={entry.id}
                    className={`text-[11px] font-medium ${
                      entry.kind === "ok"
                        ? "text-la-co-ink"
                        : entry.kind === "warning"
                          ? "text-cam-dat-ink"
                          : "text-burgundy-ink"
                    }`}
                  >
                    {entry.kind === "ok" ? "✓" : entry.kind === "warning" ? "⚠" : "✕"} {entry.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {busy && <p className="font-mono text-[11px] text-beige-kem/70">Đang kiểm tra mã vé…</p>}

          {error && (
            <p
              role="alert"
              className="border-2 border-burgundy bg-burgundy/20 p-3 text-sm text-burgundy-ink"
            >
              {error}
            </p>
          )}

          {ticketResult && !viaCamera && (
            <div className="space-y-3 border border-beige-kem/30 bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3 border-b border-beige-kem/10 pb-2">
                <div>
                  <span className="font-mono text-xs font-bold text-burgundy-ink">
                    {ticketResult.code}
                  </span>
                  <h4 className="font-display text-sm font-bold text-beige-kem">
                    {ticketResult.eventTitle}
                  </h4>
                </div>
                <span
                  className={`shrink-0 px-2.5 py-0.5 text-[11px] font-bold ${
                    ticketResult.status === "checked_in"
                      ? "border border-la-co/40 bg-la-co/20 text-la-co-ink"
                      : ticketResult.status === "void"
                        ? "border border-burgundy/40 bg-burgundy/20 text-burgundy-ink"
                        : "border border-cam-dat/40 bg-cam-dat/20 text-cam-dat-ink"
                  }`}
                >
                  {ticketResult.status === "checked_in"
                    ? already
                      ? "Đã soát vé (quét lại)"
                      : "Đã check-in thành công"
                    : ticketResult.status === "void"
                      ? "Vé đã bị hủy"
                      : "Chưa check-in"}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["Khán giả", ticketResult.customerName],
                  ["Hạng vé", ticketResult.tierLabel],
                  ["Email", ticketResult.customerEmail],
                  ["Chỗ ngồi", ticketResult.seatLabel || "Vé thường"],
                  ["Suất diễn", formatShowtimeAt(ticketResult.startsAt)],
                  ["Địa điểm", ticketResult.venueName],
                ].map(([term, value]) => (
                  <div key={term} className="min-w-0">
                    <dt className="block text-[10px] font-bold uppercase text-beige-kem/50">
                      {term}
                    </dt>
                    <dd className="break-words font-semibold text-beige-kem">{value}</dd>
                  </div>
                ))}
              </dl>

              {ticketResult.status === "unused" && (
                <button
                  type="button"
                  onClick={() => void checkIn(ticketResult.code)}
                  disabled={busy}
                  className="w-full bg-burgundy py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50"
                >
                  Xác nhận check-in ngay
                </button>
              )}
            </div>
          )}

          {/* The voucher's readout: what the counter just handed over, in one scan (014 US3). */}
          {concessionResult && !viaCamera && (
            <div className="space-y-3 border border-beige-kem/30 bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3 border-b border-beige-kem/10 pb-2">
                <div>
                  <span className="font-mono text-xs font-bold text-burgundy-ink">
                    Đơn #{concessionResult.orderId}
                  </span>
                  <h4 className="font-display text-sm font-bold text-beige-kem">
                    {concessionResult.eventTitle}
                  </h4>
                </div>
                <span
                  className={`shrink-0 px-2.5 py-0.5 text-[11px] font-bold ${
                    concessionResult.already
                      ? "border border-cam-dat/40 bg-cam-dat/20 text-cam-dat-ink"
                      : "border border-la-co/40 bg-la-co/20 text-la-co-ink"
                  }`}
                >
                  {concessionResult.already ? "Đã nhận bắp nước (quét lại)" : "Đã nhận thành công"}
                </span>
              </div>

              <p className="text-xs text-beige-kem/70">Khán giả: {concessionResult.buyerName}</p>
              <ul className="space-y-1 text-xs">
                {concessionResult.lines.map((line) => (
                  <li key={line.label} className="flex justify-between gap-3">
                    <span className="text-beige-kem">
                      {line.label} ×{line.quantity}
                    </span>
                    <span className="tabular-nums text-beige-kem/70">
                      {formatVnd(line.quantity * line.unitPriceAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
