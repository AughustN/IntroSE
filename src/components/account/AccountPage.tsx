/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertTriangle, CheckCircle2, LogOut, ShieldCheck, Store, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "@/shared/auth/types";
import type { OrganizerApplicationView } from "../../services/authClient";
import { authClient } from "../../services/authClient";
import { DEFAULT_AVATAR_FG, avatarColor } from "../../services/defaultAvatar";
import ConfirmDialog, { ConfirmRequest } from "../ConfirmDialog";
import OrganizerSection from "./OrganizerSection";
import ProfileSection from "./ProfileSection";
import SecuritySection from "./SecuritySection";
import { btnSecondary } from "./primitives";

interface Props {
  onClose: () => void;
  onLogout: () => void;
  /** Revokes every session for the account, this device included. */
  onLogoutAll: () => void;
  onProfileUpdated: (user: Me) => void;
  onManageEvents: () => void;
}

type SectionId = "profile" | "security" | "organizer";

const SECTIONS: { id: SectionId; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Hồ sơ", icon: User },
  { id: "security", label: "Bảo mật", icon: ShieldCheck },
  { id: "organizer", label: "Nhà tổ chức", icon: Store },
];

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
}: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [applications, setApplications] = useState<OrganizerApplicationView[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [section, setSection] = useState<SectionId>("profile");
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

  /** Drops our history entry, if any, so leaving does not cost the user a dead Back press. */
  const consumeHistoryEntry = useCallback(() => {
    if (!pushedRef.current) return;
    pushedRef.current = false;
    if (window.history.state?.tixAccount) window.history.back();
  }, []);

  /** Leave for good: give the entry back, then let the parent unmount us. */
  const leave = useCallback(
    (after: () => void) => {
      consumeHistoryEntry();
      after();
    },
    [consumeHistoryEntry],
  );

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

  // Browser Back closes the screen instead of leaving the site. The cleanup only detaches the
  // listener: history is mutated exclusively from user-initiated paths, never from here.
  useEffect(() => {
    if (!pushedRef.current) {
      window.history.pushState({ tixAccount: true }, "");
      pushedRef.current = true;
    }
    const onPop = () => {
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

  const initial = (me?.nickname || me?.email || "?").charAt(0).toUpperCase();

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
        className="w-full px-4 py-5 sm:px-6 sm:py-7 lg:px-8"
      >
        <div className="flex items-center justify-between gap-4 border-b border-beige-kem/25 pb-4">
          <h2 id="account-title" className="font-display text-2xl font-black sm:text-3xl">
            Tài khoản
          </h2>
          <button
            onClick={requestClose}
            className="grid h-10 place-items-center rounded-xl border-2 border-beige-kem px-4 font-mono text-[11px] font-bold uppercase text-beige-kem/80 transition hover:text-beige-kem"
          >
            ← Quay lại
          </button>
        </div>

        {/* One live region for both outcomes, so a screen reader announces either without duplicates. */}
        <div aria-live="polite" className="mt-4 space-y-2 empty:mt-0">
          {notice && (
            <div className="flex items-start gap-2 rounded-xl border-2 border-beige-kem bg-la-co p-3 text-xs leading-5 text-on-tint">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {notice}
            </div>
          )}
          {err && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border-2 border-beige-kem bg-bubblegum p-3 text-xs leading-5 text-on-tint"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burgundy" aria-hidden />
              {err}
            </div>
          )}
        </div>

        <div className="mt-5 gap-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
          {/* Menu selection for navigation: little typing, hard to get wrong (lecture, slide 14). */}
          <nav
            aria-label="Mục tài khoản"
            className="rounded-2xl border-2 border-beige-kem bg-surface-2 p-3 shadow-hard shadow-black/20 lg:sticky lg:top-10"
          >
            {/*
              The overlay covers the site header, so the wordmark is what keeps the screen anchored
              to TixHub. Same treatment as the header, one size down.
            */}
            <div className="mb-3 border-b border-beige-kem/25 px-2 pb-3">
              <p className="font-display text-xl font-black leading-none text-beige-kem">TixHub</p>
              <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
                Music / Stage / Film
              </p>
            </div>

            <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {SECTIONS.map(({ id, label, icon: Icon }) => {
                const active = section === id;
                return (
                  <li key={id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => selectSection(id)}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 text-sm font-bold transition ${
                        active
                          ? "bg-cam-dat text-on-tint"
                          : "text-beige-kem/70 hover:bg-surface-2 hover:text-beige-kem"
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-2.5 hidden h-6 w-0.5 rounded-full bg-cam-dat lg:block"
                          aria-hidden
                        />
                      )}
                      <Icon
                        className={`h-4 w-4 shrink-0 ${active ? "text-ink-soft" : ""}`}
                        aria-hidden
                      />
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* User chip pinned at the foot of the rail, as in the reference design. */}
            <div className="mt-3 hidden border-t border-beige-kem/25 pt-3 lg:block">
              <div className="flex items-center gap-2.5 px-1">
                {me?.avatarUrl ? (
                  <img
                    src={me.avatarUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs font-black"
                    style={{ backgroundColor: avatarColor(me?.email), color: DEFAULT_AVATAR_FG }}
                    aria-hidden
                  >
                    {initial}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-beige-kem">
                    {me?.nickname || me?.email || "Đang tải…"}
                  </p>
                  <p className="truncate font-mono text-[10px] text-beige-kem/70">
                    {me?.email ?? "…"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={confirmLogout}
                className="mt-3 flex h-10 w-full items-center gap-2.5 rounded-xl px-3.5 text-sm font-bold text-ink-soft transition hover:bg-bubblegum hover:text-on-tint"
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
                className="rounded-2xl border-2 border-beige-kem bg-bubblegum p-5 text-sm leading-6"
              >
                Không tải được thông tin tài khoản. Kiểm tra kết nối rồi thử lại.
              </div>
            )}

            {!me && !loadFailed && (
              <div className="space-y-3" aria-hidden>
                <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
                <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />
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
