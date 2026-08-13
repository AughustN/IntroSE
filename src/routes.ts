/**
 * The URL vocabulary of the app.
 *
 * `App` keeps its screen state machine — this module is only the translation layer between a
 * `Screen` and the address bar, so every page is linkable, bookmarkable and survives Back.
 *
 * Two kinds of path live here:
 *
 *  - **Screen paths** map 1:1 onto `Screen`. Exactly one is showing at a time.
 *  - **Overlay paths** (`/account`, `/reset-password`, `/vnpay-return`) render *over* whatever
 *    screen is mounted. While one is on the address bar it owns the URL, so the screen ↔ URL
 *    mirroring in `App` stands down rather than fighting it back to the screen path.
 */

export type Screen =
  | "home"
  /** The catalog on its own, without the landing hero in front of it. */
  | "browse"
  | "detail"
  | "seats"
  | "checkout"
  | "ticket"
  | "history"
  /** The events this account has bookmarked — the hearts, on a page of their own. */
  | "saved"
  | "wallet"
  | "admin"
  | "organizer"
  | "organizer-events"
  | "organizer-event-detail"
  | "moderation"
  | "about-us"
  | "terms-of-service"
  | "website-terms"
  | "refund-policy";

export interface Route {
  screen: Screen;
  /** From `/events/:eventSlug…`. The same string `MovieEvent.id` carries — the catalog slug. */
  eventSlug?: string;
  /** From `/tickets/:bookingId`. */
  bookingId?: string;
  /** From `/organizer/events/:eventId`. */
  organizerEventId?: string;
}

/** Screens whose URL carries no parameter. Order is irrelevant; lookup goes both ways. */
const STATIC_PATHS: ReadonlyArray<readonly [Screen, string]> = [
  ["home", "/"],
  /*
   * `/events` is matched here, before the `events/:slug` branch below. That branch needs a second
   * segment, so the bare path can never be mistaken for an event whose slug went missing.
   */
  ["browse", "/events"],
  ["checkout", "/checkout"],
  ["history", "/bookings"],
  ["saved", "/saved"],
  ["wallet", "/wallet"],
  ["admin", "/admin"],
  ["organizer", "/organizer"],
  ["organizer-events", "/organizer/events"],
  ["moderation", "/moderation"],
  ["about-us", "/about-us"],
  ["terms-of-service", "/terms-of-service"],
  ["website-terms", "/website-terms"],
  ["refund-policy", "/refund-policy"],
];

export const ACCOUNT_PATH = "/account";
export const RESET_PASSWORD_PATH = "/reset-password";
export const VNPAY_RETURN_PATH = "/vnpay-return";

/**
 * `VNPAY_RETURN_PATH` must stay in step with `VNPAY_RETURN_URL` in the server env — VNPay sends the
 * browser to whatever that says, and a mismatch lands the buyer on a 404 instead of the polling
 * screen. Same for `RESET_PASSWORD_PATH` and the link the reset mail builds.
 */
const OVERLAY_PATHS: readonly string[] = [ACCOUNT_PATH, RESET_PASSWORD_PATH, VNPAY_RETURN_PATH];

/** Trailing slashes and empty paths are the same page as the canonical form. */
function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function isOverlayPath(pathname: string): boolean {
  return OVERLAY_PATHS.includes(normalize(pathname));
}

/**
 * Where a screen lives. `ticket` and the two event screens need a parameter; without it there is no
 * honest URL to produce, so they fall back to the closest page that exists rather than inventing
 * `/events/undefined`.
 */
export function screenToPath(
  screen: Screen,
  params: { eventSlug?: string | null; bookingId?: string | null; organizerEventId?: string | null } = {},
): string {
  switch (screen) {
    case "detail":
      return params.eventSlug ? `/events/${encodeURIComponent(params.eventSlug)}` : "/";
    case "seats":
      return params.eventSlug ? `/events/${encodeURIComponent(params.eventSlug)}/seats` : "/";
    case "ticket":
      return params.bookingId ? `/tickets/${encodeURIComponent(params.bookingId)}` : "/bookings";
    case "organizer-event-detail":
      return params.organizerEventId ? `/organizer/events/${encodeURIComponent(params.organizerEventId)}` : "/organizer/events";
    default: {
      const match = STATIC_PATHS.find(([candidate]) => candidate === screen);
      return match ? match[1] : "/";
    }
  }
}

/** The reverse. `null` means the path belongs to no screen — the caller decides (404 → home). */
export function pathToRoute(pathname: string): Route | null {
  const path = normalize(pathname);

  const staticMatch = STATIC_PATHS.find(([, candidate]) => candidate === path);
  if (staticMatch) return { screen: staticMatch[0] };

  let segments: string[];
  try {
    segments = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    // A malformed percent-escape is not a route; treat it as unknown rather than throwing here.
    return null;
  }

  if (segments[0] === "events" && segments[1]) {
    if (segments.length === 2) return { screen: "detail", eventSlug: segments[1] };
    if (segments.length === 3 && segments[2] === "seats") {
      return { screen: "seats", eventSlug: segments[1] };
    }
  }

  if (segments[0] === "tickets" && segments[1] && segments.length === 2) {
    return { screen: "ticket", bookingId: segments[1] };
  }

  if (segments[0] === "organizer") {
    if (segments.length === 1) return { screen: "organizer" };
    if (segments.length === 2 && segments[1] === "events") return { screen: "organizer" };
    if (segments.length === 2) return { screen: "organizer-event-detail", organizerEventId: segments[1] };
    if (segments.length === 3 && segments[1] === "events") return { screen: "organizer-event-detail", organizerEventId: segments[2] };
  }

  return null;
}

