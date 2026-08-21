import React, { useCallback, useEffect, useState, useRef } from "react";
import { Users, Clock, ShieldCheck, AlertCircle, X } from "lucide-react";
import { joinWaitingRoom, getWaitingRoomStatus } from "../../services/waitingRoomClient.js";
import { watchWaitingRoom } from "../../services/waitingRoomSocket.js";
import { TurnstileWidget } from "./TurnstileWidget.js";

interface WaitingRoomModalProps {
  showtimeId: number;
  isOpen: boolean;
  theme?: "light" | "dark";
  onAdmitted: (queueToken: string, turnstileToken?: string) => void;
  onClose?: () => void;
}

export const WaitingRoomModal: React.FC<WaitingRoomModalProps> = ({
  showtimeId,
  isOpen,
  theme,
  onAdmitted,
  onClose,
}) => {
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [displayWaitSeconds, setDisplayWaitSeconds] = useState<number | null>(null);
  /*
   * Null until Cloudflare hands one over — never a stand-in string.
   *
   * These opened on the literal `"mock-turnstile-token"`, and admission fires the moment the queue
   * lets the buyer through, which on a short queue beats the widget: the script has to download,
   * render and solve, and that is seconds, while `joinWaitingRoom` is one round trip. The
   * placeholder therefore went to the server as if it were a solved challenge. It passed only
   * because `verifyTurnstile` waves through anything starting with `mock-` while NODE_ENV is
   * development — the gate looked healthy on every laptop and would have failed 100% of hot-event
   * purchases on the VPS, where the string goes to Cloudflare and comes back invalid.
   *
   * `TurnstileWidget` still emits `mock-turnstile-token` itself when no site key is configured.
   * That is the deliberate no-credentials path and the server matches it; the difference is that it
   * now comes from the widget saying so, not from a field nobody filled in.
   */
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileTokenRef = useRef<string | null>(null);
  /** An admission that arrived before the challenge did, replayed by the effect below. */
  const pendingAdmitRef = useRef<string | null>(null);
  /** Through the queue, held at the door until Cloudflare answers. */
  const [heldForChallenge, setHeldForChallenge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /*
   * What the page is currently wearing, watched only while nobody has told us.
   *
   * The prop wins, and it wins by being read during render rather than by being copied into state
   * from an effect — writing a prop into state is a second copy of a fact that is already correct
   * on arrival, and it repaints once for nothing every time the prop changes.
   */
  const [observedTheme, setObservedTheme] = useState<"light" | "dark">(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const resolvedTheme = theme ?? observedTheme;

  useEffect(() => {
    if (theme) return;
    const observer = new MutationObserver(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") setObservedTheme(attr);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [theme]);

  /*
   * Leave the room only with both halves in hand.
   *
   * The queue decides WHEN you may buy; the challenge decides WHETHER you are a person. They finish
   * in whichever order the network allows, and the server rejects the purchase if either is
   * missing, so an admission that lands first waits here rather than being spent on a request that
   * cannot succeed. `useRef` and not state: this runs inside a polling callback that closes over
   * the render it was created in, and a stale `useState` value would read `null` forever.
   */
  const admit = useCallback(
    (queueToken: string) => {
      if (turnstileTokenRef.current) {
        onAdmitted(queueToken, turnstileTokenRef.current);
        return;
      }
      pendingAdmitRef.current = queueToken;
      // Say so. The server has already taken this buyer out of the line, so leaving the queue box
      // on screen reports a place they no longer occupy and a wait that is not what they are
      // waiting for — the hold-up is the challenge below, and it is what they can act on.
      setHeldForChallenge(true);
    },
    [onAdmitted],
  );

  /*
   * Stable across renders, so the challenge is mounted once and left alone. `TurnstileWidget` no
   * longer tears itself down when this identity changes, but handing it a fresh arrow on every
   * one-second tick is still the wrong thing to do.
   */
  const handleChallengeSolved = useCallback((token: string) => {
    turnstileTokenRef.current = token;
    setTurnstileToken(token);
  }, []);

  // The other order: the challenge came back after the queue did, so release the parked admission.
  useEffect(() => {
    if (!turnstileToken || !pendingAdmitRef.current) return;
    const queueToken = pendingAdmitRef.current;
    pendingAdmitRef.current = null;
    onAdmitted(queueToken, turnstileToken);
  }, [turnstileToken, onAdmitted]);

  // Smooth 1-second countdown ticker for user UI
  useEffect(() => {
    if (displayWaitSeconds === null || displayWaitSeconds <= 0) return;
    const tick = setInterval(() => {
      setDisplayWaitSeconds((prev) => (prev !== null && prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(tick);
  }, [displayWaitSeconds]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    let isMounted = true;

    async function initQueue() {
      // Re-entrant: the `expired` branch below calls this from inside the running poll, and a second
      // `setInterval` assigned over the first would leave the first ticking with no handle on it.
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      try {
        const joinRes = await joinWaitingRoom(showtimeId);
        if (!isMounted) return;

        if (joinRes.status === "admitted" && joinRes.queueToken) {
          admit(joinRes.queueToken);
          return;
        }

        const pos = joinRes.queuePosition ?? 1;
        const waitSec = joinRes.estimatedWaitSeconds ?? 3;
        setQueuePosition(pos);
        setDisplayWaitSeconds(waitSec);

        /*
         * The poll is the safety net now, not the mechanism.
         *
         * Admission and every move up the line arrive over the socket subscribed below, within a
         * few milliseconds of the server deciding them. What is left for the poll is the case the
         * push cannot cover: a socket that never connected, or one that was down when the message
         * went out — nothing is replayed on reconnect. At two seconds it was doing the work, and
         * doing it with a spread wider than the queue order it was reporting.
         */
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await getWaitingRoomStatus(showtimeId);
            if (!isMounted) return;

            if (statusRes.status === "admitted" && statusRes.queueToken) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              admit(statusRes.queueToken);
            } else if (statusRes.status === "waiting") {
              setQueuePosition(statusRes.queuePosition ?? 1);
              const nextWait = statusRes.estimatedWaitSeconds ?? 3;
              setDisplayWaitSeconds((prev) => (prev === null || prev <= 0 ? nextWait : prev));
            } else if (statusRes.status === "expired") {
              /*
               * The server answers this when a pass ran out unused, and after a restart, which
               * takes every queue with it. Nothing used to read the case: the modal kept the last
               * position it had been told on screen and polled a room it was no longer in, so the
               * number stayed put and the turn never came. Rejoining is the only move that leads
               * anywhere.
               */
              setQueuePosition(null);
              setDisplayWaitSeconds(null);
              void initQueue();
            }
          } catch (err: unknown) {
            console.error("Polling waiting room failed:", err);
          }
        }, 10_000);
      } catch (err: unknown) {
        if (isMounted) {
          setError((err as Error).message || "Không thể tham gia phòng chờ.");
        }
      }
    }

    initQueue();

    // Subscribed before the join resolves, so an admission decided while `initQueue` is still in
    // flight is not missed.
    const unwatch = watchWaitingRoom(showtimeId, {
      onAdmitted: (push) => {
        if (!isMounted) return;
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        admit(push.queueToken);
      },
      onPosition: (push) => {
        if (!isMounted) return;
        setQueuePosition(push.queuePosition);
        setDisplayWaitSeconds(push.estimatedWaitSeconds);
      },
    });

    return () => {
      isMounted = false;
      unwatch();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, showtimeId, admit]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiting-room-title"
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border-2 border-beige-kem bg-xanh-pho p-6 text-center text-beige-kem shadow-2xl transition-colors sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl border-2 border-beige-kem/40 font-meta text-meta text-beige-kem/70 transition hover:border-beige-kem hover:bg-bubblegum/20 hover:text-beige-kem"
            aria-label="Đóng phòng chờ"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Status Badge Icon */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-cam-dat/40 bg-cam-dat/15 text-cam-dat-ink">
          <Users className="h-7 w-7 animate-pulse" />
        </div>

        {/* Modal Heading */}
        <h2
          id="waiting-room-title"
          className="mt-4 font-display text-title-m font-black text-beige-kem sm:text-title-l"
        >
          Phòng Chờ Giữ Vé
        </h2>
        <p className="mx-auto mt-2 max-w-md text-body leading-6 text-beige-kem/70">
          Sự kiện đang có lượng truy cập rất cao. Chúng tôi cho từng nhóm nhỏ vào chọn vé lần
          lượt, theo đúng thứ tự đến.
        </p>

        {heldForChallenge ? (
          <div className="mt-5 rounded-xl border-2 border-la-co/40 bg-la-co/15 p-4 font-meta text-body text-beige-kem">
            Đã tới lượt bạn. Đang chờ xác minh bảo mật bên dưới hoàn tất để mở trang chọn vé.
          </div>
        ) : error ? (
          <div className="mt-5 flex items-start gap-3 rounded-xl border-2 border-burgundy bg-burgundy/10 p-4 text-left font-meta text-body text-burgundy-ink">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* Ticket-style Queue Position Box */}
            <div className="relative rounded-xl border-2 border-beige-kem/35 bg-surface-2 p-5 text-center transition-colors">
              <span className="block font-meta text-eyebrow font-bold uppercase tracking-wider text-ink-soft">
                Vị trí trong hàng đợi
              </span>

              <div className="mt-2 flex items-center justify-center">
                <span className="font-display text-5xl font-black tracking-tight text-burgundy-ink tabular-nums sm:text-6xl">
                  {queuePosition !== null ? `#${queuePosition}` : "..."}
                </span>
              </div>

              {/* Visual queue progress indicator */}
              <div className="mx-auto mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-beige-kem/15">
                <div
                  className="h-full rounded-full bg-burgundy transition-all duration-500 ease-out"
                  style={{
                    width:
                      queuePosition !== null
                        ? `${Math.max(15, Math.min(100, 100 - (queuePosition - 1) * 15))}%`
                        : "30%",
                  }}
                />
              </div>

              {/* Dashed perforation divider */}
              <div className="my-4 border-t border-dashed border-beige-kem/30" />

              {/* Estimated Time */}
              <div className="flex items-center justify-center gap-2 font-meta text-body text-beige-kem/85">
                <Clock className="h-4 w-4 shrink-0 text-cam-dat-ink" />
                <span>
                  Thời gian chờ dự kiến:{" "}
                  <strong className="font-bold text-cam-dat-ink tabular-nums">
                    {displayWaitSeconds !== null
                      ? displayWaitSeconds > 0
                        ? `khoảng ${displayWaitSeconds} giây`
                        : "Đang cấp lượt vào giữ vé…"
                      : "Đang tính toán…"}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Turnstile Security verification widget */}
        <div className="my-3">
          <TurnstileWidget theme={resolvedTheme} onSuccess={handleChallengeSolved} />
        </div>

        {/* Fair distribution anti-bot badge */}
        <div className="mx-auto flex w-fit items-center justify-center gap-2 rounded-full border border-la-co/40 bg-la-co/15 px-3.5 py-1.5 font-meta text-meta text-beige-kem">
          <ShieldCheck className="h-4 w-4 shrink-0 text-la-co-ink" />
          <span>Đang xác minh người thật để chặn bot mua vé tự động</span>
        </div>

        <p className="mt-5 font-meta text-eyebrow uppercase tracking-wider text-beige-kem/50">
          Bạn có thể tải lại trang mà không mất vị trí.
        </p>
      </div>
    </div>
  );
};
