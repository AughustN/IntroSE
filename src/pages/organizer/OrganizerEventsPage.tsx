import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Armchair, ArrowLeft, BarChart3, Calendar, Megaphone } from "lucide-react";
import AdPackagesPanel from "../../components/organizer/AdPackagesPanel";
import OrganizerConsole from "../../components/organizer/OrganizerConsole";
import EventFlowRail from "../../components/organizer/EventFlowRail";
import ShowtimeList from "../../components/organizer/ShowtimeList";
import SeatMapBuilder from "../../components/SeatMapBuilder";
import { flowSteps } from "../../components/organizer/flowSteps";
import {
  organizerApi,
  type ManageShowtime,
  type MyEvent,
  type MyVenue,
} from "../../services/catalogClient";
import {
  createDraftEvent,
  uploadEventBannerFile,
  uploadEventTrailerFile,
} from "../../services/organizerClient";
import { aiClient, type ListingSuggestion } from "../../services/aiClient";
import { OrganizerBusinessAnalytics } from "../../components/account/OrganizerBusinessAnalytics";
import { MediaDropzone } from "../../components/common/MediaDropzone";
import { useEventCategories } from "../../hooks/useEventCategories";
import { Refusal } from "../../components/organizer/states";
import { formatVnd, formatVndShort } from "../../services/currency";
import { fetchOrganizerAnalytics } from "../../services/organizerAnalyticsClient";
import type { OrganizerAnalyticsOverview } from "@/shared/types/analytics";
import { VN_PROVINCES, type VnProvince } from "../../vnProvinces";
import {
  clearDraft,
  isWorthSaving,
  loadDraft,
  saveDraft,
  type CreateEventDraft,
} from "./createEventDraft";

const UPCOMING_HINT = "Thêm ít nhất một suất chiếu sắp diễn trước khi tiếp tục.";

/** Future-dated showtimes only — the same definition of "upcoming" the publish rail uses. */
const upcomingOf = (rows: ManageShowtime[]) =>
  rows.filter((st) => new Date(st.startsAt).getTime() > Date.now());

