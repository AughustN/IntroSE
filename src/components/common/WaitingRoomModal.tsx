import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Users, Clock, ShieldCheck } from 'lucide-react';
import { joinWaitingRoom, getWaitingRoomStatus } from '../../services/waitingRoomClient.js';
import { watchWaitingRoom } from '../../services/waitingRoomSocket.js';
import { TurnstileWidget } from './TurnstileWidget.js';

interface WaitingRoomModalProps {
  showtimeId: number;
  isOpen: boolean;
  onAdmitted: (queueToken: string, turnstileToken?: string) => void;
  onClose?: () => void;
}

export const WaitingRoomModal: React.FC<WaitingRoomModalProps> = ({
  showtimeId,
  isOpen,
  onAdmitted,
  onClose,
}) => {
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [displayWaitSeconds, setDisplayWaitSeconds] = useState<number | null>(null);
  /*
   * Null until Cloudflare hands one over — never a stand-in string.
   *
   * Both of these opened on the literal `'mock-turnstile-token'`, and admission fires the moment
   * the queue lets the buyer through, which on a short queue beats the widget: the script has to
   * download, render and solve, and that is seconds, while `joinWaitingRoom` is one round trip. The
   * placeholder therefore went to the server as if it were a solved challenge. It passed only
   * because `verifyTurnstile` waves through anything starting with `mock-` while NODE_ENV is
   * development — so the gate looked fine on every laptop and would have failed 100% of hot-event
   * purchases on the VPS, where the string goes to Cloudflare and comes back invalid.
   *
   * `TurnstileWidget` still emits `mock-turnstile-token` itself when no site key is configured.
   * That is the deliberate no-credentials path and the server matches it; the difference is that it
   * now comes from the widget saying so, not from a field that was never filled in.
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
      // waiting for — the hold-up is the challenge below, and it is the thing they can act on.
      setHeldForChallenge(true);
    },
    [onAdmitted],
  );

  /*
   * Stable across renders, so the challenge below is mounted once and left alone. `TurnstileWidget`
   * no longer tears itself down when this identity changes, but handing it a fresh arrow on every
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

        if (joinRes.status === 'admitted' && joinRes.queueToken) {
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
         * went out — nothing is replayed on reconnect. Ten seconds is chosen for that job. At two
         * it was doing the work, and doing it with a spread wider than the queue order it was
         * reporting.
         */
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await getWaitingRoomStatus(showtimeId);
            if (!isMounted) return;

            if (statusRes.status === 'admitted' && statusRes.queueToken) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              admit(statusRes.queueToken);
            } else if (statusRes.status === 'waiting') {
              setQueuePosition(statusRes.queuePosition ?? 1);
              const nextWait = statusRes.estimatedWaitSeconds ?? 3;
              setDisplayWaitSeconds((prev) => (prev === null || prev <= 0 ? nextWait : prev));
            } else if (statusRes.status === 'expired') {
              /*
               * Neither holding a pass nor standing in the line.
               *
               * The server answers this when a pass ran out unused, and after a restart, which
               * takes every queue with it. Nothing used to read the case: the modal kept the last
               * position it had been told on screen and polled a room it was no longer in, so the
               * number stayed put and the turn never came. Rejoining is the only move that leads
               * anywhere, and it is what the reader would ask for if the screen told them.
               */
              setQueuePosition(null);
              setDisplayWaitSeconds(null);
              void initQueue();
            }
          } catch (err: unknown) {
            console.error('Polling waiting room failed:', err);
          }
        }, 10_000);
      } catch (err: unknown) {
        if (isMounted) {
          setError((err as Error).message || 'Không thể tham gia phòng chờ.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 md:p-8 text-center overflow-hidden">
        {/* Background glow */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl" />

        <div className="relative">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute -top-2 -right-2 p-1.5 text-slate-400 hover:text-slate-200 transition-colors text-sm font-bold"
              aria-label="Đóng phòng chờ"
            >
              ✕
            </button>
          )}

          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 ring-8 ring-indigo-50/50 dark:ring-indigo-950/20">
            <Users className="w-8 h-8 animate-pulse" />
          </div>

          <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Phòng Chờ Giữ Vé
          </h3>
          {/*
            What this room does, said plainly.

            It used to promise a "hàng đợi công bằng" and "phân phối công bằng", and it does not
            allocate anything: admission is permission to try, and nothing here reserves a seat for
            the person holding a pass. Everyone let in at the same moment still competes for the
            same seats. Saying otherwise sets a reader up to feel cheated by working software.
          */}
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Sự kiện đang có lượng truy cập rất cao. Chúng tôi cho từng nhóm nhỏ vào chọn vé lần
            lượt, theo đúng thứ tự đến.
          </p>

          {heldForChallenge ? (
            <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300">
              Đã tới lượt bạn. Đang chờ xác minh bảo mật bên dưới hoàn tất để mở trang chọn vé.
            </div>
          ) : error ? (
            <div className="p-4 mb-4 text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-900/50">
              {error}
            </div>
          ) : (
            <div className="space-y-4 mb-6">
              {/* Queue Position Box */}
              <div className="p-5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold block mb-1">
                  Vị trí trong hàng đợi
                </span>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-4xl font-extrabold text-indigo-600 dark:text-indigo-400">
                    {queuePosition !== null ? `#${queuePosition}` : '...'}
                  </span>
                </div>
              </div>

              {/* Estimated Time Box */}
              <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Clock className="w-4 h-4 text-indigo-500" />
                <span>
                  Thời gian chờ dự kiến:{' '}
                  <strong className="text-indigo-600 dark:text-indigo-400 font-mono">
                    {displayWaitSeconds !== null
                      ? displayWaitSeconds > 0
                        ? `khoảng ${displayWaitSeconds} giây`
                        : 'Đang cấp lượt vào giữ vé...'
                      : 'Đang tính toán...'}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {/* Cloudflare Turnstile Verification in background / inline */}
          <div className="my-3">
            <TurnstileWidget onSuccess={handleChallengeSolved} />
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 py-2 px-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-full w-fit mx-auto border border-emerald-200/60 dark:border-emerald-800/40">
            <ShieldCheck className="w-4 h-4" />
            <span>Đang xác minh người thật để chặn bot mua vé tự động</span>
          </div>

          {/*
            This line used to warn that reloading loses your place. It does not: `enqueue` looks the
            caller up by user id and hands back the position they already hold, so a refresh returns
            to the same spot. The warning frightened people out of an action that was always safe —
            and the true caveat is the opposite one, which is worth saying instead.
          */}
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
            Bạn có thể tải lại trang mà không mất vị trí.
          </p>
        </div>
      </div>
    </div>
  );
};
