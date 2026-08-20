import React, { useEffect, useState, useRef } from 'react';
import { Users, Clock, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { joinWaitingRoom, getWaitingRoomStatus } from '../../services/waitingRoomClient.js';
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
  const [estimatedWaitSeconds, setEstimatedWaitSeconds] = useState<number | null>(null);
  const [displayWaitSeconds, setDisplayWaitSeconds] = useState<number | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>('mock-turnstile-token');
  const turnstileTokenRef = useRef<string>('mock-turnstile-token');
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      try {
        const joinRes = await joinWaitingRoom(showtimeId);
        if (!isMounted) return;

        if (joinRes.status === 'admitted' && joinRes.queueToken) {
          onAdmitted(joinRes.queueToken, turnstileTokenRef.current);
          return;
        }

        const pos = joinRes.queuePosition ?? 1;
        const waitSec = joinRes.estimatedWaitSeconds ?? 3;
        setQueuePosition(pos);
        setEstimatedWaitSeconds(waitSec);
        setDisplayWaitSeconds(waitSec);

        // Start active polling every 2 seconds
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await getWaitingRoomStatus(showtimeId);
            if (!isMounted) return;

            if (statusRes.status === 'admitted' && statusRes.queueToken) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              onAdmitted(statusRes.queueToken, turnstileTokenRef.current);
            } else if (statusRes.status === 'waiting') {
              setQueuePosition(statusRes.queuePosition ?? 1);
              const nextWait = statusRes.estimatedWaitSeconds ?? 3;
              setEstimatedWaitSeconds(nextWait);
              setDisplayWaitSeconds((prev) => (prev === null || prev <= 0 ? nextWait : prev));
            }
          } catch (err: unknown) {
            console.error('Polling waiting room failed:', err);
          }
        }, 2000);
      } catch (err: unknown) {
        if (isMounted) {
          setError((err as Error).message || 'Không thể tham gia phòng chờ.');
        }
      }
    }

    initQueue();

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, showtimeId, onAdmitted]);

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
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Sự kiện đang có lượng truy cập rất cao. Bạn đang ở trong hàng đợi công bằng của TixHub.
          </p>

          {error ? (
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
            <TurnstileWidget
              onSuccess={(token) => {
                turnstileTokenRef.current = token;
                setTurnstileToken(token);
              }}
            />
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 py-2 px-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-full w-fit mx-auto border border-emerald-200/60 dark:border-emerald-800/40">
            <ShieldCheck className="w-4 h-4" />
            <span>Chống bot & phân phối công bằng cho người thật</span>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
            Vui lòng không tải lại trang để tránh mất vị trí ưu tiên.
          </p>
        </div>
      </div>
    </div>
  );
};
