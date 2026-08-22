/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LayoutDashboard, MoonStar, Search, Store, Sun, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_AVATAR_FG, avatarColor } from "../services/defaultAvatar";
import { useDismiss } from "../hooks/useDismiss";

/**
 * The signed-in user's picture, with a colour-seeded initial as the fallback.
 *
 * The URL may come from the local cache, which lets the real picture paint on the first frame
 * instead of flashing the initial while the session is restored. That cache can be stale — the
 * avatar could have been replaced from another device — so a failed load quietly falls back
 * rather than leaving a broken image.
 */
function AccountAvatar({
  userName,
  userEmail,
  avatarUrl,
  size = 24,
}: {
  userName: string;
  userEmail?: string | null;
  avatarUrl?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  /*
   * Reset during render when the picture changes, not from an effect.
   *
   * `useEffect(() => setBroken(false), [url])` painted the stale `broken` first and corrected it in
   * a second pass — so swapping to a working avatar showed the letter placeholder for one frame
   * before the image appeared. React's own answer to "adjust state when a prop changes" is to
   * compare the prop with what was last seen and set during render: no extra commit, nothing on
   * screen that is already known to be wrong.
   */
  const [seenUrl, setSeenUrl] = useState(avatarUrl);
  if (seenUrl !== avatarUrl) {
    setSeenUrl(avatarUrl);
    setBroken(false);
  }

  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold normal-case"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        backgroundColor: avatarColor(userEmail),
        color: DEFAULT_AVATAR_FG,
      }}
    >
      {userName.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The reveal stagger, as the custom property the `[data-a="y"]` rule reads.
 *
 * The panel used to open on four display-size category shortcuts — Tất cả / Âm nhạc / Sân khấu /
 * Kinh doanh — above the account rows. They are gone: the catalogue is reachable from the "Sự kiện"
 * cell in the pill and from the landing page's own bands, and a menu whose first four rows lead
 * where the bar beside it already leads is four rows of noise in front of the ones that do not.
 *
 * With them went the fast ramp they needed. Every row is an account destination now, so they all
 * arrive on the same short step.
 */
function rowDelay(seconds: number): React.CSSProperties {
  return { "--menu-row-delay": `${seconds}s` } as React.CSSProperties;
}

const LINK_DELAY = (index: number) => 0.1 + index * 0.06;

/** True once the page has scrolled past `offset`. */
function useScrolledPast(offset: number): boolean {
  const [past, setPast] = useState(() => window.scrollY > offset);

  useEffect(() => {
    const check = () => setPast(window.scrollY > offset);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [offset]);

  return past;
}

/** Tracked rather than read once, because the threshold below is derived from it. */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return height;
}

/**
 * One slot in the centre pill: icon plus its name.
 *
 * The label drops below `sm`, where three of them would push the pill wider than the phone it is
 * centred on. `aria-label` carries the name either way, so nothing is lost when the text is.
 */
function PillCell({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: typeof Search;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    // No `title`. The name is printed next to the icon, so a tooltip would only repeat it a second
    // later and in a different place. `aria-label` still carries it for the icon-only phone layout.
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-full shrink-0 items-center gap-2 px-3.5 transition sm:px-4 ${
        active ? "bg-bubblegum text-on-tint" : "text-beige-kem hover:bg-bubblegum/40"
      }`}
    >
      <Icon className="h-[17px] w-[17px] shrink-0" />
      <span className="label-eyebrow hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  );
}

/** One of the three shortcut cells along the bottom of the stub. */
function StubCell({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="menu-stub-cell truncate px-1 text-meta font-bold uppercase tracking-[0.1em] text-ink-soft transition hover:text-beige-kem"
    >
      {label}
    </button>
  );
}

/**
 * The one stub cell that is a symbol rather than a word.
 *
 * It keeps `menu-stub-cell` so it still takes an equal share of the stub and still draws the
 * hairline that separates it from its neighbour. `title` and `aria-label` carry the name the other
 * cells print, since a sun on its own does not say which way it is about to switch.
 */
function StubIconCell({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Search;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="menu-stub-cell is-icon grid place-items-center px-2.5 text-ink-soft transition hover:text-beige-kem"
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
    </button>
  );
}

/**
 * A row in the panel, in one of two weights.
 *
 * `display` is the size the category shortcuts used to be set in, and it is what the panel opens
 * with now that the account's own destinations are the first thing in it — they are what the ticket
 * is for, and they were being announced in the same small caps as the sign-out beneath them.
 *
 * `meta` stays for the rows under the rule. Ending a session is not a destination, and setting it at
 * 32px would make it the loudest thing in the menu.
 */
function PanelLink({
  label,
  index,
  onClick,
  size = "meta",
}: {
  label: string;
  index: number;
  onClick: () => void;
  size?: "display" | "meta";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`overflow-clip px-1 text-left text-ink-soft transition-colors hover:text-beige-kem ${
        size === "display" ? "py-0.5" : "py-1 text-meta font-bold uppercase tracking-[0.14em]"
      }`}
    >
      <span
        data-a="y"
        style={rowDelay(LINK_DELAY(index))}
        // Mê Ly is already condensed, so it takes no extra tracking — 2rem is the size the panel
        // was built around.
        className={
          size === "display" ? "block font-display text-title-m font-bold leading-[0.95]" : "block"
        }
      >
        {label}
      </span>
    </button>
  );
}

/**
 * One row of the search dropdown, pre-formatted.
 *
 * The nav is handed strings rather than a `MovieEvent` on purpose: it would otherwise have to know
 * how this app writes a date and a price, which is two more places for those to be written
 * differently from the cards the reader is comparing them against.
 */
export interface SearchSuggestion {
  /** The event slug — what the caller opens, and the option's DOM id is derived from it. */
  id: string;
  title: string;
  imageUrl: string;
  /** One line under the title: when and where. */
  meta: string;
  /** Formatted, or empty when there is nothing to quote. */
  price: string;
}

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /**
   * What to offer under the box, already ranked and cut to length.
   *
   * Typing used to navigate to `/events` on the first keystroke, which meant the reader lost the
   * page they were on to see results they had not finished asking for. The list comes to them
   * instead, and the catalog is one press away for anyone who wants the whole thing.
   */
  searchResults: SearchSuggestion[];
  /** How many events match in total, so the last row can say what pressing it will show. */
  searchResultCount: number;
  /** Open one suggestion — the event's own page. */
  onSelectResult: (eventSlug: string) => void;
  /** Enter, or the last row: the full result set on `/events`. */
  onSubmitSearch: () => void;
  /**
   * Closing the search box, which is not the same event as typing an empty query.
   *
   * Typing carries the reader to the catalog, because that is where results are shown. Closing the
   * box is the opposite intention — they are done searching — so it must leave them where they are.
   * Routed through `onSearchChange("")` it did the one thing it should never do: press × on the
   * landing page and the page navigated to `/events`.
   */
  onSearchClear: () => void;
  onViewHistory: () => void;
  onViewWallet: () => void;
  /** The bookmarked events, `/saved`. */
  onViewSaved: () => void;
  /** The in-app mailbox, `/notifications`. */
  onViewNotifications: () => void;
  /**
   * How many of those are unread.
   *
   * Printed beside the row rather than as a dot on the ticket: the panel is where the destination
   * lives, and a badge somewhere else would be a second thing to notice and then hunt for.
   */
  unreadNotifications: number;
  /** Ends the session. The last row of the panel, under the rule. */
  onLogout: () => void;
  onHomeClick: () => void;
  onLoginClick: () => void;
  /** The organiser's own event list, `/organizer`. */
  onOrganizerClick: () => void;
  /**
   * The application form, `/account?section=organizer` — for a reader who is *not* an organizer
   * yet. It is deliberately not `/organizer`, which would hand them an empty event list and no way
   * to find out what to do about it.
   */
  onApplyAsOrganizer: () => void;
  /** The moderation and settings console, `/admin`. */
  onAdminClick: () => void;
  /**
   * Whether this account is an *approved* organizer, and whether it is an admin.
   *
   * These gate what the menu offers, nothing more: both routes are enforced on the server, so a
   * hidden link is a tidier menu and never a security control (SEC-04). Offering "Quản lý sự kiện"
   * to everyone signed in was the previous behaviour, and it sent anyone who had not applied to a
   * page with nothing on it.
   */
  isOrganizer: boolean;
  isAdmin: boolean;
  /** The catalog on its own page, `/events`. */
  onBrowse: () => void;
  onViewGuide: () => void;
  onViewAbout: () => void;
  onViewPolicy: () => void;
  userName?: string;
  userEmail?: string | null;
  avatarUrl?: string | null;
  /**
   * Lift the bar out of the document flow so the page starts underneath it, and leave it invisible
   * until the reader scrolls.
   *
   * Only for screens with something full-bleed behind the top of the page — the landing hero. On a
   * plain page the bar would have nothing to float on and would sit over the first paragraph.
   */
  overlay?: boolean;
  /**
   * Let the header scroll away instead of following the page down.
   *
   * For the organizer workspace. The floats carry their own surfaces and no bar behind them, which
   * reads well over a short page and badly over a long form: sticky, they ride over whatever is
   * beneath, and on the create-event screen that was the description textarea — site chrome sitting
   * on a field somebody is typing into. A workspace does not need the marketing nav following it
   * down, so here it simply leaves.
   */
  unpinned?: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export default function Header({
  searchQuery,
  onSearchChange,
  onSearchClear,
  searchResults,
  searchResultCount,
  onSelectResult,
  onSubmitSearch,
  onViewHistory,
  onViewWallet,
  onViewSaved,
  onViewNotifications,
  unreadNotifications,
  onLogout,
  onHomeClick,
  onLoginClick,
  onOrganizerClick,
  onApplyAsOrganizer,
  onAdminClick,
  isOrganizer,
  isAdmin,
  onBrowse,
  onViewGuide,
  onViewAbout,
  onViewPolicy,
  userName,
  userEmail,
  avatarUrl,
  overlay = false,
  unpinned = false,
  theme,
  onToggleTheme,
}: HeaderProps) {
  /*
   * White ink holds for exactly as long as the hero is behind the nav.
   *
   * The old 80px trigger belonged to a bar that turned cream at the same moment. With no bar left,
   * 80px would flip the wordmark to burgundy while it was still sitting on a dark still — the hero
   * is `100dvh`, so its bottom edge is a viewport away, not eighty pixels.
   */
  const viewportHeight = useViewportHeight();
  const pastHero = useScrolledPast(overlay ? Math.max(viewportHeight - 96, 160) : 0);
  const overHero = overlay && !pastHero;

  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const centerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /*
   * Search and the overflow menu share the centre cluster, so one outside click closes whichever is
   * open — and closing the field now also puts the suggestions away, which is the whole reason a
   * query no longer holds it open. The query itself survives: the closed pill lights up while one
   * is in force, so the filter is still visible on `/events` and still undoable from the ×.
   */
  useDismiss(centerRef, searchOpen, () => setSearchOpen(false));
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  /*
   * Which suggestion the keyboard is on. `-1` is "none", which is what Enter reads as "show me
   * everything" — so the arrow keys are an optional shortcut rather than a mode you have to leave.
   *
   * Reset whenever the query changes, during render rather than in an effect: the row that was
   * highlighted belongs to the previous list, and letting it survive one paint means Enter can fire
   * on an event that is no longer the third row.
   */
  const [highlight, setHighlight] = useState(-1);
  const [previousQuery, setPreviousQuery] = useState(searchQuery);
  if (previousQuery !== searchQuery) {
    setPreviousQuery(searchQuery);
    setHighlight(-1);
  }

  /** The panel is only up while there is something typed and something to say about it. */
  const suggestionsOpen = searchOpen && searchQuery.trim().length > 0;

  const closeSearch = () => {
    onSearchClear();
    setSearchOpen(false);
    setHighlight(-1);
  };

  const chooseSuggestion = (slug: string) => {
    setSearchOpen(false);
    setHighlight(-1);
    onSelectResult(slug);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsOpen) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (searchResults.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Wraps through `-1`, so running off either end returns to the box with nothing selected
      // rather than sticking to the first or last row.
      setHighlight((current) => {
        const next = current + step;
        if (next < -1) return searchResults.length - 1;
        if (next >= searchResults.length) return -1;
        return next;
      });
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const picked = searchResults[highlight];
      if (picked) chooseSuggestion(picked.id);
      else {
        setSearchOpen(false);
        onSubmitSearch();
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setSearchOpen(true);
      searchInputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Every menu entry closes the surface behind it; nothing should stay hanging. */
  const run = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    /*
     * There is no bar. The header is an empty positioning frame; the only things that paint are the
     * three floats inside it, each carrying its own surface.
     *
     * `fixed` on the landing page so the hero owns the top of the document and reaches the left
     * edge behind the wordmark; `sticky` elsewhere, where the frame still holds a row open so the
     * page does not start underneath the floats.
     */
    <header
      className={`${overlay ? "fixed" : unpinned ? "relative" : "sticky"} inset-x-0 top-0 z-40 ${
        overHero ? "nav-over-hero" : ""
      }`}
    >
      {/*
       * Three free-standing groups rather than one bar of controls. A 1fr / auto / 1fr grid is what
       * keeps the middle cluster on the page's centre line: with flexbox it would drift by half the
       * difference between the wordmark and the ticket, which are nowhere near the same width.
       *
       * The grid itself is click-through. Without that, an invisible 80px band would run the width
       * of the page and eat every press aimed at the hero underneath it.
       */}
      <div className="pointer-events-none grid h-20 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-10">
        <button
          onClick={run(onHomeClick)}
          className="pointer-events-auto justify-self-start text-left leading-none"
          title="Trang chủ"
        >
          {/*
            Two steps down the scale — 32/50px to 20/24px — and the strapline is gone.

            The wordmark was the largest type on any screen it appeared over, competing with the
            heading of whatever band was underneath it, and "Music / Stage / Film" repeated in a
            third size what the nav's own categories already say. A wordmark identifies the site; it
            does not have to describe it.
          */}
          <span className="block font-display text-lede font-black tracking-normal text-beige-kem sm:text-title-s">
            TixHub
          </span>
        </button>

        {/*
         * The overflow menu hangs off this wrapper, not off the pill. A mask clips its own
         * descendants, so a dropdown rendered inside the pill would be sheared at the pill's edge.
         */}
        <div ref={centerRef} className="pointer-events-auto relative justify-self-center">
          <div className="nav-surface nav-pill ticket-corners h-12">
            {/*
             * Search grows the pill from the middle outward. The grid column is `auto`, so the
             * cluster stays centred as it widens instead of shunting the wordmark sideways.
             */}
            {/*
             * No `nav-pill-cell` on either search state, so no hairline lands beside the field.
             * The divider that used to appear only while the field was open was the odd one out
             * anyway — closed, the search button never had one.
             */}
            {searchOpen ? (
              <div className="flex items-center pl-4 pr-1">
                <Search className="h-4 w-4 shrink-0 text-ink-soft" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Tìm tên sự kiện, nghệ sĩ, rạp, nhà hát, địa điểm…"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  role="combobox"
                  aria-expanded={suggestionsOpen}
                  aria-controls="nav-search-results"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    highlight >= 0 ? `nav-search-option-${highlight}` : undefined
                  }
                  className="nav-search-input w-56 bg-transparent px-3 text-body text-beige-kem outline-none placeholder:text-beige-kem/40 sm:w-80 lg:w-[26rem]"
                />
                <button
                  type="button"
                  onClick={closeSearch}
                  aria-label="Đóng tìm kiếm"
                  className="grid h-8 w-8 shrink-0 place-items-center text-beige-kem transition hover:bg-bubblegum/40"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <PillCell
                icon={Search}
                label="Tìm kiếm"
                active={Boolean(searchQuery)}
                onClick={() => setSearchOpen(true)}
              />
            )}

            <div className="nav-pill-cell">
              <PillCell icon={Ticket} label="Sự kiện" onClick={onBrowse} />
            </div>

            {/*
              The third cell used to be "Thêm", an overflow menu of three links — about, terms,
              refunds — that the footer's "Hỗ trợ" column already carries verbatim. A duplicate is
              not worth a cell on the page's centre line, and the links have moved into the account
              panel, where the rest of the site's small print now sits.

              What replaces it is the one destination that had no way in at all: the organiser
              pitch, which lived only in a banner at the foot of the home page. Selling is the other
              half of a ticketing site and it was the half you had to scroll to the bottom to find.

              One cell, two states, the way the stub's own cells already work: an approved organizer
              gets their console, everyone else gets the form that leads there.
            */}
            <div className="nav-pill-cell">
              {isOrganizer ? (
                <PillCell icon={LayoutDashboard} label="Quản lý" onClick={onOrganizerClick} />
              ) : (
                <PillCell icon={Store} label="Bán vé" onClick={onApplyAsOrganizer} />
              )}
            </div>
          </div>

          {/*
            The suggestions, hanging off the same wrapper the overflow menu uses — inside the pill
            they would be sheared off by its mask.

            Always mounted, faded and lifted 4px when closed, so opening and closing is a 180ms move
            rather than a pop. `inert` keeps the hidden copy out of the tab order and away from
            screen readers, which `opacity-0` alone does not.
          */}
          <div
            data-open={suggestionsOpen}
            inert={!suggestionsOpen}
            className="pointer-events-none absolute left-1/2 top-[calc(100%+12px)] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1 opacity-0 transition duration-200 ease-out data-[open=true]:pointer-events-auto data-[open=true]:translate-y-0 data-[open=true]:opacity-100"
          >
            <div className="nav-surface nav-menu-card ticket-corners overflow-hidden py-1">
              <ul id="nav-search-results" role="listbox" aria-label="Kết quả tìm kiếm">
                {searchResults.map((result, index) => (
                  <li
                    key={result.id}
                    id={`nav-search-option-${index}`}
                    role="option"
                    aria-selected={index === highlight}
                  >
                    <button
                      type="button"
                      onClick={() => chooseSuggestion(result.id)}
                      // Pointer and keyboard drive the same highlight, so moving the mouse over a
                      // row and then pressing Enter opens the row under the pointer.
                      onMouseMove={() => setHighlight(index)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                        index === highlight ? "bg-bubblegum/40" : "hover:bg-bubblegum/25"
                      }`}
                    >
                      <span className="h-11 w-16 shrink-0 overflow-hidden bg-beige-kem/[0.07]">
                        {result.imageUrl && (
                          <img
                            src={result.imageUrl}
                            alt=""
                            aria-hidden="true"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-body font-bold uppercase leading-tight tracking-[0.04em] text-beige-kem">
                          {result.title}
                        </span>
                        <span className="mt-0.5 block truncate font-meta text-meta text-ink-soft">
                          {result.meta}
                        </span>
                      </span>
                      {result.price && (
                        <span className="shrink-0 font-meta text-meta text-beige-kem">
                          {result.price}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {searchResults.length === 0 ? (
                <p className="px-3 py-6 text-center font-meta text-body text-ink-soft">
                  Không tìm thấy sự kiện nào.
                </p>
              ) : (
                /* The way out of a short list: everything that matched, on the page built for it. */
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    onSubmitSearch();
                  }}
                  className="label-eyebrow mt-1 flex w-full items-center justify-between gap-2 border-t border-beige-kem/25 px-3 py-3 text-ink-soft transition hover:bg-bubblegum/25 hover:text-beige-kem"
                >
                  Xem tất cả {searchResultCount} kết quả
                  <span aria-hidden="true">&gt;</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center justify-self-end">
          <div ref={menuRef} className="relative">
            {/*
             * One ticket, torn in two by the perforation: the stub carries who you are and where
             * your own things live, the square tears off to open everything else.
             */}
            <div className="nav-surface menu-ticket-group ticket-corners h-[66px]">
              <div className="hidden w-60 flex-col justify-center gap-1 px-3 md:flex">
                {/*
                  Signed in, the identity line is the way to your own page — the face and the name
                  are what a reader already reads as "me", so making them the control removes a step
                  and a duplicate label. Signed out there is nobody to open, so "Khách" stays inert.

                  Centred in that state, too: signed in the row is an avatar plus a name that can run
                  the width of the stub, so it has to start at the left edge like a line of text.
                  "Khách" is one short word, and left-aligned it sits off in a corner of a 15rem
                  column with nothing to balance it.
                */}
                <div className={`flex items-center gap-2 ${userName ? "" : "justify-center"}`}>
                  {userName ? (
                    <button
                      type="button"
                      onClick={run(onLoginClick)}
                      title="Tài khoản"
                      className="flex min-w-0 items-center gap-2 text-left transition hover:opacity-70"
                    >
                      <AccountAvatar
                        userName={userName}
                        userEmail={userEmail}
                        avatarUrl={avatarUrl}
                        size={22}
                      />
                      <span className="truncate text-meta font-bold uppercase tracking-[0.04em] text-beige-kem">
                        {userName}
                      </span>
                    </button>
                  ) : (
                    <span className="label-eyebrow text-ink-soft">Khách</span>
                  )}
                </div>

                <div className="menu-stub-rule" />

                {/*
                  The theme switch lives here in both states, not only where "Tài khoản" used to be,
                  because it is now the only one on the page — the overflow menu's row is gone. The
                  account page itself is still reachable from the panel below.
                */}
                {/*
                  The stub keeps the two pages a buyer reaches for most — their tickets and their
                  wallet — plus the theme switch, which is the only one on the page.
                */}
                <div className="flex items-center">
                  {userName ? (
                    <>
                      <StubCell label="Vé" onClick={run(onViewHistory)} />
                      <StubCell label="Ví" onClick={run(onViewWallet)} />
                      <StubIconCell
                        icon={theme === "dark" ? Sun : MoonStar}
                        label={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
                        onClick={onToggleTheme}
                      />
                    </>
                  ) : (
                    <>
                      <StubCell label="Vé" onClick={run(onViewHistory)} />
                      <StubCell label="Đăng nhập" onClick={run(onLoginClick)} />
                      <StubIconCell
                        icon={theme === "dark" ? Sun : MoonStar}
                        label={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
                        onClick={onToggleTheme}
                      />
                    </>
                  )}
                </div>
              </div>

              <div className="menu-perf hidden md:block" />

              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
                title="Menu"
                data-open={menuOpen}
                // Height comes from the group's content box, so the 2px stroke does not push the
                // square past the ticket it lives in.
                className="menu-ticket h-full shrink-0 p-4"
              >
                <span className="menu-ticket-lines">
                  <span className="menu-ticket-line" />
                  <span className="menu-ticket-line" />
                  <span className="menu-ticket-line" />
                </span>
              </button>
            </div>

            {/*
             * Always mounted. `grid-template-rows` can only animate between two rendered states, so
             * unmounting on close would trade the reveal for a pop; `inert` is what keeps the
             * collapsed rows out of the tab order instead.
             */}
            <div
              data-open={menuOpen}
              inert={!menuOpen}
              // Anchored to the ticket only once the stub is showing — below `md` the group is
              // just the 66px square, and a panel that wide would be a column of ellipses.
              className="menu-panel fixed inset-x-4 top-[calc(5rem+10px)] md:absolute md:inset-x-0 md:top-[calc(100%+10px)]"
            >
              <div>
                <div className="nav-surface ticket-corners pb-4 pt-3">
                  <div className="menu-tear" />

                  {/*
                    The panel, in two groups either side of a rule.

                    Above it, where this account goes: who you are, what you saved, and — for an
                    approved organizer — the events you run. Below it, what this account *is*: the
                    admin console for the few who have one, and the way out.

                    A rule is the cheapest way to say those are different kinds of thing, and it
                    keeps "Đăng xuất" from sitting in the same run as the destinations, where a
                    reader aiming for the row above it can hit it by mistake.

                    The site's small print — about, terms, refunds — joins the lower group, having
                    come out of the centre pill's overflow menu. It belongs with "what this account
                    is" rather than "where it goes", and unlike the rows around it, it is there for
                    a signed-out reader too, which is why the lower group no longer disappears with
                    the session.

                    `index` runs across both groups, because it drives the reveal stagger and the
                    rows arrive in one sequence however they are grouped.
                  */}
                  {(() => {
                    const destinations = userName
                      ? [
                          { label: "Tài khoản", onClick: onLoginClick },
                          {
                            // The count rides in the label because these rows are set in the
                            // display face at 32px — a superscript badge beside one of them would
                            // be the only ornament in the panel.
                            label:
                              unreadNotifications > 0
                                ? `Thông báo (${unreadNotifications})`
                                : "Thông báo",
                            onClick: onViewNotifications,
                          },
                          { label: "Đã lưu", onClick: onViewSaved },
                          // "Trang quản lý" is gone from here: the centre pill's third cell is the
                          // organizer's console once the account is approved, and a second row to
                          // the same page is the duplication that cell was built to remove.
                        ]
                      : [{ label: "Đăng nhập", onClick: onLoginClick }];

                    const secondaryRows = [
                      { label: "Về chúng tôi", onClick: onViewGuide },
                      { label: "Điều khoản", onClick: onViewAbout },
                      { label: "Hoàn vé", onClick: onViewPolicy },
                      ...(userName && isAdmin
                        ? [{ label: "Trang quản trị", onClick: onAdminClick }]
                        : []),
                      ...(userName ? [{ label: "Đăng xuất", onClick: onLogout }] : []),
                    ];

                    return (
                      <>
                        <div className="mt-3 flex flex-col items-start px-4">
                          {destinations.map((row, i) => (
                            <PanelLink
                              key={row.label}
                              label={row.label}
                              index={i}
                              size="display"
                              onClick={run(row.onClick)}
                            />
                          ))}
                        </div>

                        <div className="mx-4 mt-3">
                          <div
                            className="menu-rule"
                            style={rowDelay(LINK_DELAY(destinations.length))}
                          />
                        </div>
                        <div className="mt-3 flex flex-col items-start px-4">
                          {secondaryRows.map((row, i) => (
                            <PanelLink
                              key={row.label}
                              label={row.label}
                              index={destinations.length + 1 + i}
                              onClick={run(row.onClick)}
                            />
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
