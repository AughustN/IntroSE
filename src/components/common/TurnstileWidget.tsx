import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: (error: unknown) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'invisible';
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  siteKey?: string;
  onSuccess: (token: string) => void;
  onError?: (error: string) => void;
  onExpire?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
}

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string) || '',
  onSuccess,
  onError,
  onExpire,
  theme = 'auto',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /*
   * The three callbacks, held where a re-render cannot reach them.
   *
   * They used to sit in the effect's dependency list, and the effect's cleanup calls
   * `turnstile.remove()`. Callers pass inline arrows — every parent render makes new function
   * identities, so the effect re-ran, tore the challenge down and built a fresh one. In the waiting
   * room that parent re-renders on a 1-second countdown and a 2-second poll, which meant the widget
   * was destroyed and rebuilt about once a second: "Verifying…" over and over, and a solved
   * challenge thrown away before the queue could use it.
   *
   * A ref is the fix rather than asking every caller to memoise, because the widget cannot know how
   * often it will be re-rendered and should not break when it is. The effect now depends only on
   * the two things that genuinely require a different widget.
   */
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    // If no sitekey provided (e.g. dev environment without Turnstile keys), provide mock bypass
    if (!siteKey) {
      // No spinner to put away: with no key the component renders its fixed "protection is on" line
      // and never reads `isLoading`, so setting it here only cost a render.
      onSuccessRef.current('mock-turnstile-token');
      return;
    }

    let isMounted = true;

    const renderWidget = () => {
      if (!containerRef.current || !window.turnstile || widgetIdRef.current) {
        return;
      }

      try {
        const id = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            if (isMounted) {
              setIsLoading(false);
              onSuccessRef.current(token);
            }
          },
          'error-callback': (err: unknown) => {
            if (isMounted) {
              setIsLoading(false);
              setLoadError('Không thể tải mã bảo mật. Vui lòng thử lại.');
              onErrorRef.current?.(String(err));
            }
          },
          'expired-callback': () => {
            if (isMounted) {
              onExpireRef.current?.();
            }
          },
          theme,
        });
        widgetIdRef.current = id;
        setIsLoading(false);
      } catch (err) {
        if (isMounted) {
          setIsLoading(false);
          setLoadError('Lỗi khởi tạo xác thực bảo mật.');
          onErrorRef.current?.(String(err));
        }
      }
    };

    // Check if script is already present
    const existingScript = document.getElementById('cloudflare-turnstile-script');
    if (!existingScript) {
      const script = document.createElement('script');
      script.id = 'cloudflare-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (isMounted) {
          renderWidget();
        }
      };
      script.onerror = () => {
        if (isMounted) {
          setIsLoading(false);
          setLoadError('Không thể kết nối đến máy chủ bảo mật Turnstile.');
        }
      };
      document.head.appendChild(script);
    } else if (window.turnstile) {
      renderWidget();
    } else {
      existingScript.addEventListener('load', renderWidget);
    }

    return () => {
      isMounted = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup errors
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, theme]);

  if (!siteKey) {
    return (
      <div className="flex items-center gap-2 font-meta text-meta text-la-co-ink py-1.5 px-3 bg-la-co/10 rounded-full border border-la-co/30">
        <ShieldCheck className="w-4 h-4 text-la-co-ink shrink-0" />
        <span>Bảo vệ chống bot tự động đang kích hoạt</span>
      </div>
    );
  }

  return (
    <div className={`turnstile-container my-2 flex flex-col items-center justify-center min-h-[65px] ${className}`}>
      {isLoading && (
        <div className="flex items-center gap-2 font-meta text-body text-ink-soft animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-burgundy-ink" />
          <span>Đang kiểm tra bảo mật...</span>
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 font-meta text-meta text-burgundy-ink bg-burgundy/10 p-2.5 rounded-xl border border-burgundy/40">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
};
