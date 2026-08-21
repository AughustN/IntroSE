/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ManageShowtime, MyEvent } from "../../services/catalogClient";

/**
 * What stands between an event and the public catalog, as a list of steps.
 *
 * Setting up a seated event has a real dependency chain — a draft chart cannot be applied, an
 * unpriced class cannot generate seats, a showtime must exist before any ticket can — and the server
 * enforces every link. It just never says so in advance: an organizer meets the chain as
 * `layout_not_published`, `category_without_tier`, a publish that silently does nothing.
 *
 * So each step below mirrors ONE server predicate, deliberately spelled the same way the server
 * spells it. This module is pure — no React, no fetch — so that table of predicates can be tested
 * against the real payload shape without a database standing behind it.
 *
 * The rule this file exists to keep: a step is `done` only when the gate that governs it would
 * actually pass. Never optimism, never local UI state.
 */

export type StepState = "done" | "blocked" | "todo";

export type FlowAction = "showtimes" | "tiers" | "chart" | "apply" | "submit";

/**
 * What a fix-it button says, in both readers of these steps — the rail AND the strip.
 *
 * Two surfaces, one voice (Principle VI): the label names the tool it opens, in the words that tool
 * uses for itself. It lived privately in the rail while the strip needed it here, which is exactly
 * the drift a shared export exists to prevent.
 */
export const ACTION_LABEL: Record<FlowAction, string> = {
  showtimes: "Thêm suất chiếu",
  tiers: "Mở hạng vé",
  chart: "Mở trình thiết kế sơ đồ",
  apply: "Gán giá & áp dụng",
  submit: "Gửi duyệt",
};

export interface FlowStep {
  id: string;
  /** Ordinal shown in the rail. A true position in a dependency chain, not decoration. */
  n: number;
  label: string;
  state: StepState;
  /** Why it cannot pass yet, in the interface's voice. Absent when `done`. */
  reason?: string;
  /** The error contract's code for that refusal, when the server has one for it. */
  code?: string;
  /** Which tool fixes it — the rail and the strip turn this into a link. */
  action?: FlowAction;
}

/**
 * The strip's headline, as pure arithmetic over the steps.
 *
 * `doneCount` counts `blocked` as progress too: a blocked step is one the server has judged, and a
 * fresh draft's only unfinished step IS its draft — counting only `done` would print 0/0 when the
 * organizer has already past the first gate they could fail. `active` is the step the organizer is
 * being asked to deal with now — the first one not `done` — or the last step when all have passed
 * (submit), so the strip never goes silent on a finished chain.
 */
export function stepProgress(steps: FlowStep[]): { doneCount: number; active: FlowStep | null } {
  const doneCount = steps.filter((s) => s.state !== "todo").length;
  const active = steps.find((s) => s.state !== "done") ?? steps[steps.length - 1] ?? null;
  return { doneCount, active };
}

const upcoming = (rows: ManageShowtime[]) =>
  rows.filter((s) => new Date(s.startsAt).getTime() > Date.now());

/**
 * The upcoming showtime that is FURTHEST from being sellable, or the first if they all are.
 *
 * Charts are per venue, and an event may run at more than one. Reading only `upcoming(rows)[0]` meant
 * a two-venue event went green the moment the first venue had a chart, while the second had none —
 * the rail reported ready and the publish gate then refused. Reporting the laggard makes the rail say
 * what is actually missing, and naming its venue says where.
 */
const worstChart = (rows: ManageShowtime[]): ManageShowtime | null => {
  const up = upcoming(rows);
  if (up.length === 0) return null;
  const rank = (s: ManageShowtime) => {
    const drawn = s.sections.reduce((n, sec) => n + sec.seatCount, 0);
    if (s.layoutId === null || drawn === 0) return 0; // no chart drawn
    if (s.layoutStatus !== "ready") return 1; // drawn but not published
    if (!s.hasSeatMap || s.bookableSeats === 0) return 2; // published but not applied here
    return 3; // fully sellable
  };
  return up.reduce((worst, s) => (rank(s) < rank(worst) ? s : worst), up[0]);
};

/**
 * Every venue tied at the worst rank, not just whichever showtime happened to come first.
 *
 * `worstChart` breaks ties with `<`, so the first showtime wins and its venue is the one the reason
 * names. With two venues equally unready that sent the organizer to fix one while the other, in the
 * same state, went unmentioned — the step stayed blocked afterwards for a reason it had not given.
 */
const venuesAtWorstRank = (rows: ManageShowtime[], worst: ManageShowtime | null): string => {
  if (!worst) return "";
  const rankOf = (s: ManageShowtime) => {
    const drawn = s.sections.reduce((n, sec) => n + sec.seatCount, 0);
    if (s.layoutId === null || drawn === 0) return 0;
    if (s.layoutStatus !== "ready") return 1;
    if (!s.hasSeatMap || s.bookableSeats === 0) return 2;
    return 3;
  };
  const target = rankOf(worst);
  const names = [
    ...new Set(
      upcoming(rows)
        .filter((s) => rankOf(s) === target)
        .map((s) => s.venueName),
    ),
  ];
  return names.join(", ");
};

