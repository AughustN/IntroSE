/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { organizerApi, type ScanTicket } from "../../services/catalogClient";

/*
 * The scanner, and its 316KB of `jsqr`, fetched when the camera is switched on.
 *
 * Door staff open this panel; everybody else on the organizer console never does, and before the
 * split the decoder shipped to every visitor of the landing page. It is behind a button that the
 * reader has to press, which is as good a load trigger as exists.
 */
const QrCameraScan = lazy(() => import("../QrCameraScan"));

/**
 * Door staff admitting guests, on the organizer's own event (US6).
 *
 * This lived inside the old `SingleEventPage`, which the organizer-console rewrite deleted along
 * with the page — the API client, the routes and `checkin.service` all survived, but nothing on the
 * screen called them any more and `QrCameraScan` was left with no importer at all. It comes back as
 * its own component rather than as another block inside the editor: soaking a camera loop, a
 * running log and a scan tally into a form about titles and categories is what made the original
 * page 1073 lines.
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
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ScanTicket | null>(null);
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

  // The timer outlives a close, and a fire after unmount sets state on a component that is gone.
  useEffect(() => clearCooldown, []);

  const addLog = (kind: "ok" | "warning" | "bad", text: string) =>
    setLog((entries) => [{ id: Date.now() + Math.random(), kind, text }, ...entries].slice(0, 30));

  /** The deliberate path: typed, pressed, or confirmed from the card. Earns the full readout. */
  const checkIn = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setViaCamera(false);
    setBusy(true);
    setError(null);
    setAlready(false);
    try {
      const { ticket, already: seen } = await organizerApi.checkIn(value);
      setResult(ticket);
      setAlready(seen);
      if (!seen) onCheckedIn?.();
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Không thể check-in cho vé này.");
    } finally {
      setBusy(false);
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
    setError(null);
    setAlready(false);
    try {
      const { ticket, already: seen } = await organizerApi.checkIn(value);
      setResult(ticket);
      setAlready(seen);
      setOkCount((n) => n + 1);
      const seat = ticket.seatLabel ? ` · ${ticket.seatLabel}` : "";
      addLog(
        seen ? "warning" : "ok",
        seen
          ? `${ticket.customerName} — đã soát vé từ trước`
          : `${ticket.customerName} · ${ticket.tierLabel}${seat} — OK`,
      );
      if (!seen) onCheckedIn?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : "không check-in được";
      setResult(null);
      setError(message);
      setFailCount((n) => n + 1);
      addLog("bad", `${value} — ${message}`);
    } finally {
      busyRef.current = false;
      if (!cooldownRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) void detect(next);
      }
    }
  };

  const close = () => {
    setOpen(false);
    setCameraOn(false);
    setResult(null);
    setError(null);
    resetCooldown();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80"
      >
        Quét vé &amp; check-in
      </button>
    );
  }

  return (
    <div className="mt-3 min-w-0 space-y-3 border-2 border-beige-kem/40 bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3 border-b border-beige-kem/15 pb-2">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold text-beige-kem">Quét vé &amp; check-in</h3>
          <p className="break-words font-meta text-xs text-ink-soft">{eventTitle}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="p-1.5 text-beige-kem/60 transition hover:bg-beige-kem/10 hover:text-beige-kem"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch">
        <input
          type="text"
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
          disabled={busy || !code.trim()}
          className="h-10 w-full bg-burgundy px-3 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50 sm:w-auto sm:px-4"
        >
          Check-in
        </button>
        <button
          type="button"
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
              <p className="p-6 text-center font-meta text-body text-ink-soft">Đang mở camera…</p>
            }
          >
            <QrCameraScan
              onDetect={(scanned) => void detect(scanned)}
              onError={(message) => setError(message)}
              onClose={() => setCameraOn(false)}
            />
          </Suspense>
        </div>
      )}

      {/* The tally and the log appear only once scanning has happened — nothing to show before. */}
      {(okCount > 0 || failCount > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
            <span className="border border-la-co/40 bg-la-co/20 px-2.5 py-0.5 text-la-co">
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
                    ? "text-la-co"
                    : entry.kind === "warning"
                      ? "text-cam-dat"
                      : "text-burgundy-ink"
                }`}
              >
                {entry.kind === "ok" ? "✓" : entry.kind === "warning" ? "⚠️" : "✕"} {entry.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {busy && <p className="font-mono text-[11px] text-beige-kem/70">Đang kiểm tra mã vé…</p>}

      {error && (
        <p className="border-2 border-burgundy bg-burgundy/20 p-3 font-mono text-[11px] text-beige-kem">
          {error}
        </p>
      )}

      {result && !viaCamera && (
        <div className="space-y-3 border border-beige-kem/30 bg-surface-2 p-4">
          <div className="flex items-start justify-between gap-3 border-b border-beige-kem/10 pb-2">
            <div>
              <span className="font-mono text-xs font-bold text-burgundy-ink">{result.code}</span>
              <h4 className="font-display text-sm font-bold text-beige-kem">{result.eventTitle}</h4>
            </div>
            <span
              className={`shrink-0 px-2.5 py-0.5 text-[11px] font-bold ${
                result.status === "checked_in"
                  ? "border border-la-co/40 bg-la-co/20 text-la-co"
                  : result.status === "void"
                    ? "border border-burgundy/40 bg-burgundy/20 text-burgundy-ink"
                    : "border border-cam-dat/40 bg-cam-dat/20 text-cam-dat"
              }`}
            >
              {result.status === "checked_in"
                ? already
                  ? "Đã soát vé (quét lại)"
                  : "Đã check-in thành công"
                : result.status === "void"
                  ? "Vé đã bị hủy"
                  : "Chưa check-in"}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            {[
              ["Khán giả", result.customerName],
              ["Hạng vé", result.tierLabel],
              ["Email", result.customerEmail],
              ["Chỗ ngồi", result.seatLabel || "Vé thường"],
            ].map(([term, value]) => (
              <div key={term} className="min-w-0">
                <dt className="block text-[10px] font-bold uppercase text-beige-kem/50">{term}</dt>
                <dd className="break-words font-semibold text-beige-kem">{value}</dd>
              </div>
            ))}
          </dl>

          {result.status === "unused" && (
            <button
              type="button"
              onClick={() => void checkIn(result.code)}
              disabled={busy}
              className="w-full bg-burgundy py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50"
            >
              Xác nhận check-in ngay
            </button>
          )}
        </div>
      )}
    </div>
  );
}