export const OrganizerEventsPage: React.FC<{
  /** From `/organizer/events/:id` — which event the console should open at, if the URL names one. */
  openEventId?: number | null;
}> = ({ openEventId = null }) => {
  const navigate = useNavigate();

  // Top-Level Workspace Section:"analytics"(Thống kê kinh doanh),"events"(Quản lý sự kiện) or
  //"ads"(Gói quảng cáo).
  /**
   * Creating is its own section, not a mode of the events list.
   *
   * It used to be an `activeTab` inside "events", so pressing "Tạo sự kiện" left the nav highlighting
   * "Sự kiện" — the section that lists what you have ALREADY made — while showing a blank form. Two
   * different destinations wearing one label. A section of its own gives it its own URL, its own
   * highlight, and a Back press that means what it looks like.
   */
  type Section = "events" | "analytics" | "ads" | "create";

  // Read once, here, so the initial render and a Back press cannot disagree about which section the
  // URL names. Anything unrecognised falls back to"analytics", which is the section with no param.
  const sectionFromUrl = (): Section => {
    if (typeof window === "undefined") return "analytics";
    const value = new URLSearchParams(window.location.search).get("section");
    return value === "events" || value === "ads" || value === "create" ? value : "analytics";
  };

  // A URL that names an event is asking for the events section, whatever `?section=` says (a deep
  // link to `/organizer/events/7` carries no query at all, and would otherwise open on analytics
  // with the console it just asked for nowhere on screen).
  const [activeSection, setActiveSection] = useState<Section>(() =>
    openEventId !== null ? "events" : sectionFromUrl(),
  );

  useEffect(() => {
    const handlePopState = () => setActiveSection(sectionFromUrl());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleSectionSwitch = (section: Section) => {
    setActiveSection(section);
    // Entering the create page always starts a FRESH wizard: a previous session's draft pipeline
    // (its event id, its loaded showtimes) must not leak into it.
    if (section === "create") {
      setCreateStep(0);
      setCreated(null);
      setWizardEvent(null);
      setWizardRows(null);
      setSetupVenues(null);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    window.history.replaceState(null, "", url.toString());
  };

  // The server-backed console (feature 006) owns the event list and its drill-down — event →
  // editor → showtimes → tiers — while this page keeps the shell (analytics / ads) and the create
  // form around it. State below is therefore console plumbing, not its own copy of the portfolio.

  // Which event is open in the console (level 2+), or null for the list. Seeded from the URL so
  // `/organizer/events/:id` is a real deep link — that address used to render a separate, superseded
  // event screen, and this is what replaced it rather than dropping the link on the floor.
  const [selectedEventId, setSelectedEventId] = useState<number | null>(openEventId);

  /*
   * A later navigation to a different `/organizer/events/:id` has to move the console too.
   *
   * Adjusted during render against the previous URL value rather than synced in an effect: React
   * re-runs this pass before committing anything to the DOM, so the console never paints the old
   * event first and corrects itself afterwards — which is both the visible flicker and what
   * `react-hooks/set-state-in-effect` is warning about.
   *
   * Only a non-null id follows the URL. Returning to the bare list is the console's own business
   * (its Back button sets null), and mirroring that here would slam it shut again on every render.
   */
  const [urlEventSeen, setUrlEventSeen] = useState<number | null>(openEventId);
  if (openEventId !== null && openEventId !== urlEventSeen) {
    setUrlEventSeen(openEventId);
    setSelectedEventId(openEventId);
  }

  /**
   * The other direction: opening or closing an event moves the address bar to match.
   *
   * `pushState`, not `replaceState` — drilling into an event is a step a Back press should undo,
   * which is also what makes the console's own "← Danh sách sự kiện" and the browser's Back agree
   * instead of doing two different things.
   */
  const setUrlEvent = (id: number | null) => {
    const next = id === null ? "/organizer/events" : `/organizer/events/${id}`;
    if (window.location.pathname !== next) window.history.pushState(null, "", next);
  };
  /** Bumped after a create (or a seat-map apply) so the console refetches. */
  const [reloadKey, setReloadKey] = useState(0);
  /** The overlay `SeatMapBuilder` runs for this event, or null if closed. */
  const [seatMapEventId, setSeatMapEventId] = useState<number | null>(null);

  /*
   * The fork a fresh SEATED draft lands on.
   *
   * Its real next move is genuinely either half of the chain: dates need no chart, and the venue
   * chart needs no dates — drawing it is pure geometry over the venue the form just created. The
   * console used to choose for the organizer (always dates), which left chart design a button they
   * had to already know about. `chartLayoutFor` carries what option B opened plus the event to land
   * on when the editor closes.
   */
  /*
   * The draft a finished three-page form produced, and the SETUP data that follows it.
   *
   * Non-null turns this page into the rest of creation: showtimes and tiers (stage 4), the seat
   * chart for a seated event (stage 5), then the readiness summary with its one commit button
   * (stage 6). The management console used to be where all of that lived — which is why finishing
   * page three dumped the organizer there to keep working; now it is only where they go to look,
   * or to come back and edit.
   */
  const [created, setCreated] = useState<{
    eventId: number;
    venueId: number;
    eventType: "seated" | "general_admission";
  } | null>(null);
  const [setupVenues, setSetupVenues] = useState<MyVenue[] | null>(null);
  const [wizardEvent, setWizardEvent] = useState<MyEvent | null>(null);
  const [wizardRows, setWizardRows] = useState<ManageShowtime[] | null>(null);
  const [publishing, setPublishing] = useState(false);

  /*
   * The create form is a WIZARD of pages, not one long scroll.
   *
   * Every field the old single page asked for sat above the fold's horizon twice over — media and
   * venue were a full viewport apart from the title they belong with. Pages 1–3 create the DRAFT;
   * once `created` is set the stepper grows past them into the rest of the chain, each page
   * gate-checked before "Tiếp tục" so a missing banner surfaces on its own page instead of as a
   * submit-time refusal three screens later.
   */
  const [createStep, setCreateStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  // Create Event Form State
  const [createTitle, setCreateTitle] = useState("");
  /**
   * Which kind of event this becomes.
   *
   * Both kinds now submit the same way — a draft plus its venue — and finish in the console's rail.
   * The difference is only what the rail then asks for: general admission needs a showtime and its
   * tiers, a seated show needs a chart applied on top of that.
   */
  const [createEventType, setCreateEventType] = useState<"seated" | "general_admission">("seated");
  const categories = useEventCategories();
  const [createCategory, setCreateCategory] = useState("music");
  /*
   * Keep the selection on a code that actually exists.
   *
   * `music` is a real code and a safe initial value, but it is not guaranteed to survive an Admin
   * editing the category list. Snapping once the list arrives — during render, so the select never
   * paints a value the server would reject — is what stops this form from ever again submitting a
   * category that does not exist.
   */
  const [categoriesSeen, setCategoriesSeen] = useState(0);
  if (categories.length !== categoriesSeen) {
    setCategoriesSeen(categories.length);
    if (categories.length > 0 && !categories.some((c) => c.code === createCategory)) {
      setCreateCategory(categories[0].code);
    }
  }
  const [createPictureUrl, setCreatePictureUrl] = useState("");
  const [createVideoUrl, setCreateVideoUrl] = useState("");
  const [stagedBannerFile, setStagedBannerFile] = useState<File | null>(null);
  const [stagedTrailerFile, setStagedTrailerFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createVenueName, setCreateVenueName] = useState("");
  const [createVenueAddress, setCreateVenueAddress] = useState("");
  const [createCity, setCreateCity] = useState<VnProvince>("TP.HCM");
  const [createDescription, setCreateDescription] = useState("");

  const [toastMsg, setToastMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );
  /** The one required field checked in JS rather than by the browser — see `handleCreateEventSubmit`. */
  const [mediaRefusal, setMediaRefusal] = useState<string | null>(null);

  /*
   * Account-wide sales for the header strip.
   *
   * Called with no filters, which is what makes it account-level rather than the filtered view the
   * analytics section shows. Failure leaves it null and the strip shows dashes: a header that cannot
   * reach the numbers must not stop the organizer reaching their events.
   */
  const [overview, setOverview] = useState<OrganizerAnalyticsOverview | null>(null);
  useEffect(() => {
    let alive = true;
    fetchOrganizerAnalytics({})
      .then((d) => alive && setOverview(d.overview ?? null))
      .catch(() => alive && setOverview(null));
    return () => {
      alive = false;
    };
  }, []);
  /** How many events are actually on sale — the third figure, and the one the list cannot show. */
  const [liveEventCount, setLiveEventCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    organizerApi
      .myEvents()
      .then(
        (rows) =>
          alive &&
          setLiveEventCount(
            rows.filter((e) => e.status === "on_sale" && e.moderation === "approved").length,
          ),
      )
      .catch(() => alive && setLiveEventCount(null));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  /*
   * Unsaved-work protection for the create form.
   *
   * `recoverable` is read ONCE at mount, before anything is typed, so the offer reflects what was
   * left behind on a previous visit rather than what is being typed now. Dismissing it — by
   * restoring or discarding — is the only thing that clears it.
   */
  const [recoverable, setRecoverable] = useState<CreateEventDraft | null>(() => loadDraft());

  const draftNow = {
    title: createTitle,
    description: createDescription,
    category: createCategory,
    eventType: createEventType,
    venueName: createVenueName,
    venueAddress: createVenueAddress,
    city: createCity,
  };
  const dirty = isWorthSaving(draftNow);

  // Debounced so typing does not hit storage on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(draftNow), 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    createTitle,
    createDescription,
    createCategory,
    createEventType,
    createVenueName,
    createVenueAddress,
    createCity,
  ]);

  /*
   * The browser's own "leave site?" prompt, and ONLY while there is something to lose.
   *
   * Deliberately gated on `dirty`. The seat-selection screen fires its guard even with nothing
   * selected, which teaches people to dismiss the dialog without reading it — the opposite of what a
   * warning is for.
   */
  useEffect(() => {
    if (!dirty || activeSection !== "create") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, activeSection]);

  // AI Description Assistant State
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<ListingSuggestion | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 5000);
  };

  const askAiDescriptionAssistant = async () => {
    if (!aiBrief.trim()) {
      showToast("error", "Vui lòng nhập ý tưởng/tóm tắt sự kiện trước khi nhờ AI gợi ý.");
      return;
    }
    setAiBusy(true);
    try {
      const res = await aiClient.eventAssistant({
        brief: aiBrief.trim(),
        category: createCategory,
        eventType: "general_admission",
      });
      setAiSuggestion(res.suggestion);
      showToast("success", "AI đã tạo gợi ý tiêu đề & mô tả thành công!");
    } catch (err: any) {
      showToast("error", err.message || "Không thể gọi AI gợi ý mô tả.");
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    if (aiSuggestion.title) setCreateTitle(aiSuggestion.title);
    if (aiSuggestion.description) setCreateDescription(aiSuggestion.description);
    // The AI also proposes ticket tiers, but tiers are no longer set on this form — they belong to
    // the showtime that sells them, one step later. Saying so beats applying nothing and letting the
    // organizer wonder where the prices went.
    const hasTierIdeas = (aiSuggestion.ticketPriceSuggestions?.length ?? 0) > 0;
    showToast(
      "success",
      hasTierIdeas
        ? "Đã áp dụng tiêu đề & mô tả. Giá vé sẽ đặt ở bước hạng vé."
        : "Đã áp dụng tiêu đề & mô tả từ AI.",
    );
  };

  /**
   * Empty the create form.
   *
   * One reset, not two. The seated and general-admission paths each used to clear their own subset,
   * and they disagreed — the seated one left `createVideoUrl` and the staged trailer behind, so a
   * trailer chosen for one event could be uploaded to the next.
   */
  const clearCreateForm = () => {
    setCreateTitle("");
    setCreateDescription("");
    setCreatePictureUrl("");
    setCreateVideoUrl("");
    setStagedBannerFile(null);
    setStagedTrailerFile(null);
    setCreateVenueName("");
    setCreateVenueAddress("");
  };

  /**
   * Create the event.
   *
   * ONE path, whichever kind of event this is. Both now produce the same thing — an event and its
   * venue, nothing sellable yet — and hand off to the console's rail, which already knows the rest:
   * four steps for general admission, the chart steps as well for a seated show.
   *
   * General admission used to submit venue + showtime + tiers in a single bundled call from this
   * form, which is why the form had grown to eleven fields across three screens and kept growing by
   * three per ticket tier. Dates and tiers live in `ShowtimeList`/`TierPanel` in the console, where a
   * seated organizer has always set them; collecting them here as well was a second source for the
   * same facts, and the longer of the two.
   */
  const handleCreateEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Attached to the control, not floated in the corner. The banner field can be a screen away
    // from the submit button, and a toast at the top-right leaves the organizer looking for what to
    // fix. Every other required field gets the browser's own field-anchored message; this one is
    // checked in JS, so it has to place its own.
    if (!createPictureUrl && !stagedBannerFile) {
      setMediaRefusal("Cần tải lên hình ảnh sự kiện trước khi tạo bản nháp.");
      document
        .getElementById("create-media")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setMediaRefusal(null);

    setIsCreating(true);
    try {
      const draft = await createDraftEvent({
        title: createTitle,
        // The server requires at least one character; the editor can refine it later.
        description: createDescription.trim() || createTitle,
        category: createCategory,
        eventType: createEventType,
        bannerUrl:
          createPictureUrl || "https://res.cloudinary.com/tixhub/image/upload/placeholder.webp",
        venueName: createVenueName,
        venueAddress: createVenueAddress,
        city: createCity,
      });

      if (stagedBannerFile) await uploadEventBannerFile(draft.eventId, stagedBannerFile);
      if (stagedTrailerFile) await uploadEventTrailerFile(draft.eventId, stagedTrailerFile);

      showToast("success", "Đã tạo bản nháp. Tiếp tục: thêm suất chiếu và hạng vé.");
      // The server row is the draft now; the local copy has done its job.
      clearDraft();
      setRecoverable(null);
      clearCreateForm();

      if (createEventType === "seated") {
        // Stay on THIS page: the draft was the entry fee, and stages 4–6 (showtimes → chart →
        // finish) open right here. The management console is where they go to LOOK later.
        setCreated({ eventId: draft.eventId, venueId: draft.venueId, eventType: "seated" });
      } else {
        setCreated({
          eventId: draft.eventId,
          venueId: draft.venueId,
          eventType: "general_admission",
        });
      }
      setCreateStep(3);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showToast("error", (err as Error).message || "Tạo sự kiện thất bại.");
    } finally {
      setIsCreating(false);
    }
  };

  /** The three pages of the wizard, in the order the organizer meets them. */
  const CREATE_STEP_LABELS = ["Thông tin chung", "Hình ảnh & địa điểm", "Mô tả"] as const;

  /** Forward through the wizard, gate-checking THIS page before the next one shows. */
  const advanceCreateStep = () => {
    setStepError(null);
    if (createStep === 0 && createTitle.trim().length < 3) {
      setStepError("Tên sự kiện phải từ 3 ký tự trở lên.");
      return;
    }
    // The banner is the submit handler's one hard media requirement; checking it HERE means the
    // refusal appears on the page where upload lives, not after two more pages of typing.
    if (createStep === 1 && !stagedBannerFile && !createPictureUrl.trim()) {
      setStepError("Hãy chọn hình ảnh sự kiện trước khi tiếp tục.");
      return;
    }
    // Same reasoning for the venue pair: their `required` attributes cannot fire from another page,
    // so this page owns its own completeness before the description page opens.
    if (createStep === 1 && (!createVenueName.trim() || !createVenueAddress.trim())) {
      setStepError("Hãy nhập tên địa điểm và địa chỉ chi tiết.");
      return;
    }
    // Stage 4 needs something to sell ON: no upcoming showtime, no point moving on — the chart and
    // the submit gate both hang off showtimes.
    if (createStep === 3 && upcomingOf(wizardRows ?? []).length === 0) {
      setStepError(UPCOMING_HINT);
      return;
    }
    setCreateStep((s) => Math.min(s + 1, wizardSteps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const retreatCreateStep = () => {
    setStepError(null);
    setCreateStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /**
   * The setup stages' data: venues for the showtime form, the draft as MyEvent, and its rows.
   * `refreshSetup` is for HANDLERS (a showtime saved, a chart applied); the effect owns its own
   * identical fetch with an `alive` guard, so its dependency list stays [created, reloadKey] and
   * no unstable identity drags it into re-running every render.
   */
  const refreshSetup = () => {
    if (!created) return;
    organizerApi
      .showtimesManage(created.eventId)
      .then(setWizardRows)
      .catch(() => setWizardRows(null));
  };

  useEffect(() => {
    if (!created) return;
    let alive = true;
    organizerApi
      .showtimesManage(created.eventId)
      .then((r) => alive && setWizardRows(r))
      .catch(() => alive && setWizardRows(null));
    organizerApi
      .myVenues()
      .then((v) => alive && setSetupVenues(v))
      .catch(() => alive && setSetupVenues([]));
    organizerApi
      .myEvents()
      .then((list) => alive && setWizardEvent(list.find((e) => e.id === created.eventId) ?? null))
      .catch(() => alive && setWizardEvent(null));
    return () => {
      alive = false;
    };
  }, [created, reloadKey]);

  /** Labels for the whole pipeline — pages 1–3 create the draft; the rest finish it. */
  const wizardSteps = created
    ? [
        ...CREATE_STEP_LABELS,
        "Suất chiếu & hạng vé",
        ...(created.eventType === "seated" ? ["Sơ đồ ghế"] : []),
        "Hoàn tất",
      ]
    : [...CREATE_STEP_LABELS];

  const setupSteps = wizardEvent ? flowSteps(wizardEvent, wizardRows) : [];
  const submitStep = setupSteps.find((s) => s.id === "submit") ?? null;
  /** Ready = every earlier gate passed AND this event has not been sent already. */
  const canSubmitForReview = submitStep?.state === "blocked" && submitStep.label === "Gửi duyệt";
  /** Where the last page sits for the CURRENT event type — seated carries the extra chart page. */
  const chartStageIndex = created?.eventType === "seated" ? 4 : null;
  const finishStageIndex = created ? 3 + (created.eventType === "seated" ? 2 : 1) : 5;

  const submitForReviewFromWizard = async () => {
    if (!created || !canSubmitForReview || publishing) return;
    setPublishing(true);
    setStepError(null);
    try {
      await organizerApi.publish(created.eventId);
      showToast("success", "Đã gửi duyệt. Sự kiện sẽ hiển thị sau khi quản trị viên phê duyệt.");
      setCreated(null);
      handleSectionSwitch("events");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setStepError((err as Error).message || "Gửi duyệt thất bại.");
    } finally {
      setPublishing(false);
    }
  };

  /*
   * The pinned transport bar, shared by the draft pages AND the setup stages — one definition so
   * the two halves of the wizard can never drift apart in look or behaviour. Its primary button
   * changes meaning by position: next / create-draft / send-for-review.
   */
  const transport = (
    <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t border-beige-kem/20 bg-surface-2 px-6 pb-1 pt-4 sm:-mx-8 sm:px-8">
      {stepError && <p className="mr-auto text-[11px] font-semibold text-burgundy">{stepError}</p>}
      <button
        type="button"
        onClick={() => handleSectionSwitch("events")}
        disabled={isCreating || publishing}
        className="px-5 py-2.5 bg-surface-2 hover:bg-beige-kem/10 text-beige-kem font-semibold transition-colors border border-beige-kem/30 disabled:opacity-50"
      >
        {/* Past page three nothing is discarded — the draft lives on the server; this just leaves. */}
        {created ? "Lưu & về quản lý" : "Hủy"}
      </button>
      {createStep > 0 && (
        <button
          type="button"
          onClick={retreatCreateStep}
          disabled={isCreating || publishing}
          className="px-5 py-2.5 bg-surface-2 hover:bg-beige-kem/10 text-beige-kem font-semibold transition-colors border border-beige-kem/30 disabled:opacity-50"
        >
          ← Quay lại
        </button>
      )}
      {createStep < wizardSteps.length - 1 ? (
        <button
          type="button"
          onClick={advanceCreateStep}
          disabled={isCreating || publishing}
          className="px-6 py-2.5 bg-burgundy hover:brightness-110 text-white font-bold transition-all disabled:opacity-50"
        >
          Tiếp tục →
        </button>
      ) : !created ? (
        <button
          type="submit"
          disabled={isCreating}
          className="px-6 py-2.5 bg-burgundy hover:brightness-110 text-white font-bold transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {isCreating ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
              />
              <span>Đang tải lên & tạo bản nháp…</span>
            </>
          ) : (
            "Tạo bản nháp & tiếp tục"
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void submitForReviewFromWizard()}
          disabled={!canSubmitForReview || publishing}
          title={
            canSubmitForReview
              ? undefined
              : "Hoàn tất các bước còn thiếu (xem danh sách bên trên) trước khi gửi duyệt."
          }
          className="px-6 py-2.5 bg-burgundy hover:brightness-110 text-white font-bold transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {publishing ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
              />
              <span>Đang gửi duyệt…</span>
            </>
          ) : (
            "Gửi duyệt"
          )}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-xanh-pho text-beige-kem p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 transition-colors duration-200">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 border text-xs font-medium flex items-center space-x-2 animate-bounce ${
            toastMsg.type === "success"
              ? "border-la-co bg-la-co/25 text-beige-kem"
              : "bg-burgundy text-white border-beige-kem"
          }`}
        >
          <span>{toastMsg.type === "success" ? "✓" : "✕"}</span>
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/*
        The workspace header.

        Three things were wrong with what this replaced, all of them visible the moment you looked at
        it. The row was a `justify-between` flex holding THREE children, so the "Sơ đồ ghế" button was
        stranded in the middle belonging to neither the title nor the tabs. A second tab bar sat
        directly underneath in a different visual language, giving two competing hierarchies with
        nothing to say which outranked the other. And the events section carried no numbers at all —
        which is the finding Universe's dashboard redesign turned on: organizers barely used theirs
        because it was an index of links rather than a report, and moving account-level sales above
        the event list is what fixed it.

        So: identity, then the numbers, then ONE row of sections. Creating an event is a primary
        action rather than a tab, which is how every platform surveyed treats it — and which is what
        lets the second bar disappear entirely.

        And creating now takes a PAGE of its own: while the wizard is up, none of this chrome —
        identity, numbers, section tabs, even the button that opened it — renders beside it. The only
        ways out are the wizard's own Hủy and the back arrow on the create page, both landing in the
        events console.
      */}
      {/*
        An OPEN EVENT takes a page of its own too (like creating does): the description screen and
        its editor render without the dashboard's identity, numbers, or section tabs above them —
        the event IS the page. The overview's "← Danh sách sự kiện" is the way back out.
      */}
      {activeSection !== "create" && !(activeSection === "events" && selectedEventId !== null) && (
        <header className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-meta text-meta uppercase tracking-widest text-ink-soft">
                Nhà tổ chức sự kiện
              </p>
              <h1 className="font-display text-2xl font-black tracking-tight text-beige-kem sm:text-3xl">
                Bảng điều khiển
              </h1>
            </div>

            <button
              type="button"
              onClick={() => handleSectionSwitch("create")}
              className="inline-flex shrink-0 items-center gap-2 bg-burgundy px-4 py-2.5 text-xs font-bold text-white transition hover:brightness-110"
            >
              <span aria-hidden>+</span> Tạo sự kiện
            </button>
          </div>

          {/*
          Account-level, not per-event: the question an organizer opens this page with is "how is it
          selling", and until now the only answer lived one tab away. Absent while loading rather than
          showing zeroes — a dash reads as "not known yet", a 0 reads as "you have sold nothing".
        */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              {
                label: "Doanh thu",
                value: overview ? formatVnd(overview.gross_revenue_vnd) : "—",
                shortValue: overview ? formatVndShort(overview.gross_revenue_vnd) : "—",
              },
              {
                label: "Vé đã bán",
                value: overview ? overview.total_tickets_sold.toLocaleString("vi-VN") : "—",
                shortValue: null,
              },
              { label: "Sự kiện đang mở bán", value: liveEventCount ?? "—", shortValue: null },
            ].map((k) => (
              <div key={k.label} className="bg-surface-2 p-4">
                <dt className="font-meta text-meta uppercase tracking-widest text-ink-soft">
                  {k.label}
                </dt>
                <dd className="mt-1 font-display text-title-s font-black tabular-nums text-beige-kem">
                  {k.shortValue === null ? (
                    k.value
                  ) : (
                    <>
                      <span className="sm:hidden">{k.shortValue}</span>
                      <span className="hidden sm:inline">{k.value}</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {/* One level of navigation. "Sơ đồ ghế" is a peer section, not a button floating beside the
            title — a chart belongs to a venue and backs many events, exactly like the others here. */}
          <nav
            aria-label="Khu vực quản lý"
            className="flex flex-wrap items-center gap-1 border-b border-beige-kem/20"
          >
            {(
              [
                {
                  key: "analytics",
                  label: "Thống kê kinh doanh",
                  shortLabel: "Thống kê",
                  Icon: BarChart3,
                },
                { key: "events", label: "Sự kiện", shortLabel: "Sự kiện", Icon: Calendar },
                { key: "seatmaps", label: "Sơ đồ ghế", shortLabel: "Sơ đồ", Icon: Armchair },
                { key: "ads", label: "Gói quảng cáo", shortLabel: "Quảng cáo", Icon: Megaphone },
              ] as const
            ).map(({ key, label, shortLabel, Icon }) => {
              const active = key !== "seatmaps" && activeSection === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() =>
                    key === "seatmaps"
                      ? navigate("/organizer/seatmaps")
                      : handleSectionSwitch(key as Section)
                  }
                  className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-colors sm:px-4 sm:text-sm ${
                    active
                      ? "border-burgundy text-beige-kem"
                      : "border-transparent text-ink-soft hover:text-beige-kem"
                  } ${key === "ads" ? "hidden sm:flex" : ""}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{shortLabel}</span>
                </button>
              );
            })}
          </nav>
        </header>
      )}

      {activeSection === "analytics" ? (
        <OrganizerBusinessAnalytics />
      ) : activeSection === "ads" ? (
        <AdPackagesPanel />
      ) : activeSection === "events" ? (
        <div className="space-y-6">
          {/* The server-backed 006 console: events → overview/editor → showtimes → tiers. */}
          {
            <OrganizerConsole
              selectedEventId={selectedEventId}
              onSelectEvent={(id) => {
                setSelectedEventId(id);
                // Keep the address bar honest, the way the chart editor does: opening an event is a
                // place you can link to, and Back out of, not a state hidden inside the page.
                setUrlEvent(id);
              }}
              onCreateRequested={() => handleSectionSwitch("create")}
              onOpenSeatMap={(eventId) => setSeatMapEventId(eventId)}
              reloadKey={reloadKey}
            />
          }
        </div>
      ) : (
        <div className="space-y-6">
          {/*
            The standalone page's own furniture: one way back and one title. No dashboard identity, no
            numbers, no section tabs — while this page is up it is the whole screen.
          */}
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <button
              type="button"
              onClick={() => handleSectionSwitch("events")}
              disabled={isCreating}
              className="flex items-center gap-2 text-xs font-bold text-beige-kem/70 transition-colors hover:text-beige-kem disabled:opacity-50"
            >
              {/* Borderless, matching `EventEditor`'s back link: an arrow and a label, because this
                  is navigation and not an action taken on the page. */}
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              Quản lý sự kiện
            </button>
            <h1 className="font-display text-lg font-black text-beige-kem">Tạo sự kiện mới</h1>
          </div>
          {
            <div className="bg-surface-2 border border-beige-kem/25 p-6 sm:p-8 max-w-3xl mx-auto space-y-6 transition-colors">
              {/*
                Offered, never applied automatically. Someone who walked away from an event on
                purpose should not find it typed back in for them — and the banner is named as NOT
                recovered, because a `File` cannot be stored and quietly losing it would be the one
                thing this feature is supposed to prevent.
              */}
              {recoverable && (
                <div className="flex flex-col gap-3 border border-cam-dat/60 bg-cam-dat/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-meta text-xs font-bold text-beige-kem">
                      Có một bản nháp chưa lưu
                      {recoverable.title.trim() ? `: “${recoverable.title.trim()}”` : "."}
                    </p>
                    <p className="mt-0.5 font-meta text-[11px] text-ink-soft">
                      Khôi phục phần đã nhập lần trước. Ảnh và video cần chọn lại.
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateTitle(recoverable.title);
                        setCreateDescription(recoverable.description);
                        setCreateCategory(recoverable.category);
                        setCreateEventType(recoverable.eventType);
                        setCreateVenueName(recoverable.venueName);
                        setCreateVenueAddress(recoverable.venueAddress);
                        setCreateCity(recoverable.city as VnProvince);
                        setRecoverable(null);
                      }}
                      className="border border-la-co bg-la-co/25 px-3 py-1.5 text-xs font-bold text-beige-kem"
                    >
                      Khôi phục
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearDraft();
                        setRecoverable(null);
                      }}
                      className="border border-beige-kem/40 px-3 py-1.5 text-xs font-bold text-beige-kem/80"
                    >
                      Bỏ qua
                    </button>
                  </div>
                </div>
              )}

              {!created && (
                <form onSubmit={handleCreateEventSubmit} className="space-y-5 text-xs">
                  {/*
                  The wizard's map. Rendered as numbered markers in EventFlowRail's visual language —
                  a numeral that becomes a tick — so progress reads the same way everywhere in this
                  console.
                */}
                  <ol
                    aria-label="Các bước tạo sự kiện"
                    className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    {wizardSteps.map((label, i) => (
                      <li key={label} className="flex items-center gap-2">
                        <span
                          aria-current={createStep === i ? "step" : undefined}
                          className={`grid h-6 w-6 place-items-center rounded-full border-2 font-bold ${
                            i < createStep
                              ? "border-la-co bg-la-co text-on-tint"
                              : createStep === i
                                ? "border-burgundy bg-burgundy/15 text-beige-kem"
                                : "border-beige-kem/25 text-beige-kem/45"
                          }`}
                        >
                          {i < createStep ? "✓" : i + 1}
                        </span>
                        <span
                          className={`font-semibold ${
                            createStep === i ? "text-beige-kem" : "text-beige-kem/50"
                          }`}
                        >
                          {label}
                        </span>
                        {i < wizardSteps.length - 1 && (
                          <span aria-hidden className="mx-1 h-px w-6 bg-beige-kem/25 sm:w-10" />
                        )}
                      </li>
                    ))}
                  </ol>

                  {/* ── Trang 1 · Thông tin chung ─────────────────────────────────────────────── */}
                  {createStep === 0 && (
                    <>
                      {/* Event type — decides which flow the submit follows (see `createEventType`). */}
                      <div>
                        <label className="block font-meta text-beige-kem font-semibold mb-1">
                          Hình thức bán vé
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setCreateEventType("seated")}
                            aria-pressed={createEventType === "seated"}
                            className={`border p-3 text-left transition-colors ${
                              createEventType === "seated"
                                ? "border-burgundy bg-burgundy/15"
                                : "border-beige-kem/30 hover:border-burgundy/50"
                            }`}
                          >
                            <span className="block font-bold text-beige-kem">
                              Có sơ đồ ghế — khách chọn chỗ
                            </span>
                            <span className="mt-1 block text-[11px] text-ink-soft">
                              Tạo bản nháp, rồi thêm suất chiếu, vẽ sơ đồ và gán hạng vé ở màn quản
                              lý.
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreateEventType("general_admission")}
                            aria-pressed={createEventType === "general_admission"}
                            className={`border p-3 text-left transition-colors ${
                              createEventType === "general_admission"
                                ? "border-burgundy bg-burgundy/15"
                                : "border-beige-kem/30 hover:border-burgundy/50"
                            }`}
                          >
                            <span className="block font-bold text-beige-kem">
                              Vé đại trà — không chọn chỗ
                            </span>
                            <span className="mt-1 block text-[11px] text-ink-soft">
                              Bán theo số lượng từng hạng vé, không cần sơ đồ. Tạo bản nháp, rồi
                              thêm suất chiếu và hạng vé ở màn quản lý.
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Title, then category — one field per row (NN/g: single column completes fastest). */}
                      <div className="space-y-5">
                        <div>
                          <label className="block font-meta text-beige-kem font-semibold mb-1">
                            Tên sự kiện
                          </label>
                          <input
                            type="text"
                            value={createTitle}
                            onChange={(e) => setCreateTitle(e.target.value)}
                            placeholder="Vd: Live Concert Mùa Hè 2026"
                            required
                            className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-3 text-beige-kem outline-none transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block font-meta text-beige-kem font-semibold mb-1">
                            Thể loại
                          </label>
                          {/*
                      Categories come from the database, not from a list typed here.

                      The four options this replaced were `music / art / conference / concert`, of
                      which only `music` is a real code — the other three failed the create outright
                      with `400 Danh mục không hợp lệ`, after the organizer had filled the whole form
                      and uploaded a banner. There are fourteen real categories, and an Admin can add
                      more (UC-35); any list compiled into the bundle is a stale second opinion, which
                      is exactly why `useEventCategories` exists.
                    */}
                          <select
                            value={createCategory}
                            onChange={(e) => setCreateCategory(e.target.value)}
                            className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-3 text-beige-kem outline-none transition-colors"
                          >
                            {categories.map((c) => (
                              <option key={c.code} value={c.code} className="bg-xanh-pho">
                                {c.labelVi}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Trang 2 · Hình ảnh & địa điểm ──────────────────────────────────────────── */}
                  {createStep === 1 && (
                    <>
                      {/* Media Upload Section: Picture (Required) & Video (Optional) */}
                      <div
                        id="create-media"
                        className="scroll-mt-24 space-y-4 border border-beige-kem/25 bg-xanh-pho p-4"
                      >
                        <h3 className="font-meta text-xs font-bold uppercase tracking-wider text-burgundy">
                          Hình ảnh & video
                        </h3>
                        <Refusal message={mediaRefusal} />

                        {/*
                    No `required` marker. On this form everything is required unless it says
                    "(tùy chọn)" — mark the few optional fields rather than the many required ones.
                    The prop only ever drew an asterisk (no `aria-required`, no input validation), so
                    dropping it costs nothing: the real check is in `handleCreateEventSubmit`, and it
                    reports through the `Refusal` above.
                  */}
                        <div>
                          <MediaDropzone
                            label="Hình ảnh sự kiện"
                            mediaType="banner"
                            currentUrl={createPictureUrl}
                            onFileSelected={(file) => setStagedBannerFile(file)}
                            helpText="Tỷ lệ 16:9"
                            aspectRatio="banner"
                            compact
                            disabled={isCreating}
                          />
                        </div>

                        {/* Optional Video Upload */}
                        <div>
                          <MediaDropzone
                            label="Video giới thiệu (tùy chọn)"
                            mediaType="trailer"
                            currentUrl={createVideoUrl}
                            onFileSelected={(file) => setStagedTrailerFile(file)}
                            onRemove={() => {
                              setStagedTrailerFile(null);
                              setCreateVideoUrl("");
                            }}
                            helpText="Tỷ lệ 16:9"
                            aspectRatio="video"
                            compact
                            disabled={isCreating}
                          />
                        </div>
                      </div>

                      {/* Venue and city stay side by side — the short, related pair NN/g exempts from the
                    single-column rule, and splitting them would only make the form taller. */}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <label className="block font-meta text-beige-kem font-semibold mb-1">
                            Tên địa điểm / nhà hát
                          </label>
                          <input
                            type="text"
                            value={createVenueName}
                            onChange={(e) => setCreateVenueName(e.target.value)}
                            placeholder="Vd: Nhà hát Hòa Bình"
                            required
                            className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-3 text-beige-kem outline-none"
                          />
                        </div>
                        <div>
                          <label className="block font-meta text-beige-kem font-semibold mb-1">
                            Thành phố
                          </label>
                          <select
                            value={createCity}
                            onChange={(e) => setCreateCity(e.target.value as VnProvince)}
                            className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-3 text-beige-kem outline-none"
                          >
                            {/* All 34 province-level units (NQ 202/2025/QH15), not the three-city
                          starter list — an organizer in Pleiku or Vinh used to have to lie. */}
                            {VN_PROVINCES.map((p) => (
                              <option key={p} value={p} className="bg-xanh-pho">
                                {p === "TP.HCM" ? "TP. Hồ Chí Minh" : p}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Address */}
                      <div>
                        <label className="block font-meta text-beige-kem font-semibold mb-1">
                          Địa chỉ chi tiết
                        </label>
                        <input
                          type="text"
                          value={createVenueAddress}
                          onChange={(e) => setCreateVenueAddress(e.target.value)}
                          placeholder="Vd: 240 3 Tháng 2, Phường 12, Quận 10"
                          required
                          className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-3 text-beige-kem outline-none"
                        />
                      </div>
                    </>
                  )}

                  {/* ── Trang 3 · Mô tả ───────────────────────────────────────────────────────── */}
                  {createStep === 2 && (
                    <>
                      {/* AI Assistant for Recommended Description */}
                      <div className="bg-surface-2 p-4 border border-beige-kem/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-meta text-xs font-bold text-burgundy uppercase tracking-wider">
                            AI Trợ Lý Viết Mô Tả Sự Kiện
                          </h3>
                          <span className="text-[10px] font-semibold text-white bg-burgundy px-2 py-0.5">
                            TixHub AI
                          </span>
                        </div>
                        <p className="font-meta text-[11px] text-ink-soft leading-relaxed">
                          Nhập ý tưởng ngắn hoặc chủ đề sự kiện (vd:"Đêm nhạc acoustic Trịnh Công
                          Sơn không gian ấm cúng"), AI sẽ tự động tạo tiêu đề & mô tả hấp dẫn cho
                          bạn!
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={aiBrief}
                            onChange={(e) => setAiBrief(e.target.value)}
                            placeholder="Nhập ý tưởng/tóm tắt nội dung sự kiện..."
                            className="flex-1 bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-2.5 text-beige-kem outline-none text-xs"
                          />
                          <button
                            type="button"
                            onClick={askAiDescriptionAssistant}
                            disabled={aiBusy}
                            className="px-4 py-2.5 bg-burgundy hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs transition-all shrink-0 flex items-center justify-center space-x-1"
                          >
                            {aiBusy ? (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
                                />
                                <span>AI Đang Tạo…</span>
                              </>
                            ) : (
                              <span>Nhờ AI Gợi Ý Mô Tả</span>
                            )}
                          </button>
                        </div>

                        {aiSuggestion && (
                          <div className="mt-3 p-3.5 bg-xanh-pho border border-beige-kem/30 space-y-2 text-xs">
                            <div className="flex items-center justify-between border-b border-beige-kem/20 pb-2">
                              <span className="font-bold text-burgundy">Gợi Ý Từ AI:</span>
                              <button
                                type="button"
                                onClick={applyAiSuggestion}
                                className="px-3 py-1 border border-la-co bg-la-co/25 text-beige-kem font-bold text-[11px] transition-colors"
                              >
                                Áp Dụng Tiêu Đề & Mô Tả Này
                              </button>
                            </div>
                            <div>
                              <span className="text-ink-soft font-semibold">Tiêu đề gợi ý:</span>
                              {""}
                              <span className="text-beige-kem font-bold">{aiSuggestion.title}</span>
                            </div>
                            <div>
                              <span className="text-ink-soft font-semibold block mb-1">
                                Mô tả gợi ý:
                              </span>
                              <p className="text-beige-kem bg-surface-2 p-2.5 border border-beige-kem/20 line-clamp-4 whitespace-pre-line text-[11px]">
                                {aiSuggestion.description}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block font-meta text-beige-kem font-semibold mb-1">
                          Mô tả chi tiết
                        </label>
                        <textarea
                          rows={4}
                          value={createDescription}
                          onChange={(e) => setCreateDescription(e.target.value)}
                          placeholder="Nhập mô tả sự kiện (hoặc dùng AI gợi ý ở trên)..."
                          required
                          className="w-full bg-xanh-pho border border-beige-kem/30 focus:border-burgundy p-3 text-beige-kem outline-none"
                        />
                      </div>
                    </>
                  )}

                  {transport}
                </form>
              )}

              {/*
                ── Các trang thiết lập sau khi bản nháp đã tồn tại ──
                Stage 4 sells dates and prices; stage 5 draws the chart a seated event needs; the
                last page reads the SAME server gates the console's rail uses and offers the one
                commit. Everything here talks to real ids — nothing is simulated.
              */}
              {created && (
                <div className="space-y-5 text-xs">
                  {/* ── Trang 4 · Suất chiếu & hạng vé ── */}
                  {createStep === 3 && (
                    <div className="space-y-3">
                      <p className="font-meta text-[11px] leading-relaxed text-ink-soft">
                        Thêm ngày diễn và giá vé. Mỗi suất cần ít nhất một hạng vé — một suất không
                        có vé là một suất bán không được gì.
                      </p>
                      {setupVenues ? (
                        <ShowtimeList
                          eventId={created.eventId}
                          venues={setupVenues}
                          preferredVenueId={created.venueId}
                          onChanged={() => refreshSetup()}
                        />
                      ) : (
                        <p className="text-ink-soft">Đang tải địa điểm…</p>
                      )}
                    </div>
                  )}

                  {/* ── Trang 5 · Sơ đồ ghế (chỉ seated) ── */}
                  {chartStageIndex !== null && createStep === chartStageIndex && (
                    <div className="space-y-4">
                      <p className="font-meta text-[11px] leading-relaxed text-ink-soft">
                        Vẽ sơ đồ cho từng địa điểm rồi gán hạng vé vào từng hạng ghế — ghế lên sàn
                        bán ngay khi áp dụng. Công cụ mở toàn màn hình; đóng để quay lại đây.
                      </p>
                      <ul className="space-y-2">
                        {upcomingOf(wizardRows ?? []).map((st) => (
                          <li
                            key={st.id}
                            className="flex flex-wrap items-center justify-between gap-2 border border-beige-kem/20 bg-xanh-pho px-3 py-2"
                          >
                            <span className="font-semibold text-beige-kem">{st.venueName}</span>
                            <span
                              className={`px-2 py-0.5 font-mono text-[10px] ${
                                st.hasSeatMap && st.bookableSeats > 0
                                  ? "bg-la-co/25 text-beige-kem"
                                  : "border border-beige-kem/30 text-ink-soft"
                              }`}
                            >
                              {st.hasSeatMap && st.bookableSeats > 0
                                ? `Đã áp dụng · ${st.bookableSeats} ghế`
                                : "Chưa áp dụng sơ đồ"}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => setSeatMapEventId(created.eventId)}
                        disabled={publishing}
                        className="w-full bg-burgundy px-4 py-2.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50 sm:w-auto"
                      >
                        Mở trình thiết kế sơ đồ
                      </button>
                    </div>
                  )}

                  {/* ── Trang cuối · Hoàn tất ── */}
                  {createStep === finishStageIndex && (
                    <div className="space-y-4">
                      <p className="font-meta text-[11px] leading-relaxed text-ink-soft">
                        Danh sách dưới đây đọc TRỰC TIẾP từ các điều kiện của máy chủ — cùng một
                        bảng ràng buộc mà nút xuất bản kiểm tra. Gửi duyệt chỉ mở khi mọi bước đều
                        đã xanh.
                      </p>
                      {wizardEvent ? (
                        <EventFlowRail
                          steps={setupSteps}
                          onAction={(action) => {
                            if (action === "submit") return;
                            setCreateStep(
                              action === "showtimes" || !chartStageIndex ? 3 : chartStageIndex,
                            );
                          }}
                        />
                      ) : (
                        <p className="text-ink-soft">Đang tải tiến độ…</p>
                      )}
                      {!canSubmitForReview && wizardEvent && (
                        <p className="border border-cam-dat/60 bg-cam-dat/10 px-4 py-3 text-beige-kem">
                          Chưa gửi được: hãy hoàn tất các bước còn thiếu trong danh sách trên. Quay
                          lại bất cứ lúc nào cũng được — bản nháp đã được lưu.
                        </p>
                      )}
                    </div>
                  )}

                  {transport}
                </div>
              )}
            </div>
          }
        </div>
      )}

      {/* The overlay `SeatMapBuilder` opens for one event — design the venue chart, then apply it
          to each showtime with a tier per class. Closing it refetches the console, so a new map
          shows up in the list beneath without leaving the page. */}
      {seatMapEventId !== null && (
        <SeatMapBuilder
          eventId={seatMapEventId}
          onClose={() => {
            setSeatMapEventId(null);
            setReloadKey((k) => k + 1);
            // The wizard's chart stage reads this too — refresh its applied/unapplied statuses.
            void refreshSetup();
          }}
        />
      )}
    </div>
  );
};
