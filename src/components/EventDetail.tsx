/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { UNKNOWN_CITY, type Showtime } from "@/shared/catalog/types";
import { MovieEvent, TicketTier } from "../types";
import ReviewPreview from "./reviews/ReviewPreview";
import { catalogClient } from "../services/catalogClient";
import { formatEventDate } from "../services/formatDate";
import { watchShowtime } from "../services/seatSocket";
import { ChevronLeft, ChevronRight, Clock3, Heart, Tag, Ticket, Users } from "lucide-react";
import { addDays, todayISO, weekDays, weekRange } from "../services/dateFilter";
import Disclosure from "./Disclosure";
import TrailerPanel, { playableTrailer } from "./TrailerPanel";
import Select from "./Select";
import {
  BookingHeader,
  BookingLayout,
  BookingSection,
  OrderSummary,
  type SummaryDetail,
  type SummaryHighlight,
  type SummaryLine,
} from "./booking/BookingChrome";
import { chainLabel, OTHER_VENUES } from "../services/cinema";
import { formatVnd } from "../services/currency";
import { aiClient } from "../services/aiClient";
import { WaitlistError, waitlistClient, type WaitlistEntry } from "../services/waitlistClient";
import WaitlistControl from "./WaitlistControl";
import ReportDialog from "./reviews/ReportDialog";
import { Flag } from "lucide-react";

export interface TierSelection {
  tierId: string;
  label: string;
  price: number;
  quantity: number;
}

interface EventDetailProps {
  event: MovieEvent;
  /** Real showtimes for this event. Empty while the detail request is still in flight. */
  showtimes: Showtime[];
  /** Guests browse and choose freely; only the hand-off to checkout asks them to sign in. */
  isSignedIn: boolean;
  relatedEvents: MovieEvent[];
  wishlistedIds: string[];
  onBack: () => void;
  /** Opens this event's own comments page, `/events/:slug/reviews`. */
  onOpenReviews: () => void;
  onToggleWishlist: (eventId: string) => void;
  onBookRelated: (event: MovieEvent) => void;
  /** Seated events: hand off to the seat picker. */
  onProceedToSeatSelection: (showtimeId: number | null, date: string, time: string) => void;
  /** General admission: the tickets are already held, so this is a plain step forward. */
  onProceedToCheckout: () => void;
  /**
   * What the buyer currently holds, per tier id. General admission only.
   *
   * The server's number, not this screen's. A stepper press is a hold, so the count on screen has
   * to be the count the reservation actually carries — local state would drift the moment a press
   * was refused for want of stock.
   */
  heldQuantities: Record<string, number>;
  /** A stepper press. The parent places or releases the hold and the new count comes back above. */
  onAdjustQuantity: (
    tier: { id: string; label: string },
    delta: number,
    showtimeId: number | null,
    date: string,
    time: string,
  ) => void;
  /** A hold round trip is in flight; the steppers are inert so two presses cannot race. */
  holdBusy: boolean;
  /**
   * Run something only for a signed-in reader, asking them to sign in first if they are not.
   *
   * The waitlist needs it because a place in a queue belongs to an account — unlike browsing, and
   * unlike the steppers, which hold against a session the parent already established.
   */
  onRequireSignIn: (action: () => void) => void;
  /** Something worth saying out loud — a refused join, a place taken, a place given up. */
  onNotice: (tone: "ok" | "error", message: string) => void;
  /** Milliseconds left on the general-admission hold this screen now owns. */
  holdRemainingMs: number;
}

const statusLabels: Record<MovieEvent["status"], string> = {
  available: "Còn vé",
  sold_out: "Hết vé",
  finished: "Đã diễn",
  cancelled: "Đã hủy",
};

/**
 * One bookable slot. Built from a real showtime when the API has answered, so date and time always
 * belong to the same session — the previous two-grid layout let a visitor combine a date with a
 * time that no showtime actually offered.
 */
interface Slot {
  key: string;
  showtimeId: number | null;
  date: string;
  time: string;
  /** Full instant, kept beside the split date/time because the waitlist cutoff is measured on it. */
  startsAt: string;
  venue: string;
  /** Province, and the chain read off the venue name — the two tiers above the cinema in the filter. */
  city: string;
  chain: string;
  soldOut: boolean;
}

/**
 * How near the start the queue closes, mirroring the server's `WAITLIST_CUTOFF_HOURS`.
 *
 * Duplicated deliberately and in one place: the server is the authority and refuses the join with
 * `waitlist_closed`, but a button that can only ever fail should not be offered in the first place.
 */
const WAITLIST_CUTOFF_HOURS = 24;

const MAX_PER_TIER = 10;
const MAX_TIERS = 4;

/** The day strip's column headers. Monday-first, matching `weekDays`. */
const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

/**
 * Up to this many dates are drawn as themselves; past it the strip becomes a week calendar.
 *
 * Seven because that is one row of the same grid: at the threshold both layouts occupy exactly one
 * line, so crossing it changes what the row means without changing how much room it takes.
 */
const MAX_FLAT_DATES = 7;