/**
 * Silence every reason past the draft until the showtimes are in.
 *
 * The `state` of each step below already guards on `loaded`. Its `reason` did not, and a reason is
 * computed from the same empty list the state refuses to judge on — so during the fetch the rail
 * printed "0/0 suất có hạng vé đang bán", named the venue holding things up as `“”`, and told the
 * organizer "Sơ đồ đã sẵn sàng" about a chart it had not looked at. Three sentences of confident
 * nonsense under a row of correctly-grey markers, replaced a beat later by the real answer.
 *
 * Applied here, once, at the exit, rather than by guarding each reason at its own site: `showtime`
 * was the only step that ever had that guard, and four written after it did not, which is the shape
 * of mistake that repeats every time a step is added. A step cannot opt out of this.
 */
const untilLoaded = (steps: FlowStep[]): FlowStep[] =>
  steps.map((s) => (s.id === "draft" ? s : { ...s, reason: undefined, code: undefined }));

/**
 * Steps for one event.
 *
 * `rows === null` means the showtimes have not loaded; every step past the draft reports `todo`
 * rather than guessing, because a rail that flashes "blocked" during a fetch teaches organizers to
 * ignore it. The draft step is exempt because it reads `event`, which is already in hand.
 */
export function flowSteps(event: MyEvent, rows: ManageShowtime[] | null): FlowStep[] {
  const seated = event.eventType === "seated";
  const list = rows ?? [];
  const up = upcoming(list);
  const loaded = rows !== null;

  // ---- 1. the draft itself
  const drafted = event.title.trim().length > 0;
  const steps: FlowStep[] = [
    {
      id: "draft",
      n: 1,
      label: "Bản nháp sự kiện",
      state: drafted ? "done" : "todo",
      reason: drafted ? undefined : "Đặt tên và mô tả cho sự kiện.",
    },
  ];

  // ---- 2. a showtime, because a ticket belongs to one
  //
  // `ticket_tiers.showtime_id`: there is nowhere to hang a price until a date exists. This is the
  // step most often missed, because "create tickets" sounds like an event-level act.
  steps.push({
    id: "showtime",
    n: 2,
    label: "Suất chiếu",
    state: !loaded ? "todo" : up.length > 0 ? "done" : "blocked",
    reason:
      !loaded || up.length > 0
        ? undefined
        : "Chưa có suất chiếu sắp diễn. Thêm địa điểm và giờ bắt đầu — suất đã qua không tính.",
    action: "showtimes",
  });

  // ---- 3. ticket types
  //
  // Matches the publish gate's own test (`tt.archived_at IS NULL`): an archived class is not a way
  // to buy. Stricter than the gate on coverage — the gate accepts ONE priced showtime, this asks for
  // all of them, because a showtime with no ticket sells nothing and the organizer meant to sell it.
  const withTiers = up.filter((s) => s.tiers.some((t) => !t.archived));
  const tiersDone = loaded && up.length > 0 && withTiers.length === up.length;
  steps.push({
    id: "tiers",
    n: 3,
    label: "Hạng vé",
    state: !loaded || up.length === 0 ? "todo" : tiersDone ? "done" : "blocked",
    reason: tiersDone
      ? undefined
      : `${withTiers.length}/${up.length} suất có hạng vé đang bán. Mở suất còn thiếu và thêm một hạng.`,
    action: "tiers",
  });

  if (!seated) {
    // General admission stops here: tiers carry their own quantity, and there is no chart to draw.
    steps.push(submitStep(4, event, loaded, tiersDone && up.length > 0));
    return loaded ? steps : untilLoaded(steps);
  }

  const st = worstChart(list);
  /** Named in the reasons, so a multi-venue event says WHICH venues are holding it up — all of the
   *  ones in the same state, not the first that happened to be checked. */
  const where = venuesAtWorstRank(list, st);

  // ---- 4. the venue's chart
  //
  // Drawn seats, not merely a chart row: `createLayout` mints an empty one the moment the designer
  // opens, so "a chart exists" would go green before a single seat had been placed.
  const drawn = st ? st.sections.reduce((n, s) => n + s.seatCount, 0) : 0;
  const hasChart = !!st && st.layoutId !== null && drawn > 0;
  steps.push({
    id: "chart",
    n: 4,
    label: "Sơ đồ ghế",
    state: !loaded || !st ? "todo" : hasChart ? "done" : "blocked",
    reason: hasChart
      ? undefined
      : `Địa điểm “${where}” chưa có ghế nào được vẽ. Mở trình thiết kế và dựng sơ đồ.`,
    action: "chart",
  });

  // ---- 5. publishing the chart
  //
  // `organizer.routes.ts` refuses `layout_not_published` unless the chart is `ready`. A draft is a
  // work in progress; binding one would sell seats the organizer is still moving.
  const chartReady = !!st && st.layoutStatus === "ready";
  steps.push({
    id: "chart-ready",
    n: 5,
    label: "Phát hành sơ đồ",
    state: !loaded || !hasChart ? "todo" : chartReady ? "done" : "blocked",
    reason: chartReady
      ? undefined
      : `Sơ đồ của “${where}” đang là bản nháp. Mở trình thiết kế và bấm “Phát hành” để khoá bản dùng để bán.`,
    code: chartReady ? undefined : "layout_not_published",
    action: "chart",
  });

  // ---- 6. price every stocked class, then apply
  //
  // `hasInventory`, not `seatCount`: a capacity ZONE holds inventory with no seats, and the apply
  // gate (`categoriesWithInventory`) counts it. Pricing and applying are one action, because
  // `generateSeatMap` refuses unless every stocked class already names a tier.
  const unpriced = st
    ? st.categories.filter(
        (c) => c.hasInventory && !st.tiers.some((t) => !t.archived && t.categoryId === c.id),
      )
    : [];
  const applied = !!st && st.hasSeatMap && st.bookableSeats > 0;
  steps.push({
    id: "apply",
    n: 6,
    label: "Gán giá & áp dụng",
    state: !loaded || !chartReady ? "todo" : applied ? "done" : "blocked",
    reason: applied
      ? undefined
      : unpriced.length > 0
        ? `${unpriced.map((c) => `“${c.name}”`).join(", ")} chưa có giá. Chọn mức giá cho từng hạng rồi áp dụng cho suất.`
        : "Sơ đồ đã sẵn sàng. Áp dụng cho từng suất để ghế lên sàn bán.",
    code: !applied && unpriced.length > 0 ? "category_without_tier" : undefined,
    action: "apply",
  });

  steps.push(submitStep(7, event, loaded, applied));
  return loaded ? steps : untilLoaded(steps);
}

