/**
 * Advertising packages sold to organizers.
 *
 * An organizer buys a package to promote one of their events on the landing page. A package is a
 * COMBO of placements plus a run length — the placements are the slots the landing page already
 * has, so nothing here describes a position that renders nowhere.
 */

/** Where a bought placement actually shows up on the landing page. */
export type AdPlacement = "hero_trailer" | "hot_events";

/** What each placement is called, and what it promises, in the words the organizer reads. */
export const AD_PLACEMENT_LABELS: Record<AdPlacement, string> = {
  hero_trailer: "Chiếu trailer đầu trang chủ",
  hot_events: "Xuất hiện tại mục “Sự kiện hot”",
};

export interface AdPackage {
  id: number;
  code: string;
  name: string;
  description: string | null;
  /** Whole VND đồng, as everywhere else. */
  price: number;
  durationDays: number;
  placements: AdPlacement[];
}

/** A campaign an organizer has paid for. */
export interface AdPurchase {
  id: number;
  eventId: number;
  eventTitle: string;
  eventSlug: string;
  packageCode: string;
  packageName: string;
  /** What was paid, snapshotted at purchase — not what the package costs today. */
  price: number;
  placements: AdPlacement[];
  status: "active" | "cancelled";
  startsAt: string;
  endsAt: string;
  createdAt: string;
  /** Running right now: active, started, and not yet finished. Computed by the server. */
  live: boolean;
  /** Actually eligible for display; a paid window continues while its event is hidden. */
  serving: boolean;
}

export interface AdPurchaseInput {
  eventId: number;
  packageId: number;
}

/**
 * One event currently entitled to a placement, for the landing page to render.
 *
 * Public and deliberately thin: it says which event holds which slot and nothing about who paid or
 * what they paid, because that is the organizer's business and this endpoint has no auth.
 */
export interface ActiveAdPlacement {
  eventId: number;
  slug: string;
  placements: AdPlacement[];
}

/* ── The admin console's read model ─────────────────────────────────────────────────────────── */

/**
 * One week of advertising sales.
 *
 * Weeks, not days, because of how this money arrives: a handful of packages a month, each worth
 * millions. Plotted daily the series is a flat line with three spikes in it, which says less about
 * the trend than the same figures bucketed — and the trend is the only reason to draw a line rather
 * than print the total.
 */
export interface AdWeekPoint {
  /** Monday of the week, `YYYY-MM-DD`. */
  weekStart: string;
  /** Sunday of the same week — carried so the tooltip can name the range it is summing. */
  weekEnd: string;
  amount: number;
  purchases: number;
}

export interface AdPackageSales {
  code: string;
  name: string;
  purchases: number;
  revenue: number;
}

export interface AdCampaignRow {
  id: number;
  eventTitle: string;
  organizer: string;
  packageName: string;
  price: number;
  placements: AdPlacement[];
  status: "active" | "cancelled";
  startsAt: string;
  endsAt: string;
  live: boolean;
}

export interface AdAnalytics {
  /** Ad money in the last 30 days, and in the 30 before it, for a movement figure. */
  revenue30d: number;
  revenuePrev30d: number;
  purchases30d: number;
  /** Campaigns rendering on the landing page right now. */
  liveCampaigns: number;
  /** The last 12 weeks, including the ones nobody bought anything in. */
  byWeek: AdWeekPoint[];
  byPackage: AdPackageSales[];
  campaigns: AdCampaignRow[];
}