export default function EventDetail({
  event,
  showtimes,
  isSignedIn,
  relatedEvents,
  wishlistedIds,
  onBack,
  onOpenReviews,
  onToggleWishlist,
  onBookRelated,
  onProceedToSeatSelection,
  onProceedToCheckout,
  heldQuantities,
  onAdjustQuantity,
  holdBusy,
  holdRemainingMs,
  onRequireSignIn,
  onNotice,
}: EventDetailProps) {
  const isSeated = event.eventType === "seated";

  useEffect(() => {
    if (isSignedIn) void aiClient.recordView(event.id).catch(() => {});
  }, [event.id, isSignedIn]);

  /**
   * The tiers of the selected showtime, with their real `ticket_tiers.id`.
   *
   * `event.ticketTiers` cannot be used to buy with: the event detail groups tiers by label across
   * every showtime, so it has no single row to point at and numbers them by array position instead.
   * Sending that index as `ticketTierId` reserved nothing — the first tier came out as 0, which the
   * hold API rejects outright. It is also why live "Còn N vé" never updated: the socket reports the
   * real id, which matched none of the synthetic ones.
   *
   * The summary still drives the display before a showtime is picked, since prices are what the
   * buyer is comparing at that point.
   */
  const [showtimeTiers, setShowtimeTiers] = useState<TicketTier[] | null>(null);

  // An event carries at most 4 ticket tiers (enforced server-side); slice defensively so a bad
  // payload can never break the even 1–4 column layout below.
  const tiers = useMemo(
    () => (showtimeTiers ?? event.ticketTiers).slice(0, MAX_TIERS),
    [showtimeTiers, event.ticketTiers],
  );
  const slots = useMemo<Slot[]>(() => {
    if (showtimes.length > 0) {
      return showtimes.map((s) => ({
        key: String(s.id),
        showtimeId: s.id,
        date: s.startsAt.slice(0, 10),
        time: s.startsAt.slice(11, 16),
        startsAt: s.startsAt,
        venue: s.venue.name,
        city: s.venue.city,
        // The chain the venue is actually linked to (migration 0036), not one guessed from its
        // name. `chainLabel` still names the bucket for a venue no chain operates, which is most of
        // the estate — a concert hall belongs in the filter, just not under a brand.
        chain: s.venue.chain?.name ?? OTHER_VENUES,
        soldOut: s.availability !== "available",
      }));
    }
    // Fallback for the pre-API placeholder event: pair each date with each listed time.
    return event.dates.flatMap((date) =>
      event.times.map((time) => ({
        key: `${date}T${time}`,
        showtimeId: null,
        date,
        time,
        startsAt: `${date}T${time}`,
        venue: event.venueName,
        city: event.location,
        chain: chainLabel(event.venueName),
        soldOut: false,
      })),
    );
  }, [showtimes, event.dates, event.times, event.venueName, event.location]);

  /*
   * Where, before when.
   *
   * A film in cinemas plays 2,000 sessions across eight provinces, so the day strip and the time
   * grid are answering a question nobody asked until the place is settled — "19:00 at which of the
   * forty-four cinemas" is not a choice, it is a list. The three tiers narrow it the way a person
   * actually decides: province, then chain, then the cinema itself.
   *
   * Cascading, so a lower tier can never contradict a higher one: pick a province and the chain
   * list holds only chains present in it. Changing a tier clears the ones below rather than leaving
   * a stale cinema selected in a city it is not in.
   */
  const [placeFilter, setPlaceFilter] = useState({ city: "", chain: "", venue: "" });

  const byCity = useMemo(
    () => (placeFilter.city ? slots.filter((slot) => slot.city === placeFilter.city) : slots),
    [slots, placeFilter.city],
  );
  const byChain = useMemo(
    () => (placeFilter.chain ? byCity.filter((slot) => slot.chain === placeFilter.chain) : byCity),
    [byCity, placeFilter.chain],
  );
  /** Everything downstream — the day strip, the counts, the time grid — reads this, not `slots`. */
  const visibleSlots = useMemo(
    () =>
      placeFilter.venue ? byChain.filter((slot) => slot.venue === placeFilter.venue) : byChain,
    [byChain, placeFilter.venue],
  );

  /**
   * Options for each tier, each drawn from what the tier above it has already allowed.
   *
   * `last` sinks the two catch-alls — the venues no chain operates, and the venues whose address
   * never named a province — to the bottom of their list however many showtimes they hold. Neither
   * names a place, so a reader scanning for theirs can stop before them; the same rule the category
   * filter applies to "Khác".
   */
  const options = useMemo(() => {
    const uniq = (values: string[], last?: string) =>
      [...new Set(values)].filter(Boolean).sort((a, b) => {
        if (last && (a === last) !== (b === last)) return a === last ? 1 : -1;
        return a.localeCompare(b, "vi");
      });
    return {
      cities: uniq(slots.map((slot) => slot.city), UNKNOWN_CITY),
      chains: uniq(byCity.map((slot) => slot.chain), OTHER_VENUES),
      venues: uniq(byChain.map((slot) => slot.venue)),
    };
  }, [slots, byCity, byChain]);

  /*
   * Offered only when there is something to narrow.
   *
   * One venue is the ordinary case for a concert, and three dropdowns over a single cinema is three
   * controls that can only ever return what is already on screen.
   */
  const showPlaceFilter = options.cities.length > 1 || options.venues.length > 1;

  const [selectedSlotKey, setSelectedSlotKey] = useState<string>("");

  /*
   * There is no local quantity any more.
   *
   * The steppers hold on the server as they are pressed, so the reservation is the only place the
   * number lives. Mirroring it into state here would give two answers to "how many" that disagree
   * for as long as a request is in flight, and disagree permanently when one is refused.
   */
  const quantities = heldQuantities;

  /*
   * Nothing to restore any more.
   *
   * This screen used to be handed the live hold so a buyer stepping back from checkout found their
   * showtime and quantities as they left them. Backward is a cancel now: by the time this renders,
   * the hold has been released and there is nothing to come back to. All that is left is landing on
   * a sensible showtime the first time the list arrives.
   */
  useEffect(() => {
    /*
     * Re-picks whenever the held key names nothing in the list, not only when it is empty.
     *
     * `slots` is built twice: once from `event.dates` × `event.times` while the detail request is
     * in flight, keyed `2026-08-11T21:30`, and again from the real showtimes, keyed by their
     * database id. Guarding on "is a key set at all" meant the placeholder's key survived the
     * swap and matched no real slot — the date chip lit up from its own fallback while the time
     * grid showed nothing selected and the panel read "Chưa chọn suất" over a list of one showtime.
     */
    if (visibleSlots.some((slot) => slot.key === selectedSlotKey)) return;
    const firstOpen = visibleSlots.find((slot) => !slot.soldOut) ?? visibleSlots[0];
    setSelectedSlotKey(firstOpen?.key ?? "");
  }, [visibleSlots, selectedSlotKey]);

  /** Null unless the stored link is something a `<video>` can play — see `playableTrailer`. */
  const trailer = playableTrailer(event.trailerUrl);

  const selectedSlot = slots.find((s) => s.key === selectedSlotKey) ?? null;
  // `finished` joins the other two: the event is still readable, but nothing on it is buyable.
  const eventUnavailable =
    event.status === "sold_out" || event.status === "finished" || event.status === "cancelled";
  /**
   * Over for good, as opposed to merely out of stock.
   *
   * The distinction is what the waitlist turns on. "Sold out" is the *reason a queue exists*; a
   * cancelled or finished event has nothing to wait for, and no release can ever come.
   */
  const eventClosed = event.status === "finished" || event.status === "cancelled";

  /**
   * Live tier availability for the selected showtime (US3): when anyone reserves or releases a
   * general-admission quantity, "Còn N vé" follows within about a second. Advisory only — the server
   * still refuses an over-reservation regardless of what this shows (FR-023).
   */
  const [liveRemaining, setLiveRemaining] = useState<Record<string, number | null>>({});

  // Load the real tiers as soon as a general-admission showtime is chosen — the quantity steppers
  // must be bound to ids the hold API accepts, not to the detail summary's positions.
  useEffect(() => {
    const showtimeId = selectedSlot?.showtimeId;
    if (isSeated || !showtimeId) {
      setShowtimeTiers(null);
      return;
    }
    let cancelled = false;
    catalogClient
      .getSeatMap(showtimeId)
      .then((map) => {
        if (cancelled) return;
        setShowtimeTiers(
          (map.tiers ?? []).map((tier) => ({
            id: String(tier.id),
            label: tier.label,
            price: tier.price,
            remaining: tier.remaining,
            // The seat map carries no copy; reuse the summary's blurb for the same tier so the
            // cards do not lose their description the moment a showtime is picked.
            description:
              event.ticketTiers.find((summary) => summary.label === tier.label)?.description ?? "",
          })),
        );
      })
      .catch(() => {
        // Keep showing the summary rather than an empty picker; the buy button stays disabled
        // because nothing can be selected without a tier the server knows.
        if (!cancelled) setShowtimeTiers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSeated, selectedSlot?.showtimeId, event.ticketTiers]);

  useEffect(() => {
    setLiveRemaining({});
    const showtimeId = selectedSlot?.showtimeId;
    if (isSeated || !showtimeId) return;
    return watchShowtime(showtimeId, (update) => {
      if (!update.tier) return;
      setLiveRemaining((current) => ({
        ...current,
        [String(update.tier!.ticketTierId)]: update.tier!.remaining,
      }));
    });
  }, [isSeated, selectedSlot?.showtimeId]);

  const selection = useMemo<TierSelection[]>(
    () =>
      tiers
        .map((tier) => ({
          tierId: tier.id,
          label: tier.label,
          price: tier.price,
          quantity: quantities[tier.id] ?? 0,
        }))
        .filter((line) => line.quantity > 0),
    [tiers, quantities],
  );

  const totalQuantity = selection.reduce((sum, line) => sum + line.quantity, 0);
  const totalPrice = selection.reduce((sum, line) => sum + line.quantity * line.price, 0);

  const bookingDisabled =
    eventUnavailable || !selectedSlot || selectedSlot.soldOut || (!isSeated && totalQuantity === 0);

  const isWishlisted = wishlistedIds.includes(event.id);

  /** What a tier has left right now: the live number if the channel has sent one, else the fetched one. */
  const remainingOf = (tier: MovieEvent["ticketTiers"][number]): number | null | undefined =>
    tier.id in liveRemaining ? liveRemaining[tier.id] : tier.remaining;

  const tierCap = (tier: MovieEvent["ticketTiers"][number]) => {
    const remaining = remainingOf(tier);
    return remaining === null || remaining === undefined
      ? MAX_PER_TIER
      : Math.min(remaining, MAX_PER_TIER);
  };

  const adjustQuantity = (tier: TicketTier, delta: number) => {
    if (!selectedSlot) return;
    onAdjustQuantity(
      { id: tier.id, label: tier.label },
      delta,
      selectedSlot.showtimeId,
      selectedSlot.date,
      selectedSlot.time,
    );
  };

  /*
   * ── The waitlist (UC-17) ──────────────────────────────────────────────────────────────────
   *
   * The reader's own places in this showtime's queues, keyed the way the server scopes them: a
   * tier id, or `any` for the queue that covers the whole showtime. Loaded once per showtime and
   * per session, because a place is an account's, so a signed-out reader has none to load.
   */
  /*
   * Carries the showtime it was loaded for, rather than being emptied when the reader moves to
   * another one. Clearing it would mean writing state from inside the effect that loads it, and a
   * stale map read through `entryFor` below is indistinguishable from an empty one anyway.
   */
  const [myWaitlist, setMyWaitlist] = useState<{
    showtimeId: number | null;
    entries: Record<string, WaitlistEntry>;
  }>({ showtimeId: null, entries: {} });
  const [waitlistBusy, setWaitlistBusy] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const waitlistKey = (tierId: number | null) => (tierId === null ? "any" : String(tierId));

  /*
   * Inside the cutoff there is nothing left to wait for: no ticket of this showtime can be
   * cancelled any more, so no ticket can come back. The server closes the queues at the same hour
   * and refuses joins with `waitlist_closed`; this only keeps the page from offering a door that
   * is already shut.
   */
  const waitlistClosed = useMemo(() => {
    if (!selectedSlot) return false;
    // Reading the clock is impure, which the lint rule is right about in general — but "is this
    // showtime within 24 hours" is a question about *now*, and the answer only has to be fresh
    // when the reader picks a showtime. Memoised on that, so it is read once per choice rather
    // than once per render.
    // eslint-disable-next-line react-hooks/purity
    const remaining = new Date(selectedSlot.startsAt).getTime() - Date.now();
    return remaining <= WAITLIST_CUTOFF_HOURS * 60 * 60 * 1000;
  }, [selectedSlot]);

  /** This reader's place in one queue of the *selected* showtime, or null. */
  const entryFor = (tierId: number | null): WaitlistEntry | null => {
    if (!selectedSlot || myWaitlist.showtimeId !== selectedSlot.showtimeId) return null;
    return myWaitlist.entries[waitlistKey(tierId)] ?? null;
  };

  useEffect(() => {
    const showtimeId = selectedSlot?.showtimeId;
    if (!isSignedIn || !showtimeId) return;
    let cancelled = false;
    waitlistClient
      .listMine(showtimeId)
      .then((entries) => {
        if (cancelled) return;
        const next: Record<string, WaitlistEntry> = {};
        for (const entry of entries) next[waitlistKey(entry.ticketTierId)] = entry;
        setMyWaitlist({ showtimeId, entries: next });
      })
      // A queue that cannot be read is not worth an alarm on a page whose job is selling tickets:
      // the controls simply offer joining, and the server refuses a duplicate harmlessly.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, selectedSlot?.showtimeId]);

  const joinWaitlist = (ticketTierId: number | null) => {
    const showtimeId = selectedSlot?.showtimeId;
    if (!showtimeId) return;
    onRequireSignIn(() => {
      const key = waitlistKey(ticketTierId);
      setWaitlistBusy(key);
      waitlistClient
        .join({ showtimeId, ticketTierId })
        .then((result) => {
          setMyWaitlist((current) => ({
            showtimeId,
            entries: {
              ...(current.showtimeId === showtimeId ? current.entries : {}),
              [key]: result.entry,
            },
          }));
          onNotice(
            "ok",
            result.existing
              ? "Bạn đã ở trong danh sách chờ. Chúng tôi sẽ báo khi có vé."
              : "Đã vào danh sách chờ. Chúng tôi sẽ báo qua email khi có vé.",
          );
        })
        .catch((error: unknown) => {
          const code = error instanceof WaitlistError ? error.code : "";
          // Stock came back between the page being drawn and the button being pressed. The reader
          // does not want a queue any more — they want the tickets (UC-17 A3).
          if (code === "tickets_available") {
            onNotice("ok", "Vé đã có lại! Bạn có thể mua ngay bên dưới.");
          } else {
            onNotice(
              "error",
              error instanceof Error ? error.message : "Không vào được danh sách chờ.",
            );
          }
        })
        .finally(() => setWaitlistBusy(null));
    });
  };

  const leaveWaitlist = (ticketTierId: number | null) => {
    const key = waitlistKey(ticketTierId);
    const entry = entryFor(ticketTierId);
    if (!entry) return;
    setWaitlistBusy(key);
    waitlistClient
      .leave(entry.id)
      .then(() => {
        setMyWaitlist((current) => {
          const entries = { ...current.entries };
          delete entries[key];
          return { ...current, entries };
        });
        onNotice("ok", "Đã rời danh sách chờ.");
      })
      .catch((error: unknown) =>
        onNotice("error", error instanceof Error ? error.message : "Không rời được danh sách chờ."),
      )
      .finally(() => setWaitlistBusy(null));
  };

  /**
   * Nothing on this showtime can be bought, and something might free up — so the queue is offered.
   *
   * Guarded on `eventClosed`, not on `eventUnavailable`: the latter counts `sold_out`, which is
   * precisely the state this control exists for. Guarding on it meant a sold-out event — the only
   * kind anybody would ever want to queue for — showed a dead "Hết vé" button and no way in.
   */
  const showtimeSoldOut =
    !eventClosed && (event.status === "sold_out" || Boolean(selectedSlot?.soldOut));

  const handlePrimaryAction = () => {
    if (!selectedSlot) return;
    // The showtime id is what the hold API locks against — carry it, not just the display strings.
    if (isSeated)
      onProceedToSeatSelection(selectedSlot.showtimeId, selectedSlot.date, selectedSlot.time);
    // General admission is already holding by the time this is pressed, so there is nothing to
    // commit here — only somewhere to go.
    else onProceedToCheckout();
  };

  /*
   * A disabled button has to say *why* it is disabled.
   *
   * "Chưa thể đặt vé" covered sold out, cancelled and finished alike — three different pieces of
   * news in one sentence that says none of them, on the one control a reader looks at to find out.
   * The event's own status already has a word for each, printed on the card they arrived from, so
   * the button prints the same word.
   *
   * A slot that is gone on an event still listed as bookable gets it too: the strip above says
   * "Hết vé" against that time, and the button must not go on offering to continue.
   */
  const primaryLabel = eventUnavailable
    ? statusLabels[event.status]
    : !selectedSlot
      ? "Chưa có suất nào"
      : selectedSlot.soldOut
        ? statusLabels.sold_out
        : isSeated
          ? "Tiếp tục chọn ghế"
          : "Tiếp tục thanh toán";

  /*
   * The showtimes, split into a strip of days and a grid of times.
   *
   * They used to be one flat list of "11/08/2026 · 21:30 · Online" buttons two to a row, so twenty
   * showtimes were twenty near-identical labels and the only way to find a Saturday was to read all
   * of them. Every cinema in the country splits the two, and it is the split that does the work:
   * the day is a decision with four or five options, and only then is the time a decision with
   * four or five options.
   */
  const slotDates = useMemo(
    () => [...new Set(visibleSlots.map((slot) => slot.date))].sort(),
    [visibleSlots],
  );
  const activeDate = selectedSlot?.date ?? slotDates[0] ?? "";
  const slotsOnActiveDate = useMemo(
    () => visibleSlots.filter((slot) => slot.date === activeDate),
    [visibleSlots, activeDate],
  );

  /** Picking a day lands on its first open showtime, so the grid below is never showing nothing. */
  const chooseDate = (date: string) => {
    const onDate = visibleSlots.filter((slot) => slot.date === date);
    const firstOpen = onDate.find((slot) => !slot.soldOut) ?? onDate[0];
    if (firstOpen) setSelectedSlotKey(firstOpen.key);
  };

  /** Every showtime on a day being gone is what greys the day out — not the day itself. */
  const dateSoldOut = (date: string) =>
    visibleSlots.filter((slot) => slot.date === date).every((slot) => slot.soldOut);

  /*
   * Two day pickers, chosen by how many days there are — never by what kind of event it is.
   *
   * A film runs three or four weeks, so listing every date is a choice between a sideways scroller
   * whose far end nobody finds and a six-row wall of buttons. The calendar solves that: seven
   * Monday-first columns, one week at a time, so the panel is the same height whether the run is
   * four days or eight weeks and the weekday of every date is readable off the column it sits in.
   *
   * But a three-night concert in a calendar is four empty cells and a pair of arrows that do
   * nothing — furniture around three buttons. So a short run keeps the plain grid of its own dates.
   *
   * The test is the count, not the category: an admin-created category can be called anything (the
   * catalogue already holds `custom_phim_anh_…`), so branching on its name would put a two-day film
   * in the calendar and a twenty-night residency in the wall of buttons. The count is the thing
   * that actually causes the problem, so the count is what decides.
   */
  const useWeekCalendar = slotDates.length > MAX_FLAT_DATES;

  /**
   * Which week the calendar shows. `null` means "follow the selection": it stays on whichever week
   * holds the chosen showtime until the reader pages away from it deliberately.
   */
  const [weekStartOverride, setWeekStartOverride] = useState<string | null>(null);
  const today = todayISO();

  const firstSlotDate = slotDates[0] ?? today;
  const lastSlotDate = slotDates[slotDates.length - 1] ?? today;

  const weekStart = weekStartOverride ?? weekRange(activeDate || firstSlotDate).from;
  const weekCells = useMemo(() => weekDays(weekStart), [weekStart]);

  // The run's own first and last weeks are the ends of the strip — there is nothing to page to
  // beyond them, so the arrows stop rather than scrolling through empty months.
  const canGoBack = weekStart > weekRange(firstSlotDate).from;
  const canGoForward = weekStart < weekRange(lastSlotDate).from;

  /**
   * The day the "hôm nay" shortcut lands on: today while the run covers it, otherwise the nearest
   * date the run actually has. A button that jumps to an empty week would be a dead control.
   */
  const shortcutDate =
    today <= firstSlotDate ? firstSlotDate : today >= lastSlotDate ? lastSlotDate : today;
  const shortcutIsToday = shortcutDate === today;

  const goToWeekOf = (date: string) => {
    setWeekStartOverride(weekRange(date).from);
    // …and select something on the way, so the times below follow the strip instead of staying on a
    // showtime the reader can no longer see.
    const onOrAfter =
      visibleSlots.find((slot) => slot.date >= date && !slot.soldOut) ?? visibleSlots[0];
    if (onOrAfter) setSelectedSlotKey(onOrAfter.key);
  };

  /*
   * The event's particulars, moved out of the page's tail and into the booking panel.
   *
   * They were a two-column definition list below the blurb, below the policies — under the button
   * they were meant to inform. A buyer weighing up the price could not see the running time or the
   * age rating without scrolling past the thing they were deciding about.
   *
   * Four is the count the row is built for; anything with no value drops out rather than printing a
   * glyph over an empty label, and the grid closes up around it.
   */
  const highlights: SummaryHighlight[] = [
    { icon: Clock3, label: event.duration > 0 ? `${event.duration} phút` : "" },
    { icon: Tag, label: event.genre[0] ?? "" },
    // "P" on its own is not a fact anyone can read. The graded ratings say what they mean already.
    { icon: Users, label: event.ageRating === "P" ? "Mọi lứa tuổi" : event.ageRating },
  ].filter((h) => h.label);

  const details: SummaryDetail[] = [
    { label: "Địa điểm", value: event.venueName || event.location },
    { label: "Thành phố", value: event.city },
    { label: "Suất diễn", value: selectedSlot ? `${selectedSlot.time}` : "Chưa chọn" },
    { label: "Tình trạng", value: statusLabels[event.status] },
    { label: "Giá từ", value: formatVnd(event.price) },
  ].filter((d) => d.value);

  const summaryLines: SummaryLine[] = selection.map((line) => ({
    key: line.tierId,
    label: `${line.quantity} × ${line.label}`,
    detail: formatVnd(line.price),
    amount: line.quantity * line.price,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <BookingHeader backLabel="Quay về trang chủ" onBack={onBack} current={1} seated={isSeated} />

      <BookingLayout
        aside={
          <OrderSummary
            event={event}
            date={selectedSlot?.date}
            time={selectedSlot?.time}
            venue={selectedSlot?.venue}
            highlights={highlights}
            details={details}
            lines={isSeated ? [] : summaryLines}
            total={totalPrice}
            // No hold exists on this screen until one is placed further along, so the clock is only
            // drawn when the buyer has stepped back into a live one.
            // General admission holds from the first stepper press, so its countdown belongs
            // on this screen. A seated order has nothing held until the next one.
            holdMs={isSeated ? undefined : holdRemainingMs}
            emptyLabel={isSeated ? "Ghế được chọn ở bước sau" : "Chưa chọn vé nào"}
            ctaLabel={primaryLabel}
            onCta={handlePrimaryAction}
            ctaDisabled={bookingDisabled}
            /*
              Nothing on this showtime can be bought, so the panel's action becomes the queue
              instead of a greyed-out label. Seated showtimes queue for the showtime as a whole
              (`null`): a seat is chosen on the next screen, not a tier on this one, and with no
              free seat left no tier has stock — which is exactly the any-tier rule.
            */
            ctaReplacement={
              showtimeSoldOut ? (
                <WaitlistControl
                  tone="cta"
                  entry={entryFor(null)}
                  closed={waitlistClosed}
                  busy={waitlistBusy === "any"}
                  onJoin={() => joinWaitlist(null)}
                  onLeave={() => leaveWaitlist(null)}
                />
              ) : undefined
            }
            note={
              !isSignedIn && !eventUnavailable
                ? isSeated
                  ? "Cần đăng nhập để chọn ghế"
                  : "Cần đăng nhập để thanh toán"
                : undefined
            }
            reassurance={event.refundPolicy}
          />
        }
      >
        {/*
          One step, not two.

          A general-admission purchase decides the showtime and the quantity on this page and then
          pays; splitting that into "01 Chọn suất" and "02 Chọn số lượng vé" numbered two halves of
          one screen as if the buyer travelled between them. A seated purchase really does travel —
          the seat map is its own screen — so for that one this page is step 01 and nothing else.
        */}
        {/*
          The artwork, at the size it was made to be seen.

          This screen opened on a 128px thumbnail inside a ticket stub — the object being sold,
          reproduced smaller than the step indicator above it. The reference runs a gallery down the
          whole left column against the booking panel on the right, and the page already has that
          two-column shape; it was simply not using the left one to show anything.

          The stub is not gone, it has moved: on the seat map and at checkout the buyer has already
          decided, and a compact reminder of what they are buying is exactly the right size there.

          One image, not a carousel. `MovieEvent` carries a single `imageUrl`; the arrows and dots
          the reference has would be furniture around nothing until the catalog gains a gallery.

          `3/2` with the blurred fill behind it, the same arrangement the catalog cards use: posters
          arrive in every shape and `object-contain` is the only crop that never cuts a face off.
        */}
        <div>
          <h1 className="font-display text-title-l font-black uppercase leading-[1.05] tracking-[0.02em] text-beige-kem">
            {event.title}
          </h1>
          {event.originalTitle && (
            <p className="mt-2 font-meta text-lede text-ink-soft">{event.originalTitle}</p>
          )}

          <figure className="relative mt-6 aspect-[3/2] overflow-hidden bg-beige-kem/[0.07]">
            <img
              src={event.imageUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
            />
            <img
              src={event.imageUrl}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="relative h-full w-full object-contain"
            />

            {/*
              The bookmark, on the artwork — the same control, in the same corner, at the same size
              as the one on every catalog card. It is the only place it appears on this page now.

              Always visible, unlike the card's, which only surfaces under the pointer: a card is one
              of twenty and its furniture has to stay out of the way, while this is the single event
              the reader opened.
            */}
            <button
              type="button"
              onClick={() => onToggleWishlist(event.id)}
              aria-pressed={isWishlisted}
              title={isWishlisted ? "Bỏ khỏi mục đã lưu" : "Lưu sự kiện"}
              aria-label={isWishlisted ? "Bỏ khỏi mục đã lưu" : "Lưu sự kiện"}
              className={`absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center transition ${
                isWishlisted
                  ? "bg-burgundy text-white"
                  : "bg-black/45 text-white backdrop-blur-sm hover:bg-black/70"
              }`}
            >
              <Heart
                className="h-5 w-5"
                strokeWidth={2}
                fill={isWishlisted ? "currentColor" : "none"}
              />
            </button>
          </figure>
        </div>

        <BookingSection
          step="01"
          title={isSeated ? "Chọn suất" : "Chọn vé"}
          hint={
            slots.length === 0
              ? undefined
              : isSeated
                ? "Chọn ngày và giờ. Ghế được chọn ở bước sau."
                : "Chọn ngày, giờ, rồi số lượng cho từng hạng vé."
          }
        >
          {slots.length === 0 ? (
            <p className="border border-dashed border-beige-kem/30 py-8 text-center font-meta text-meta text-ink-soft">
              Chưa có suất nào đang mở bán.
            </p>
          ) : (
            /*
              The picker sits in its own panel now, and everything in it is a size up.

              It is the only part of this screen the buyer has to operate, and it was set in the same
              small caps as the page's captions: an 11px "Ngày" over 14px chips, competing with the
              artwork beside it. Lifting it onto its own surface and giving each group a real heading
              makes the three decisions — day, time, tier — read as the work of the page.
            */
            <div className="space-y-9 border border-beige-kem/25 bg-surface-2 p-5 sm:p-6">
              {/*
                Place first, because it decides how much of the rest is worth reading. Three tiers,
                each narrowing the next, and each one clearing what is below it — a chain chosen in
                Hà Nội must not survive a switch to Đà Nẵng.
              */}
              {showPlaceFilter && (
                <div>
                  <p className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
                    Nơi chiếu
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Select
                      label="Tỉnh / Thành phố"
                      value={placeFilter.city}
                      placeholder="Tất cả"
                      options={options.cities.map((city) => ({ value: city, label: city }))}
                      onChange={(city) => setPlaceFilter({ city, chain: "", venue: "" })}
                      triggerClassName="h-11 w-full justify-between border-2 border-beige-kem/35 bg-xanh-pho px-3 font-meta text-meta text-beige-kem"
                    />
                    <Select
                      label="Cụm rạp"
                      value={placeFilter.chain}
                      placeholder="Tất cả"
                      options={options.chains.map((chain) => ({ value: chain, label: chain }))}
                      onChange={(chain) =>
                        setPlaceFilter((prev) => ({ ...prev, chain, venue: "" }))
                      }
                      triggerClassName="h-11 w-full justify-between border-2 border-beige-kem/35 bg-xanh-pho px-3 font-meta text-meta text-beige-kem"
                    />
                    <Select
                      label="Rạp"
                      value={placeFilter.venue}
                      placeholder="Tất cả"
                      options={options.venues.map((venue) => ({ value: venue, label: venue }))}
                      onChange={(venue) => setPlaceFilter((prev) => ({ ...prev, venue }))}
                      triggerClassName="h-11 w-full justify-between border-2 border-beige-kem/35 bg-xanh-pho px-3 font-meta text-meta text-beige-kem"
                    />
                  </div>
                  <p className="mt-3 font-meta text-meta text-ink-soft">
                    {visibleSlots.length} suất tại {options.venues.length} rạp
                  </p>
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <p className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
                    Ngày
                  </p>

                  {/* The week controls belong to the calendar; a short run has one row of dates
                      and nowhere to page to. */}
                  <div className={useWeekCalendar ? "flex items-center gap-1" : "hidden"}>
                    <button
                      type="button"
                      onClick={() => setWeekStartOverride(addDays(weekStart, -7))}
                      disabled={!canGoBack}
                      aria-label="Tuần trước"
                      className="grid h-9 w-9 place-items-center border border-beige-kem/35 text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    {/* The week being shown, as its two ends — "tuần 2" would need a rule about
                        which week is the first, and the dates say it without one. */}
                    <span className="min-w-[8.5rem] text-center font-meta text-meta tabular-nums text-ink-soft">
                      {formatEventDate(weekStart)} – {formatEventDate(addDays(weekStart, 6))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setWeekStartOverride(addDays(weekStart, 7))}
                      disabled={!canGoForward}
                      aria-label="Tuần sau"
                      className="grid h-9 w-9 place-items-center border border-beige-kem/35 text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => goToWeekOf(shortcutDate)}
                      className="label-eyebrow ml-2 h-9 border border-beige-kem/35 px-3 text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20"
                    >
                      {shortcutIsToday ? "Hôm nay" : "Suất gần nhất"}
                    </button>
                  </div>
                </div>

                {/*
                  The calendar keeps seven Monday-first columns, always — including the days this
                  run does not play, so a date holds the same column all the way down a four-week
                  run and the weekday header above is true of every cell under it. A grid that only
                  held the days with showtimes would shuffle its columns from week to week.

                  The flat grid has no such promise to keep, so it draws only real dates and prints
                  the whole `dd/MM` in each: with a handful of buttons there is room for it, and a
                  bare day number would be ambiguous across a month boundary.
                */}
                <div
                  className={`mt-4 grid gap-1.5 sm:gap-2 ${
                    useWeekCalendar
                      ? "grid-cols-7"
                      : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7"
                  }`}
                >
                  {useWeekCalendar &&
                    WEEKDAY_LABELS.map((weekday) => (
                      <span
                        key={weekday}
                        aria-hidden="true"
                        className="pb-1 text-center font-meta text-meta text-ink-soft"
                      >
                        {weekday}
                      </span>
                    ))}

                  {(useWeekCalendar ? weekCells : slotDates).map((date) => {
                    const count = visibleSlots.filter((slot) => slot.date === date).length;
                    const isActive = date === activeDate;
                    const gone = count > 0 && dateSoldOut(date);
                    const unavailable = count === 0 || gone;
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => chooseDate(date)}
                        disabled={unavailable}
                        aria-pressed={isActive}
                        aria-label={`${formatEventDate(date, true)}${
                          count === 0 ? " — không có suất" : gone ? " — hết vé" : ` — ${count} suất`
                        }`}
                        className={`border-2 px-1 py-3 text-center transition ${
                          isActive
                            ? "border-burgundy bg-burgundy text-white"
                            : unavailable
                              ? "cursor-not-allowed border-beige-kem/15 text-ink-soft/40"
                              : "border-beige-kem/35 text-beige-kem hover:border-beige-kem hover:bg-bubblegum/20"
                        } ${date === today && !isActive ? "border-beige-kem/70" : ""}`}
                      >
                        <span className="block font-display text-title-s font-black leading-none tabular-nums">
                          {useWeekCalendar ? date.slice(8) : formatEventDate(date)}
                        </span>
                        {/*
                          The count is the only thing that says which days are worth pressing, so it
                          stays on a phone; only the word after it goes, since seven columns on a
                          360px screen leave about 44px each.
                        */}
                        <span className="mt-1.5 block font-meta text-meta leading-none opacity-75">
                          {count === 0 ? "—" : gone ? "hết" : count}
                          {count > 0 && !gone && <span className="hidden sm:inline"> suất</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
                  Giờ
                </p>
                {/*
                  Three across at most, not four: the time is the largest thing in the cell now, and
                  a four-column grid inside a half-width column left each one narrower than the venue
                  name printed under it.
                */}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {slotsOnActiveDate.map((slot) => {
                    const isSelected = slot.key === selectedSlotKey;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        onClick={() => setSelectedSlotKey(slot.key)}
                        disabled={slot.soldOut}
                        aria-pressed={isSelected}
                        className={`border-2 p-4 text-left transition ${
                          isSelected
                            ? "border-burgundy bg-burgundy/10 text-beige-kem"
                            : slot.soldOut
                              ? "cursor-not-allowed border-beige-kem/20 text-ink-soft/60"
                              : "border-beige-kem/35 text-beige-kem hover:border-beige-kem hover:bg-bubblegum/20"
                        }`}
                      >
                        <span className="block font-display text-title-m font-black leading-none">
                          {slot.time}
                        </span>
                        <span className="mt-2 block truncate font-meta text-meta text-ink-soft">
                          {slot.venue}
                        </span>
                        <span
                          className={`mt-1 block font-meta text-meta font-bold ${
                            slot.soldOut ? "text-ink-soft" : "text-burgundy-ink"
                          }`}
                        >
                          {slot.soldOut ? "Hết vé" : "Còn vé"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/*
                Only general admission picks a quantity here. A seated order's quantity is however
                many seats get clicked on the next screen, so listing the tiers on this page would
                be a second, contradictory way to say the same number.
              */}
              {!isSeated && (
                <div>
                  <p className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
                    Hạng vé
                  </p>
                  {/*
                    One tier per row, ruled apart. A grid of bordered cards made each tier an object
                    to compare side by side, which is the wrong reading — this is a price list, and a
                    price list is a column.
                  */}
                  <ul className="mt-4 border-t border-beige-kem/25">
                    {tiers.map((tier) => {
                      const cap = tierCap(tier);
                      const quantity = quantities[tier.id] ?? 0;
                      const soldOut = cap === 0;
                      const remaining = remainingOf(tier);

                      return (
                        <li
                          key={tier.id}
                          className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-beige-kem/25 py-4"
                        >
                          <div className="min-w-[12rem] flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-display text-title-s font-black uppercase tracking-[0.03em] text-beige-kem">
                                {tier.label}
                              </span>
                              {tier.badge && (
                                <span className="border border-beige-kem/50 px-2 py-0.5 font-meta text-meta text-beige-kem">
                                  {tier.badge}
                                </span>
                              )}
                            </div>
                            {tier.description && (
                              <p className="mt-1.5 font-meta text-meta leading-5 text-beige-kem/70">
                                {tier.description}
                              </p>
                            )}
                            <p className="mt-1.5 font-meta text-meta text-ink-soft">
                              {remaining === null || remaining === undefined
                                ? "Còn vé"
                                : soldOut
                                  ? "Hết vé"
                                  : `Còn ${remaining} vé`}
                            </p>
                          </div>

                          <span className="shrink-0 font-display text-title-m font-black text-beige-kem">
                            {formatVnd(tier.price)}
                          </span>

                          {/*
                            A tier with nothing left offers the queue where its steppers would be
                            (UC-09 A2). Only this tier: the ones beside it are still for sale, and
                            the server judges the join at exactly this scope.
                          */}
                          {soldOut && !eventClosed ? (
                            <WaitlistControl
                              entry={entryFor(Number(tier.id))}
                              closed={waitlistClosed}
                              busy={waitlistBusy === String(tier.id)}
                              onJoin={() => joinWaitlist(Number(tier.id))}
                              onLeave={() => leaveWaitlist(Number(tier.id))}
                            />
                          ) : (
                            /*
                            The steppers carry the same weight as the price beside them. At 36px with
                            a `font-meta` glyph they read as annotations on the row rather than as
                            the controls that decide what is bought.
                          */
                            <div className="flex shrink-0 items-center gap-3">
                              <button
                                type="button"
                                onClick={() => adjustQuantity(tier, -1)}
                                disabled={quantity === 0 || holdBusy}
                                aria-label={`Bớt vé ${tier.label}`}
                                className="grid h-11 w-11 place-items-center border-2 border-beige-kem/50 font-display text-title-s font-black leading-none text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                −
                              </button>
                              <span className="w-8 text-center font-display text-title-s font-black tabular-nums text-beige-kem">
                                {quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustQuantity(tier, 1)}
                                disabled={soldOut || quantity >= cap || holdBusy}
                                aria-label={`Thêm vé ${tier.label}`}
                                className="grid h-11 w-11 place-items-center border-2 border-beige-kem/50 font-display text-title-s font-black leading-none text-beige-kem transition hover:border-beige-kem hover:bg-bubblegum/20 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </BookingSection>

        {/*
          Everything below is about the event rather than the purchase, so it comes after both
          steps — and it is set as one ruled column, the shape the reference gives its itinerary.

          Only the blurb collapses. It is the one thing here long enough that hiding it saves a
          screen; the two policy notes are two sentences each, and a click to reveal two sentences
          costs more than it returns. The refund line in particular is already printed under the
          buy button, so folding it away here would be hiding what the page just said elsewhere.
        */}
        <div className="border-t border-beige-kem/30 pt-2">
          {/*
            The trailer opens the introduction, under the picker rather than above it.
            Choosing a showtime is what the page is for; the trailer is what convinces somebody the
            showtime is worth choosing, so it sits at the top of everything that is about the film
            instead of competing with the step that sells it.
          */}
          {trailer && (
            <div className="mb-8 space-y-3">
              <p className="font-display text-lede font-black uppercase tracking-[0.03em] text-beige-kem">
                Trailer
              </p>
              <TrailerPanel url={trailer} poster={event.imageUrl || null} title={event.title} />
            </div>
          )}

          <Disclosure label="Giới thiệu" heading="section" defaultOpen>
            {/*
              Set at reading size, not at caption size. This is the only prose on the page; at 14px
              it was smaller than the labels around it. `max-w-2xl` holds the measure so the line
              length stays readable on a wide screen even though the column is not.
            */}
            <p className="max-w-2xl whitespace-pre-line text-lede leading-8 text-beige-kem/90">
              {event.description}
            </p>

            {/*
              The two facts the panel has no room for: the age note is a sentence rather than a
              rating, and the line-up is a list. Everything shorter is up beside the price.
            */}
            <dl className="mt-8 grid gap-x-12 gap-y-4 sm:grid-cols-2">
              {[
                ["Đơn vị/nghệ sĩ", event.cast.join(", ")],
                ["Độ tuổi", event.ageDescription],
                ["Địa chỉ", event.location],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex gap-4 border-b border-beige-kem/20 pb-3">
                    <dt className="w-32 shrink-0 font-meta text-meta tracking-[0.08em] text-ink-soft">
                      {label}
                    </dt>
                    <dd className="min-w-0 flex-1 text-body leading-6 text-beige-kem">{value}</dd>
                  </div>
                ))}
            </dl>
          </Disclosure>

          {/*
            Label left, content right, one hairline under each — the same row the reference uses for
            a day of its itinerary. It replaces a three-column grid, which gave three short notes
            equal width and equal weight and made the page end on a wall of small print.
          */}
          <dl>
            {[
              ["Hoàn/đổi vé", event.refundPolicy],
              ["Hướng dẫn đến nơi", event.venueGuide],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 border-b border-beige-kem/30 py-4 sm:flex-row sm:gap-8"
                >
                  <dt className="shrink-0 font-display text-body font-bold uppercase tracking-[0.04em] text-beige-kem sm:w-56">
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 text-body leading-6 text-beige-kem/80">{value}</dd>
                </div>
              ))}

            {/*
              No "Nhắc lịch" row any more.

              It was the same bookmark the heart on every card writes, three screens down the page,
              under a label that promised a reminder nothing sends. One control, in the one place a
              reader already looks for it — on the artwork, exactly where the catalog puts it.
            */}
          </dl>
        </div>

        {relatedEvents.length > 0 && (
          <section className="border-t border-beige-kem/30 pt-7">
            <p className="label-eyebrow text-ink-soft">Gợi ý tương tự</p>
            <div className="mt-5 grid gap-8 sm:grid-cols-3">
              {relatedEvents.map((related) => (
                <button
                  key={related.id}
                  onClick={() => onBookRelated(related)}
                  className="group text-left"
                >
                  <span className="block aspect-[4/3] overflow-hidden bg-beige-kem/[0.07]">
                    <img
                      src={related.imageUrl}
                      alt={related.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.06]"
                    />
                  </span>
                  <span className="mt-3 block">
                    <span className="line-clamp-2 font-display text-body font-bold uppercase leading-[1.35] tracking-[0.06em] text-beige-kem transition group-hover:text-burgundy-ink">
                      {related.title}
                    </span>
                    <span className="mt-1 block font-meta text-meta text-ink-soft">
                      {formatVnd(related.price)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {/*
          Reviews close the page, below everything about buying.
          Rendered only for a real catalogue event: the dev-only sample data has no server row to
          attach reviews to, and asking the API about id `null` would be a 400 on every sample.
        */}
        {event.eventId !== null && (
          <ReviewPreview
            eventId={event.eventId}
            isSignedIn={isSignedIn}
            onOpenAll={onOpenReviews}
          />
        )}

        {/*
          Reporting the event itself, under everything else on the page.
          
          Quiet on purpose, and last: it is the control almost nobody needs, and one drawn as loudly
          as "Đặt vé" invites presses from people looking for a help desk. It is also the door the
          moderation queue has been missing — `content_reports` has accepted `target_type = 'event'`
          since the queue was built, and nothing anywhere could open one.
        */}
        {event.eventId !== null && (
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-beige-kem/20 pt-6">
            <p className="font-meta text-meta text-ink-soft">
              Thấy nội dung sai sự thật, lừa đảo hoặc vi phạm pháp luật ở sự kiện này?
            </p>
            <button
              type="button"
              onClick={() => onRequireSignIn(() => setReportOpen(true))}
              className="label-eyebrow inline-flex items-center gap-2 text-ink-soft underline-offset-4 transition hover:text-burgundy-ink hover:underline"
            >
              <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Báo cáo sự kiện
            </button>
          </div>
        )}

        {reportOpen && event.eventId !== null && (
          <ReportDialog
            authorName={event.title}
            onCancel={() => setReportOpen(false)}
            onSubmit={async (reason) => {
              const result = await catalogClient.reportEvent(event.eventId!, reason);
              setReportOpen(false);
              onNotice(
                "ok",
                result.alreadyReported
                  ? "Bạn đã báo cáo sự kiện này rồi. Ban quản trị đang xem xét."
                  : "Đã gửi báo cáo. Ban quản trị sẽ xem xét sự kiện này.",
              );
            }}
          />
        )}
      </BookingLayout>
    </div>
  );
}
