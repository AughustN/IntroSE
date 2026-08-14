/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";

/**
 * Load something, and be honest about the three states it can be in.
 *
 * Every screen in the console fetches, and each one used to spell out the same four `useState`
 * calls — which is how "empty" and "still loading" ended up rendering identically on some of them.
 * A reader cannot tell an empty queue from a broken request, so both are tracked here and the
 * screens say which one it is.
 *
 * **`key`, not a dependency array.** The loader is a closure that is rebuilt on every render, so it
 * can never be a dependency; what actually decides "this is a different request" is the filter, the
 * page number, the chosen event — a value the caller can name. Passing that value as a string keeps
 * the effect's dependencies literal and keeps the decision where the knowledge is.
 *
 * The result of a superseded request is dropped: switching screens twice quickly used to let the
 * first response land after the second and overwrite it.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  key: string,
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  /*
   * `load` is deliberately absent from the dependencies.
   *
   * It is a closure rebuilt on every render, so depending on it would re-fetch on every keystroke
   * anywhere in the screen. The effect body still closes over the *newest* one — React runs the
   * callback from the render in which the deps last changed — so the request that goes out matches
   * the key that triggered it.
   */
  useEffect(() => {
    let live = true;
    /*
     * Flipping to "loading" *is* the synchronisation this effect performs: the key changed, so what
     * is on screen no longer describes what was asked for. The lint rule guards against cascading
     * renders from effects that derive state; the alternative here is showing the previous filter's
     * numbers while the new ones are in flight, which is the bug the rule cannot see.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    load()
      .then((next) => {
        if (live) setData(next);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { data, error, loading, reload: () => setNonce((value) => value + 1) };
}
