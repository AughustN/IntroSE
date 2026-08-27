/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AD_POLICY,
  type ActiveAdPlacement,
  type AdPackage,
  type AdPurchase,
  type AdFeed,
  type AdMetricKind,
} from "@shared/ads/types.js";
import { withAuthRetry } from "./authClient";
import { apiUrl } from "./api";

/**
 * Advertising packages, from both sides of the counter.
 *
 * The two reads the landing page needs (`packages`, `placements`) are public and go out without a
 * token; the organizer's own campaigns need one. They share a file because they share a vocabulary
 * — splitting them would mean two modules that must agree on the same shapes.
 */

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? "ads_request_failed");
  return body;
}

/** Public: no token, no retry — a signed-out visitor must still be able to read these. */
async function open<T>(path: string): Promise<T> {
  return parse<T>(await fetch(apiUrl(path), { credentials: "include" }));
}

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const send = (token: string | null) =>
    fetch(apiUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });
  return parse<T>(await withAuthRetry(send));
}

export const adsClient = {
  delivery: async (signal?: AbortSignal) =>
    parse<AdFeed>(
      await fetch(apiUrl("/api/ads/delivery"), { method: "POST", credentials: "include", signal }),
    ),
  metric: async (token: string, kind: AdMetricKind) => {
    const response = await fetch(apiUrl("/api/ads/metrics"), {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, kind }),
    });
    if (!response.ok) throw new Error("ad_metric_failed");
  },
  /** The price list. Public — deciding whether to promote should not require signing in first. */
  packages: () => open<AdPackage[]>("/api/ads/packages"),
  /** What the landing page may render right now. */
  placements: () => open<ActiveAdPlacement[]>("/api/ads/placements"),

  purchases: () => authed<AdPurchase[]>("/api/organizer/ads/purchases"),
  buy: (eventId: number, packageId: number) =>
    authed<AdPurchase>("/api/organizer/ads/purchases", {
      method: "POST",
      body: JSON.stringify({ eventId, packageId, acceptedPolicy: AD_POLICY }),
    }),
};
