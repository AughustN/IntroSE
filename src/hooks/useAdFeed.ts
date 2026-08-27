import { useEffect, useState } from "react";
import { AD_REFRESH_MS, type AdFeed } from "@shared/ads/types.js";
import { adsClient } from "../services/adsClient";

const EMPTY: AdFeed = { legacy: [], deliveries: [] };
/** Only the home page allocates ads; hidden tabs neither rotate nor spend delivery turns. */
export function useAdFeed(enabled: boolean): AdFeed {
  const [feed, setFeed] = useState<AdFeed>(EMPTY);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  // A new home-page visit starts empty, rather than resurrecting receipts whose expiry timer
  // was cleaned up on navigation. React restarts this render before committing its children.
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setFeed(EMPTY);
  }
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pending = false;
    let last = 0;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (document.hidden || pending || Date.now() - last < AD_REFRESH_MS) return;
      pending = true;
      last = Date.now();
      try {
        const next = await adsClient.delivery(controller.signal);
        if (stopped) return;
        setFeed(next);
        clearTimeout(expiry);
        const expires = Math.min(
          Date.now() + 90_000,
          ...next.deliveries.map((d) => Date.parse(d.expiresAt)),
        );
        expiry = setTimeout(() => setFeed(EMPTY), Math.max(0, expires - Date.now()));
      } catch {
        // Editorial content stays available. Expiry removes stale ads even during an outage.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), AD_REFRESH_MS);
    const resume = () => {
      void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(expiry);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled]);
  return enabled ? feed : EMPTY;
}
