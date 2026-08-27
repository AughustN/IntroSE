import { useEffect, type RefObject } from "react";
import type { AdDelivery, AdMetricKind } from "@shared/ads/types.js";
import { adsClient } from "../services/adsClient";

const sent = new Map<string, number>();
export function trackAd(delivery: AdDelivery | undefined, kind: AdMetricKind): void {
  if (!delivery || document.hidden || Date.parse(delivery.expiresAt) <= Date.now()) return;
  for (const [key, expires] of sent) if (expires <= Date.now()) sent.delete(key);
  const key = `${delivery.token}:${kind}`;
  if (sent.has(key)) return;
  sent.set(key, Date.parse(delivery.expiresAt));
  // Best effort, at most one attempt per receipt. A metrics outage must not trigger a retry storm.
  void adsClient.metric(delivery.token, kind).catch(() => {});
}

/** At least 50% of the creative for one continuous foreground second.
 * The hero observes its screen, not the two-viewport outer scroll section.
 * Repeated marquee clones share a receipt, so they cannot inflate totals.
 */
export function useAdExposure(
  ref: RefObject<HTMLElement | null>,
  delivery?: AdDelivery,
  video?: RefObject<HTMLVideoElement | null>,
) {
  useEffect(() => {
    const element = ref.current;
    if (!delivery || !element || typeof IntersectionObserver === "undefined") return;
    let visible = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!visible || document.hidden) return;
      timer = setInterval(() => {
        trackAd(delivery, "impression");
        if (video?.current && !video.current.paused && video.current.readyState >= 2)
          trackAd(delivery, "play");
      }, 1000);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
        sync();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ref, delivery, video]);
}
