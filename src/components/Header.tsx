/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MoonStar, MoreHorizontal, Search, Sun, Ticket, X } from "lucide-react";
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

  useEffect(() => setBroken(false), [avatarUrl]);

  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 object-cover"
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center font-bold normal-case"
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
 * The panel's wayfinding. Short labels — the long catalog names (`TIXHUB_CATEGORIES`) wrap at the
 * display size these are set in. The ids are the same ones `EventFilters` and the home-screen
 * filter reducer use, so a click here and a click on the matching filter chip land on identical
 * state.
 */
/*
 * Shortcuts into the catalogue, and every one of these ids has to be a real category code.
 *
 * `movie` was not: no event in the catalogue uses it, so "Phim" filtered to nothing and looked like
 * a broken page rather than an empty category. It is dropped in favour of the two largest categories
 * that actually exist beside music and theatre. The full list lives in the filter rail, which builds
 * itself from the catalogue and therefore cannot go stale this way again.
 */
const NAV_CATEGORIES = [
  { id: "all", label: "Tất cả" },
  { id: "music", label: "Âm nhạc" },
  { id: "theatre", label: "Sân khấu" },
  { id: "business", label: "Kinh doanh" },
] as const;

/**
 * The reveal stagger, as the custom property the `[data-a="y"]` rule reads.
 *
 * The ramp is not linear: the four display-size categories get a tenth of a second each, then the
 * smaller destinations below the rule close up to half that. A constant step would leave the last
 * row arriving most of a second after the first, long after the panel itself has settled.
 */
function rowDelay(seconds: number): React.CSSProperties {
  return { "--menu-row-delay": `${seconds}s` } as React.CSSProperties;
}

const CATEGORY_DELAY = (index: number) => 0.1 + index * 0.1;
const RULE_DELAY = 0.45;
const LINK_DELAY = (index: number) => 0.5 + index * 0.05;

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
      className={`flex h-full shrink-0 items-center gap-2 px-3.5 transition sm:px-4 ${ active ? "bg-bubblegum text-on-tint" : "text-beige-kem hover:bg-bubblegum/40"
      }`}
    >
      <Icon className="h-[17px] w-[17px] shrink-0" />
      <span className="label-eyebrow hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  );
}

/** A row in the overflow menu under the centre pill. */
function MenuRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="label-eyebrow block w-full px-4 py-2.5 text-left text-beige-kem transition hover:bg-bubblegum/40"
    >
      {label}
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

/** A destination in the lower half of the panel. */
function PanelLink({
  label,
  index,
  onClick,
}: {
  label: string;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="overflow-clip px-1 py-1 text-left text-meta font-bold uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-beige-kem"
    >
      <span data-a="y" style={rowDelay(LINK_DELAY(index))} className="block">
        {label}
      </span>
    </button>
  );
}

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  onViewHistory: () => void;
  onViewWallet: () => void;
  onHomeClick: () => void;
  onLoginClick: () => void;
  /** The organiser's own event list, `/organizer`. */
  onOrganizerClick: () => void;
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
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export default function Header({
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  onViewHistory,
  onViewWallet,
  onHomeClick,
  onLoginClick,
  onOrganizerClick,
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const centerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Search and the overflow menu share the centre cluster, so one outside click closes whichever
  // is open. A query already in flight keeps the field open — collapsing it would leave a filtered
  // grid under a bar that shows no filter.
  useDismiss(centerRef, searchOpen && !searchQuery, () => setSearchOpen(false));
  useDismiss(centerRef, moreOpen, () => setMoreOpen(false));
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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

  const runCentre = (action: () => void) => () => {
    setMoreOpen(false);
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
      className={`${overlay ? "fixed" : "sticky"} inset-x-0 top-0 z-40 ${overHero ? "nav-over-hero" : ""}`}
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
          <span className="block font-display text-title-m font-black tracking-normal text-beige-kem sm:text-title-l">
            TixHub
          </span>
          <span className="mt-0.5 hidden text-meta font-semibold uppercase tracking-[0.22em] text-ink-soft sm:block">
            Music / Stage / Film
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
                  className="nav-search-input w-56 bg-transparent px-3 text-body text-beige-kem outline-none placeholder:text-beige-kem/40 sm:w-80 lg:w-[26rem]"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSearchChange("");
                    setSearchOpen(false);
                  }}
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
              <PillCell
                icon={MoreHorizontal}
                label="Thêm"
                active={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              />
            </div>

            <div className="nav-pill-cell">
              <PillCell icon={Ticket} label="Sự kiện" onClick={runCentre(onBrowse)} />
            </div>
          </div>

          {moreOpen && (
            <div className="absolute left-1/2 top-[calc(100%+12px)] w-52 -translate-x-1/2">
              <div role="menu" className="nav-surface nav-menu-card ticket-corners py-1">
                <MenuRow label="Về chúng tôi" onClick={runCentre(onViewGuide)} />
                <MenuRow label="Điều khoản" onClick={runCentre(onViewAbout)} />
                <MenuRow label="Hoàn vé" onClick={runCentre(onViewPolicy)} />
              </div>
            </div>
          )}
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
                */}
                <div className="flex items-center gap-2">
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

                  <nav className="mt-3 flex flex-col items-start px-4">
                    {NAV_CATEGORIES.map((cat, i) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={run(() => onCategoryChange(cat.id))}
                        aria-current={activeCategory === cat.id ? "page" : undefined}
                        className={`flex w-full items-center gap-3 overflow-clip py-0.5 text-left transition-colors ${ activeCategory === cat.id
                            ? "text-beige-kem"
                            : "text-ink-soft hover:text-beige-kem"
                        }`}
                      >
                        <span
                          data-a="y"
                          style={rowDelay(CATEGORY_DELAY(i))}
                          // Mê Ly is already condensed; `tracking-tight` on top of it closes
                          // the counters up. 2rem matches the size Siena sets its menu links.
                          className="block font-display text-title-m font-bold leading-[0.95]"
                        >
                          {cat.label}
                        </span>
                        {activeCategory === cat.id && (
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-burgundy" />
                        )}
                      </button>
                    ))}
                  </nav>

                  <div className="mx-4 mt-3">
                    <div className="menu-rule" style={rowDelay(RULE_DELAY)} />
                  </div>

                  {/*
                    Built as a list rather than written out, because two of these rows are now
                    conditional. `index` drives the stagger of the reveal, so it has to be the row's
                    position in what is actually rendered — hard-coding 0..3 around a conditional
                    leaves a hole in the sequence and the rows below it arrive late for no reason.
                  */}
                  <div className="mt-3 flex flex-col items-start px-4">
                    {(userName
                      ? [
                          { label: "Vé của tôi", onClick: onViewHistory },
                          { label: "Ví TixHub", onClick: onViewWallet },
                          { label: "Tài khoản", onClick: onLoginClick },
                          // Only an approved organizer has an event list to manage.
                          ...(isOrganizer
                            ? [{ label: "Quản lý sự kiện", onClick: onOrganizerClick }]
                            : []),
                          ...(isAdmin ? [{ label: "Trang quản trị", onClick: onAdminClick }] : []),
                        ]
                      : [
                          { label: "Vé của tôi", onClick: onViewHistory },
                          { label: "Đăng nhập", onClick: onLoginClick },
                        ]
                    ).map((row, i) => (
                      <PanelLink
                        key={row.label}
                        label={row.label}
                        index={i}
                        onClick={run(row.onClick)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
