/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlertTriangle,
  CheckCircle2,
  LogOut,
  MoonStar,
  ShieldCheck,
  Store,
  Sun,
  Ticket,
  User,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "@/shared/auth/types";
import type { OrganizerApplicationView, OrganizerAppealView } from "../../services/authClient";
import { authClient } from "../../services/authClient";
import ConfirmDialog, { ConfirmRequest } from "../ConfirmDialog";
import OrganizerSection from "./OrganizerSection";
import ProfileSection from "./ProfileSection";
import SecuritySection from "./SecuritySection";
import OrganizerBusinessAnalytics from "./OrganizerBusinessAnalytics";
import { btnSecondary } from "./primitives";

interface Props {
  onClose: () => void;
  onLogout: () => void;
  /** Revokes every session for the account, this device included. */
  onLogoutAll: () => void;
  onProfileUpdated: (user: Me) => void;
  onManageEvents: () => void;
  /** `/bookings` — the buyer's own tickets. A rail shortcut, not a section of this page. */
  onViewTickets: () => void;
  /** `/wallet` — the balance and its statement. */
  onViewWallet: () => void;
  /**
   * The landing page. What the screen's own back control does, in step with every other page of the
   * site: they all say "Quay về trang chủ" and they all land there.
   *
   * Separate from `onClose`, which is what Escape and the browser's Back still do — those are a
   * *dismissal*, and dropping the reader on the screen underneath is the honest answer to them.
   */
  onGoHome: () => void;
  /**
   * The reader's light/dark setting, and the switch for it.
   *
   * The site's only theme switch lives in the header's ticket stub, and this screen covers the
   * header — so without one here the setting is unreachable for as long as the account is open.
   */
  theme: "dark" | "light";
  onToggleTheme: () => void;
  /**
   * Which section to land on.
   *
   * Defaults to the profile. The footer's "Đăng ký làm nhà tổ chức" opens this page *for* the
   * organizer form, and dropping that reader on the profile with a sidebar to find would undo the
   * point of the link.
   */
  initialSection?: SectionId;
}

export type SectionId = "profile" | "security" | "organizer";

const SECTIONS: { id: SectionId; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Hồ sơ", icon: User },
  { id: "security", label: "Bảo mật", icon: ShieldCheck },
  { id: "organizer", label: "Nhà tổ chức", icon: Store },
];

/**
 * The rail's second group: two pages of this account that are not sections of this one.
 *
 * They replace the avatar-and-name chip that used to sit at the foot of the rail. The chip was a
 * label for the identity the profile card already prints, where the two destinations a signed-in
 * reader actually reaches for — their tickets and their wallet — were reachable only from the site
 * header this overlay covers.
 */
const SHORTCUTS: { id: "tickets" | "wallet"; label: string; icon: typeof User }[] = [
  { id: "tickets", label: "Vé", icon: Ticket },
  { id: "wallet", label: "Ví", icon: Wallet },
];

/**
 * One rail row. Sections light up when current; shortcuts never do — they leave the page.
 *
 * The selected fill is the page's own ink, inverted — the same treatment the admin console's rail
 * and the `/events` filter rail use for a chosen row. Square, because nothing in this app's rails
 * is a rounded chip.
 */
const railRow = (active: boolean) =>
  `relative flex h-11 w-full items-center gap-2.5 whitespace-nowrap px-3.5 font-display text-body font-bold uppercase tracking-[0.04em] transition ${
    active
      ? "bg-beige-kem text-xanh-pho"
      : "text-ink-soft hover:bg-bubblegum/25 hover:text-beige-kem"
  }`;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The account screen: a sidebar of sections beside a column of cards, one section at a time. The
 * sidebar collapses to a row of chips below `lg`, where the user chip is dropped because the profile
 * card already carries the same identity.
 *
 * It replaces a single flat scroll that stacked profile, password and organizer forms with three
 * identical-looking submit buttons. Splitting it keeps each view near the ~7 items a person can hold
 * at once, and lets the buttons regain a hierarchy.
 *
 * Presented as a dialog over the page rather than a route, because the app has no router: the
 * history entry pushed on mount is what makes the browser Back button close it.
 */
