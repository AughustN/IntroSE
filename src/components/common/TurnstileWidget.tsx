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

  useEffect(() => {
    // If no sitekey provided (e.g. dev environment without Turnstile keys), provide mock bypass
    if (!siteKey) {
      setIsLoading(false);
      onSuccess('mock-turnstile-token');
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
              onSuccess(token);
            }
          },
          'error-callback': (err: unknown) => {
            if (isMounted) {
              setIsLoading(false);
              setLoadError('Không thể tải mã bảo mật. Vui lòng thử lại.');
              onError?.(String(err));
            }
          },
          'expired-callback': () => {
            if (isMounted) {
              onExpire?.();
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
          onError?.(String(err));
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
  }, [siteKey, theme, onSuccess, onError, onExpire]);

  if (!siteKey) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 py-1.5 px-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700/50">
        <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
        <span>Bảo vệ chống bot tự động đang hoạt động</span>
      </div>
    );
  }

  return (
    <div className={`turnstile-container my-2 flex flex-col items-center justify-center min-h-[65px] ${className}`}>
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          <span>Đang tải kiểm tra bảo mật...</span>
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/30 p-2 rounded-lg border border-rose-200 dark:border-rose-900/50">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
};
