/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The unsaved create-event form, kept across reloads.
 *
 * Until an event is submitted there is no server row to hold the organizer's work, and everything
 * they had typed — title, venue, description, the lot — died on a refresh with no warning at all.
 * The inversion was hard to defend: the seat-selection screen warns a buyer before leaving a page
 * where they have selected nothing, while a half-filled event form was discarded in silence.
 *
 * So the gap before the draft exists is covered here, and the moment it does exist the server row
 * takes over and this is cleared. Restoring is OFFERED, never automatic: someone who abandoned an
 * event on purpose should not find it typed back in for them.
 *
 * Files are deliberately absent. A `File` cannot be serialised, and a restore that silently dropped
 * the banner while bringing the text back would be worse than one that admits it — the caller says
 * so in the restore prompt.
 */

export interface CreateEventDraft {
  title: string;
  description: string;
  category: string;
  eventType: "seated" | "general_admission";
  venueName: string;
  venueAddress: string;
  city: string;
  /** When it was written, so a stale draft can be described rather than just offered. */
  savedAt: string;
}

const PREFIX = "tixhub:create-event-draft:v1";

/**
 * The store, or null where there isn't one.
 *
 * Guarded the way `sectionFromUrl` in the page is guarded: this module is imported during a render
 * that may have no DOM behind it, and a draft is a convenience — never a reason for the form to
 * fail to load.
 */
function store(): Storage | null {
  try {
    return typeof globalThis !== "undefined" && globalThis.localStorage
      ? globalThis.localStorage
      : null;
  } catch {
    // Access itself throws when cookies/storage are blocked.
    return null;
  }
}

/**
 * Per account, so two organizers sharing a browser cannot inherit each other's half-written event.
 * The email is already in `localStorage` under its own key; this only reuses it as a namespace.
 */
function keyFor(): string {
  const who = store()?.getItem("tixhub_user_email_v1") || "anon";
  return `${PREFIX}:${who}`;
}

/** Whether anything worth keeping has been typed. An untouched form must not leave a draft behind. */
export function isWorthSaving(draft: Omit<CreateEventDraft, "savedAt">): boolean {
  return Boolean(
    draft.title.trim() ||
      draft.description.trim() ||
      draft.venueName.trim() ||
      draft.venueAddress.trim(),
  );
}

export function saveDraft(draft: Omit<CreateEventDraft, "savedAt">): void {
  try {
    if (!isWorthSaving(draft)) {
      clearDraft();
      return;
    }
    const payload: CreateEventDraft = { ...draft, savedAt: new Date().toISOString() };
    store()?.setItem(keyFor(), JSON.stringify(payload));
  } catch {
    // A full or disabled storage must never break the form it is trying to protect.
  }
}

/** The stored draft, or null. Anything unparseable is treated as absent and swept away. */
export function loadDraft(): CreateEventDraft | null {
  try {
    const raw = store()?.getItem(keyFor());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreateEventDraft>;
    if (typeof parsed?.title !== "string") {
      clearDraft();
      return null;
    }
    return {
      title: parsed.title ?? "",
      description: parsed.description ?? "",
      category: parsed.category ?? "music",
      eventType: parsed.eventType === "general_admission" ? "general_admission" : "seated",
      venueName: parsed.venueName ?? "",
      venueAddress: parsed.venueAddress ?? "",
      city: parsed.city ?? "TP.HCM",
      savedAt: parsed.savedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    store()?.removeItem(keyFor());
  } catch {
    // Nothing to do: the draft is already unreachable.
  }
}