/**
 * The last step, shared by both event types.
 *
 * `ready` is what the caller computed as "everything before this passed" — the rail never claims the
 * publish gate will pass on grounds it has not checked.
 */
function submitStep(n: number, event: MyEvent, loaded: boolean, ready: boolean): FlowStep {
  /*
   * `events.status` is one of four and `moderation_status` one of four (0002_catalog.sql:83,85).
   * Both matter and neither alone is enough, which is what this step kept getting wrong.
   *
   * Submitting sets status='on_sale' AND moderation='pending_review' (catalog.write.ts:199), so
   * STATUS is what separates "never submitted" from "waiting on an admin" — a brand-new event is
   * already `pending_review` by column default, and reading moderation alone reported this step done
   * before the organizer had pressed anything.
   *
   * The two terminal states were missing entirely: a cancelled event has moderation still 'approved'
   * and status 'cancelled', so it fell through every branch and rendered "Gửi duyệt — Đủ điều kiện",
   * inviting the organizer to submit a show whose tickets had already been refunded. `EventList`
   * badges cancelled correctly, so the console contradicted itself across two screens.
   */
  const base = { id: "submit" as const, n, action: "submit" as const };

  if (event.status === "cancelled") {
    return {
      ...base,
      label: "Đã hủy",
      state: "blocked",
      reason: "Sự kiện đã bị hủy và vé đã hoàn. Không thể gửi duyệt lại.",
    };
  }
  if (event.status === "finished") {
    return { ...base, label: "Đã kết thúc", state: "blocked", reason: "Sự kiện đã diễn ra xong." };
  }
  if (event.moderation === "removed" || event.moderation === "flagged") {
    return {
      ...base,
      label: "Bị từ chối",
      state: "blocked",
      reason:
        event.reviewNote ??
        "Quản trị viên đã gỡ hoặc gắn cờ sự kiện này. Sửa nội dung rồi gửi lại.",
    };
  }

  const submitted = event.status === "on_sale";
  const live = submitted && event.moderation === "approved";
  return {
    ...base,
    label: live ? "Đang bán" : submitted ? "Chờ duyệt" : "Gửi duyệt",
    // Submission is checked BEFORE readiness, not after. Readiness is a precondition for sending an
    // event, not a description of one that already went: an on-sale event whose last showtime has
    // passed has `ready` false (every step reads `upcoming()`), and consulting that first rendered
    // "Đang bán" against a grey not-started marker — and handed it the rail's "you are here" edge.
    state: submitted ? "done" : !loaded || !ready ? "todo" : "blocked",
    reason: live
      ? undefined
      : submitted
        ? "Đã gửi. Sự kiện sẽ hiển thị công khai sau khi quản trị viên duyệt."
        : !ready
          ? "Hoàn tất các bước ở trên trước khi gửi duyệt."
          : "Đủ điều kiện — gửi để quản trị viên phê duyệt và hiển thị công khai.",
  };
}