export default function AccountPage({
  onClose,
  onLogout,
  onLogoutAll,
  onProfileUpdated,
  onManageEvents,
  onViewTickets,
  onViewWallet,
  onGoHome,
  theme,
  onToggleTheme,
  initialSection = "profile",
}: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [applications, setApplications] = useState<OrganizerApplicationView[]>([]);
  const [latestAppeal, setLatestAppeal] = useState<OrganizerAppealView | null>(null);
  const [appeals, setAppeals] = useState<OrganizerAppealView[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [section, setSection] = useState<SectionId>(initialSection);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onConfirm: () => void }) | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const loadOrganizer = useCallback(() => {
    authClient
      .organizerStatus()
      .then((s) => {
        setIsOrganizer(s.isOrganizer);
        setApplications(s.applications);
        setLatestAppeal(s.latestAppeal ?? null);
        setAppeals(s.appeals ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    authClient
      .me()
      .then(setMe)
      .catch(() => setLoadFailed(true));
    loadOrganizer();
  }, [loadOrganizer]);

  /**
   * Whether our history entry is currently on the stack. A ref, not state, because it has to stay
   * accurate across React's development double-invocation of effects — which is also why the entry
   * is never touched from an effect cleanup (doing so pushed a `popstate` at the remounted listener
   * and the screen closed itself the instant it opened).
   */
  const pushedRef = useRef(false);

  /** True while a `history.back()` we asked for is still in flight. */
  const leavingRef = useRef(false);

  /**
   * Give our history entry back, *then* let the caller navigate.
   *
   * The order is the whole point. `history.back()` is asynchronous: the entry is not gone when the
   * call returns, it is gone one task later. The previous version fired it and navigated in the
   * same tick, so the parent's `replace` overwrote the entry we were still standing on and the
   * `popstate` that arrived afterwards walked the reader straight back onto `/account` — which is
   * what made "Quay lại" look broken.
   *
   * `leavingRef` keeps the screen's own `popstate` listener out of the way while that happens,
   * otherwise the same event would fire a second, competing close.
   */
  const leave = useCallback((after: () => void) => {
    if (!pushedRef.current || !window.history.state?.tixAccount) {
      pushedRef.current = false;
      after();
      return;
    }
    pushedRef.current = false;
    leavingRef.current = true;
    const onPop = () => {
      window.removeEventListener("popstate", onPop);
      leavingRef.current = false;
      after();
    };
    window.addEventListener("popstate", onPop);
    window.history.back();
  }, []);

  /** Guarded close: unsaved edits are worth one question (principle: recoverability). */
  const requestClose = useCallback(() => {
    if (!dirtyRef.current) {
      leave(onClose);
      return;
    }
    setConfirm({
      title: "Bỏ thay đổi chưa lưu?",
      message: "Bạn đã sửa hồ sơ nhưng chưa lưu. Rời khỏi trang này sẽ bỏ những thay đổi đó.",
      confirmLabel: "Bỏ thay đổi",
      cancelLabel: "Ở lại",
      tone: "danger",
      onConfirm: () => leave(onClose),
    });
  }, [leave, onClose]);

  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  /** Same guard for moving between sections — the edited form unmounts either way. */
  const selectSection = (next: SectionId) => {
    if (next === section) return;
    if (!dirtyRef.current) {
      setSection(next);
      return;
    }
    setConfirm({
      title: "Bỏ thay đổi chưa lưu?",
      message: "Bạn đã sửa hồ sơ nhưng chưa lưu. Chuyển sang mục khác sẽ bỏ những thay đổi đó.",
      confirmLabel: "Bỏ thay đổi",
      cancelLabel: "Ở lại",
      tone: "danger",
      onConfirm: () => setSection(next),
    });
  };

  /**
   * Leaving for another page of the site — the rail's Vé and Ví rows.
   *
   * Same guard as a section switch, because the unsaved form is lost either way, and the same
   * `leave` as the close paths so the history entry this screen pushed is handed back instead of
   * stranding a dead Back press on the page we navigate to.
   */
  const goToPage = (action: () => void) => {
    if (!dirtyRef.current) {
      leave(action);
      return;
    }
    setConfirm({
      title: "Bỏ thay đổi chưa lưu?",
      message: "Bạn đã sửa hồ sơ nhưng chưa lưu. Rời khỏi trang này sẽ bỏ những thay đổi đó.",
      confirmLabel: "Bỏ thay đổi",
      cancelLabel: "Ở lại",
      tone: "danger",
      onConfirm: () => leave(action),
    });
  };

  // Browser Back closes the screen instead of leaving the site. The cleanup only detaches the
  // listener: history is mutated exclusively from user-initiated paths, never from here.
  useEffect(() => {
    if (!pushedRef.current) {
      window.history.pushState({ tixAccount: true }, "");
      pushedRef.current = true;
    }
    const onPop = () => {
      // Our own `leave` asked for this one and is already handling it.
      if (leavingRef.current) return;
      // Back has already dropped our entry.
      pushedRef.current = false;
      if (dirtyRef.current) {
        // The close is only a question here, so put the entry back — otherwise answering "Ở lại"
        // would leave the next Back exiting the site.
        window.history.pushState({ tixAccount: true }, "");
        pushedRef.current = true;
      }
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Escape closes; Tab cycles inside the dialog (principle: user diversity — keyboard only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirm) {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  // The page behind must not scroll under the dialog, and focus starts inside it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const restoreTo = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.body.style.overflow = previous;
      restoreTo?.focus?.();
    };
  }, []);

  /** Newest first, so the head is the one that decides what the organizer card shows. */
  const latest = applications[0] ?? null;

  const handleSaved = (user: Me, message: string) => {
    setMe(user);
    onProfileUpdated(user);
    setErr(null);
    setNotice(message);
  };

  const notify = (message: string) => {
    setErr(null);
    setNotice(message);
  };
  const fail = (message: string) => {
    setNotice(null);
    setErr(message);
  };

  const confirmLogout = () =>
    setConfirm({
      title: "Đăng xuất?",
      message: "Bạn sẽ cần đăng nhập lại trên thiết bị này để mua vé.",
      confirmLabel: "Đăng xuất",
      cancelLabel: "Ở lại",
      tone: "danger",
      onConfirm: () => leave(onLogout),
    });

  const confirmLogoutAll = () =>
    setConfirm({
      title: "Đăng xuất khỏi mọi thiết bị?",
      message:
        "Mọi phiên đăng nhập của tài khoản này sẽ bị thu hồi, kể cả thiết bị bạn đang dùng. Bạn sẽ phải đăng nhập lại.",
      confirmLabel: "Đăng xuất tất cả",
      cancelLabel: "Hủy",
      tone: "danger",
      onConfirm: () => leave(onLogoutAll),
    });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-xanh-pho text-beige-kem">
      {/*
        Gutters only, no centred max-width: this reads as a dashboard that fills its window. The
        earlier 1152px cap left roughly 380px of dead space on each side of a 1920px screen.
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-10"
      >
        {/*
          The masthead every other page of the site wears: a quiet text Back above the title, the
          title itself in the display face, uppercase, over one hairline rule. It used to be a
          sentence-case heading beside a bordered button, which made this the only screen where
          "back" was a boxed control and the only one whose title was set two steps down the scale.

          Nothing rides the right of the rule: the address was printed there for a moment and it was
          the profile card repeating itself two hundred pixels higher up.
        */}
        <div>
          <button
            type="button"
            onClick={() => goToPage(onGoHome)}
            className="font-meta text-meta text-ink-soft transition hover:text-beige-kem"
          >
            ← Quay về trang chủ
          </button>
          <div className="mt-4 border-b border-beige-kem/30 pb-5">
            <h1
              id="account-title"
              className="font-display text-title-m font-black uppercase leading-none tracking-[0.02em] text-beige-kem sm:text-title-l"
            >
              Tài khoản
            </h1>
          </div>
        </div>

        {/* One live region for both outcomes, so a screen reader announces either without duplicates. */}
        <div aria-live="polite" className="mt-4 space-y-2 empty:mt-0">
          {notice && (
            <div className="flex items-start gap-2 border-l-2 border-la-co bg-la-co/10 p-3 text-eyebrow leading-5 text-beige-kem">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {notice}
            </div>
          )}
          {err && (
            <div
              role="alert"
              className="flex items-start gap-2 border-l-2 border-burgundy bg-bubblegum/25 p-3 text-eyebrow leading-5 text-beige-kem"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burgundy-ink" aria-hidden />
              {err}
            </div>
          )}
        </div>

        <div className="mt-5 gap-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
          {/* Menu selection for navigation: little typing, hard to get wrong (lecture, slide 14). */}
          <nav
            aria-label="Mục tài khoản"
            className="ticket-corners bg-beige-kem/[0.05] p-3 lg:sticky lg:top-10"
          >
            {/*
              The overlay covers the site header, so the wordmark is what keeps the screen anchored
              to TixHub — same face, weight and tracking the header sets it in, one size up because
              here it has a rail to head rather than a hero to float over.

              The "Music / Stage / Film" strapline that used to sit under it is gone. The header
              dropped it, and a wordmark identifies the site; it does not have to describe it.

              The theme switch sits at the other end of the same line, where the header keeps it —
              on the stub, beside the account. It has to be somewhere on this screen: the header is
              underneath the overlay, and its switch is the only one the site has.
            */}
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-beige-kem/25 px-2 pb-3">
              <p className="font-display text-title-s font-black leading-none tracking-normal text-beige-kem">
                TixHub
              </p>
              <button
                type="button"
                onClick={onToggleTheme}
                title={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
                aria-label={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
                className="grid h-9 w-9 shrink-0 place-items-center text-ink-soft transition hover:bg-bubblegum/25 hover:text-beige-kem"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" aria-hidden />
                ) : (
                  <MoonStar className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>

            {/*
              Two groups, one scrolling row below `lg` and one column above it: the sections of this
              page, then the two pages it links out to. The divider turns with them — a vertical
              hairline between the groups on a phone, a horizontal one on the desktop rail.
            */}
            <div className="flex gap-1 overflow-x-auto lg:block lg:overflow-visible">
              <ul className="flex gap-1 lg:flex-col">
                {SECTIONS.map(({ id, label, icon: Icon }) => {
                  const active = section === id;
                  return (
                    <li key={id} className="shrink-0 lg:shrink">
                      <button
                        type="button"
                        onClick={() => selectSection(id)}
                        aria-current={active ? "page" : undefined}
                        className={railRow(active)}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div
                className="mx-1 w-px shrink-0 bg-beige-kem/25 lg:mx-0 lg:my-3 lg:h-px lg:w-auto"
                aria-hidden
              />

              <ul className="flex gap-1 lg:flex-col">
                {SHORTCUTS.map(({ id, label, icon: Icon }) => (
                  <li key={id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => goToPage(id === "wallet" ? onViewWallet : onViewTickets)}
                      className={railRow(false)}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {label}
                      {/* The rows above stay here; these leave, and the chevron is what says so. */}
                      <span className="ml-auto hidden text-meta text-ink-soft lg:inline" aria-hidden>
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ending the session is not a destination, so it sits under its own rule. */}
            <div className="mt-3 hidden border-t border-beige-kem/25 pt-3 lg:block">
              <button
                type="button"
                onClick={confirmLogout}
                className="flex h-11 w-full items-center gap-2.5 px-3.5 font-display text-body font-bold uppercase tracking-[0.04em] text-ink-soft transition hover:bg-bubblegum/25 hover:text-beige-kem"
              >
                <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                Đăng xuất
              </button>
            </div>
          </nav>

          <div className="mt-4 space-y-4 lg:mt-0">
            {loadFailed && !me && (
              <div
                role="alert"
                className="ticket-corners border-l-2 border-burgundy bg-bubblegum/25 p-5 text-body leading-6 text-beige-kem"
              >
                Không tải được thông tin tài khoản. Kiểm tra kết nối rồi thử lại.
              </div>
            )}

            {!me && !loadFailed && (
              <div className="space-y-3" aria-hidden>
                <div className="ticket-corners h-24 animate-pulse bg-beige-kem/[0.05]" />
                <div className="ticket-corners h-40 animate-pulse bg-beige-kem/[0.05]" />
              </div>
            )}

            {me && section === "profile" && (
              <ProfileSection
                me={me}
                onSaved={handleSaved}
                onError={fail}
                onDirtyChange={setDirty}
              />
            )}
            {me && section === "security" && (
              <SecuritySection
                me={me}
                onNotice={notify}
                onError={fail}
                onConfirmLogoutAll={confirmLogoutAll}
              />
            )}
            {me && section === "organizer" && (
              <OrganizerSection
                isOrganizer={isOrganizer}
                latest={latest}
                latestAppeal={latestAppeal}
                appeals={appeals}
                onApplied={loadOrganizer}
                onNotice={notify}
                onError={fail}
                onManageEvents={() => leave(onManageEvents)}
              />
            )}

            <button
              type="button"
              onClick={confirmLogout}
              className={`${btnSecondary} w-full lg:hidden`}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Đăng xuất
            </button>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onConfirm={() => {
            const run = confirm.onConfirm;
            setConfirm(null);
            run();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
