import React, { useEffect, useState, useRef } from "react";
import { Users, Clock, ShieldCheck, AlertCircle, X } from "lucide-react";
import { joinWaitingRoom, getWaitingRoomStatus } from "../../services/waitingRoomClient.js";
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
  const [estimatedWaitSeconds, setEstimatedWaitSeconds] = useState<number | null>(null);
  const [displayWaitSeconds, setDisplayWaitSeconds] = useState<number | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>("mock-turnstile-token");
  const turnstileTokenRef = useRef<string>("mock-turnstile-token");
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sync theme with provided prop or root data-theme attribute
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (theme) return theme;
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    if (theme) {
      setResolvedTheme(theme);
      return;
    }
    const observer = new MutationObserver(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") {
        setResolvedTheme(attr);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [theme]);

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
      try {
        const joinRes = await joinWaitingRoom(showtimeId);
        if (!isMounted) return;

        if (joinRes.status === "admitted" && joinRes.queueToken) {
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

            if (statusRes.status === "admitted" && statusRes.queueToken) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              onAdmitted(statusRes.queueToken, turnstileTokenRef.current);
            } else if (statusRes.status === "waiting") {
              setQueuePosition(statusRes.queuePosition ?? 1);
              const nextWait = statusRes.estimatedWaitSeconds ?? 3;
              setEstimatedWaitSeconds(nextWait);
              setDisplayWaitSeconds((prev) => (prev === null || prev <= 0 ? nextWait : prev));
            }
          } catch (err: unknown) {
            console.error("Polling waiting room failed:", err);
          }
        }, 2000);
      } catch (err: unknown) {
        if (isMounted) {
          setError((err as Error).message || "Không thể tham gia phòng chờ.");
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
          Sự kiện đang có lượng truy cập rất cao. Bạn đang ở trong hàng đợi công bằng của TixHub.
        </p>

        {error ? (
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
          <TurnstileWidget
            theme={resolvedTheme}
            onSuccess={(token) => {
              turnstileTokenRef.current = token;
              setTurnstileToken(token);
            }}
          />
        </div>

        {/* Fair distribution anti-bot badge */}
        <div className="mx-auto flex w-fit items-center justify-center gap-2 rounded-full border border-la-co/40 bg-la-co/15 px-3.5 py-1.5 font-meta text-meta text-beige-kem">
          <ShieldCheck className="h-4 w-4 shrink-0 text-la-co-ink" />
          <span>Chống bot & phân phối công bằng cho người thật</span>
        </div>

        <p className="mt-5 font-meta text-eyebrow uppercase tracking-wider text-beige-kem/50">
          Vui lòng không tải lại trang để tránh mất vị trí ưu tiên.
        </p>
      </div>
    </div>
  );
};
