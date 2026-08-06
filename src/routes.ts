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
  | "detail"
  | "seats"
  | "checkout"
  | "ticket"
  | "history"
  | "wallet"
  | "admin"
  | "organizer"
  | "moderation";

export interface Route {
  screen: Screen;
  /** From `/events/:eventSlug…`. The same string `MovieEvent.id` carries — the catalog slug. */
  eventSlug?: string;
  /** From `/tickets/:bookingId`. */
  bookingId?: string;
  /** From `/organizer/events/:id` — which event the organizer console has open (feature 006). */
  organizerEventId?: number;
}

/** Screens whose URL carries no parameter. Order is irrelevant; lookup goes both ways. */
const STATIC_PATHS: ReadonlyArray<readonly [Screen, string]> = [
  ["home", "/"],
  ["checkout", "/checkout"],
  ["history", "/bookings"],
  ["wallet", "/wallet"],
  ["admin", "/admin"],
  ["organizer", "/organizer"],
  ["moderation", "/moderation"],
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
  params: {
    eventSlug?: string | null;
    bookingId?: string | null;
    organizerEventId?: number | null;
  } = {},
): string {
  switch (screen) {
    case "organizer":
      // The console's second level is linkable; the list is the bare path (feature 006, FR-039).
      return params.organizerEventId
        ? `/organizer/events/${params.organizerEventId}`
        : "/organizer";
    case "detail":
      return params.eventSlug ? `/events/${encodeURIComponent(params.eventSlug)}` : "/";
    case "seats":
      return params.eventSlug ? `/events/${encodeURIComponent(params.eventSlug)}/seats` : "/";
    case "ticket":
      return params.bookingId ? `/tickets/${encodeURIComponent(params.bookingId)}` : "/bookings";
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

  // `/organizer/events/:id` — one event open in the console. A non-numeric id is not a route, so it
  // falls through to null and the caller sends it home rather than opening a nonsense event.
  if (segments[0] === "organizer" && segments[1] === "events" && segments.length === 3) {
    const id = Number(segments[2]);
    if (Number.isInteger(id) && id > 0) return { screen: "organizer", organizerEventId: id };
  }

  return null;
}
