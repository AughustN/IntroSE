/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";

/**
 * Ticks once a second and returns the milliseconds left until `expiresAt`, calling `onExpire`
 * exactly once when it runs out.
 *
 * Deliberately derived from an absolute instant rather than a counter that counts itself down: a
 * counter restarts whenever its component remounts (which is what lost the hold when the buyer
 * stepped back from checkout) and drifts whenever the tab is backgrounded. This recomputes from the
 * clock on every tick, so navigating between the flow screens changes nothing.
 */
export function useHoldCountdown(expiresAt: number | null, onExpire: () => void): number {
  const [remaining, setRemaining] = useState(() =>
    expiresAt ? Math.max(expiresAt - Date.now(), 0) : 0,
  );

  // Keep the latest callback without making it a dependency — re-running the interval on every
  // render would reset the tick.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }

    let fired = false;
    const tick = () => {
      const left = Math.max(expiresAt - Date.now(), 0);
      setRemaining(left);
      if (left === 0 && !fired) {
        fired = true;
        onExpireRef.current();
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}
