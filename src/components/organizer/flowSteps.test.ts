import { describe, expect, it } from "vitest";
import type { ManageShowtime, MyEvent } from "../../services/catalogClient";
import { fixItStage, flowSteps, stepProgress } from "./flowSteps";

// The property every case here circles: a step is `done` only when the SERVER gate that governs it
// would actually pass. Optimism in this table is how an organizer ends up at a 409.

const HOUR = 3_600_000;

const event = (over: Partial<MyEvent> = {}): MyEvent => ({
  id: 1,
  slug: "e",
  title: "Đêm nhạc Indie",
  description: "",
  status: "draft",
  moderation: "pending_review",
  reviewNote: null,
  imageUrl: null,
  eventType: "seated",
  category: "music",
  // Sales figures and the leading showtime. `flowSteps` reads none of them — they are here only
  // because the fixture builds a whole `MyEvent`, and a case that cares about them overrides them.
  totalCapacity: 0,
  soldTickets: 0,
  totalRevenueVnd: 0,
  nextShowtimeAt: null,
  venueName: null,
  hasUpcoming: false,
  // `flowSteps` reads none of these — here only because the fixture builds a whole MyEvent.
  venueId: null,
  ...over,
});

const showtime = (over: Partial<ManageShowtime> = {}): ManageShowtime =>
  ({
    id: 10,
    startsAt: new Date(Date.now() + 48 * HOUR).toISOString(),
    venueId: 5,
    venueName: "Nhà hát lớn",
    hasSeatMap: false,
    bookableSeats: 0,
    tiers: [],
    sections: [{ id: 1, name: "Khu A", seatCount: 12 }],
    layoutId: 99,
    layoutStatus: "ready",
    categories: [],
    ...over,
  }) as ManageShowtime;

const tier = (over = {}) => ({
  id: 7,
  label: "VIP",
  price: 500000,
  capacity: null,
  sold: 0,
  held: 0,
  categoryId: null,
  archived: false,
  ...over,
});

const byId = (steps: ReturnType<typeof flowSteps>, id: string) => steps.find((s) => s.id === id)!;

describe("the rail branches on event type", () => {
  it("gives a general-admission event four steps and never mentions a chart", () => {
    const steps = flowSteps(event({ eventType: "general_admission" }), [
      showtime({ tiers: [tier()] }),
    ]);
    expect(steps.map((s) => s.id)).toEqual(["draft", "showtime", "tiers", "submit"]);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });

  it("gives a seated event all seven, in dependency order", () => {
    const steps = flowSteps(event(), [showtime()]);
    expect(steps.map((s) => s.id)).toEqual([
      "draft",
      "showtime",
      "tiers",
      "chart",
      "chart-ready",
      "apply",
      "submit",
    ]);
  });
});

describe("steps report the gate, not a guess", () => {
  it("blocks on a showtime that has already started", () => {
    const past = showtime({ startsAt: new Date(Date.now() - HOUR).toISOString() });
    expect(byId(flowSteps(event(), [past]), "showtime").state).toBe("blocked");
  });

  it("does not count an ARCHIVED tier as a way to buy", () => {
    // The same test the publish gate now makes: `tt.archived_at IS NULL`.
    const steps = flowSteps(event(), [showtime({ tiers: [tier({ archived: true })] })]);
    expect(byId(steps, "tiers").state).toBe("blocked");
  });

  it("wants a chart with SEATS, not merely a chart row", () => {
    // `createLayout` mints an empty chart the moment the designer opens.
    const empty = showtime({ sections: [{ id: 1, name: "Khu A", seatCount: 0 }] });
    expect(byId(flowSteps(event(), [empty]), "chart").state).toBe("blocked");
  });

  it("refuses a DRAFT chart, and names the contract code", () => {
    const draft = showtime({ layoutStatus: "draft", tiers: [tier()] });
    const step = byId(flowSteps(event(), [draft]), "chart-ready");
    expect(step.state).toBe("blocked");
    expect(step.code).toBe("layout_not_published");
  });

  it("never calls a chart that does not exist a draft", () => {
    // A venue with no layout row has `layoutStatus: null`. Saying "đang là bản nháp" there sent the
    // organizer to the designer to publish a chart nobody had drawn, and named a refusal
    // (`layout_not_published`) the server would never reach — step 4 stops the request first.
    const none = showtime({ layoutId: null, layoutStatus: null, sections: [], tiers: [tier()] });
    const step = byId(flowSteps(event(), [none]), "chart-ready");
    expect(step.state).toBe("todo");
    expect(step.reason).not.toContain("bản nháp");
    expect(step.code).toBeUndefined();
  });

  it("holds later steps at todo rather than blocked while showtimes load", () => {
    // A rail that flashes red during a fetch teaches organizers to ignore it.
    const steps = flowSteps(event(), null);
    expect(byId(steps, "showtime").state).toBe("todo");
    expect(byId(steps, "apply").state).toBe("todo");
  });

  /*
   * The state was guarded and the REASON was not, so the markers went grey while the sentences beside
   * them stayed confident — computed from the empty list the states were refusing to judge on.
   * Observed in the browser: an event that was in fact fully ready rendered "0/0 suất có hạng vé đang
   * bán" for a beat before resolving to all-done.
   */
  it("says nothing at all about a step it has not got the data for", () => {
    const steps = flowSteps(event(), null);
    for (const step of steps) {
      if (step.id === "draft") continue;
      expect(step.reason, `${step.id} spoke before its data arrived`).toBeUndefined();
      expect(step.code, `${step.id} named a refusal it had not checked`).toBeUndefined();
    }
  });

  it("still explains the draft step while loading — it reads the event, which is already in hand", () => {
    const steps = flowSteps(event({ title: "   " }), null);
    expect(byId(steps, "draft").state).toBe("todo");
    expect(byId(steps, "draft").reason).toContain("Đặt tên");
  });

  it("covers the general-admission rail too, which returns from its own branch", () => {
    const steps = flowSteps(event({ eventType: "general_admission" }), null);
    expect(steps.map((s) => s.id)).toEqual(["draft", "showtime", "tiers", "submit"]);
    for (const step of steps.slice(1)) expect(step.reason).toBeUndefined();
  });
});

describe("pricing every class that holds inventory", () => {
  const priced = { id: 3, name: "VIP", color: "#E69F00", seatCount: 12, hasInventory: true };

  it("blocks, and names the class, when a stocked class has no tier bound", () => {
    const st = showtime({ categories: [priced], tiers: [tier({ categoryId: null })] });
    const step = byId(flowSteps(event(), [st]), "apply");
    expect(step.state).toBe("blocked");
    expect(step.code).toBe("category_without_tier");
    expect(step.reason).toContain("VIP");
  });

  it("passes once the tier names the class and the map is applied", () => {
    const st = showtime({
      categories: [priced],
      tiers: [tier({ categoryId: 3 })],
      hasSeatMap: true,
      bookableSeats: 12,
    });
    expect(byId(flowSteps(event(), [st]), "apply").state).toBe("done");
  });

  /*
   * The bug this field exists for. A capacity ZONE holds inventory with no seats, so `seatCount`
   * is 0 while `categoriesWithInventory` — the gate the apply actually runs — still demands a
   * price. Reading `seatCount` here showed the chart ready to apply and the apply refused.
   */
  it("demands a price for a ZONE-only class, which has no seats at all", () => {
    const zoneOnly = {
      id: 4,
      name: "Khu đứng",
      color: "#56B4E9",
      seatCount: 0,
      hasInventory: true,
    };
    const st = showtime({ categories: [zoneOnly], tiers: [tier({ categoryId: null })] });
    const step = byId(flowSteps(event(), [st]), "apply");
    expect(step.state).toBe("blocked");
    expect(step.reason).toContain("Khu đứng");
  });

  it("ignores a class that holds nothing — an all-archived class needs no price", () => {
    const empty = { id: 5, name: "Cũ", color: "#009E73", seatCount: 0, hasInventory: false };
    const st = showtime({
      categories: [empty],
      tiers: [tier({ categoryId: null })],
      hasSeatMap: true,
      bookableSeats: 12,
    });
    expect(byId(flowSteps(event(), [st]), "apply").state).toBe("done");
  });
});

describe("the last step", () => {
  const ready = () =>
    showtime({
      categories: [{ id: 3, name: "VIP", color: "#E69F00", seatCount: 12, hasInventory: true }],
      tiers: [tier({ categoryId: 3 })],
      hasSeatMap: true,
      bookableSeats: 12,
    });

  it("stays todo until everything before it passes", () => {
    expect(byId(flowSteps(event(), [showtime()]), "submit").state).toBe("todo");
  });

  it("opens once the chain is complete", () => {
    expect(byId(flowSteps(event(), [ready()]), "submit").state).toBe("blocked");
  });

  it("reads as done, and renames itself, once the event is on sale", () => {
    const steps = flowSteps(event({ status: "on_sale", moderation: "approved" }), [ready()]);
    expect(byId(steps, "submit").state).toBe("done");
    expect(byId(steps, "submit").label).toBe("Đang bán");
  });
});

describe("gaps the rail used to report as done", () => {
  const stepOf = (steps: ReturnType<typeof flowSteps>, id: string) =>
    steps.find((x) => x.id === id)!;

  it("does not call the chart done when a SECOND venue has none", () => {
    // Charts are per venue. Reading only the first upcoming showtime meant a two-venue event went
    // green as soon as one venue was drawn, and the publish gate then refused.
    const drawn = showtime({ id: 10, venueName: "Nhà hát lớn" });
    const bare = showtime({ id: 11, venueName: "Sân vận động", layoutId: null, sections: [] });

    const steps = flowSteps(event({ eventType: "seated" }), [drawn, bare]);

    expect(stepOf(steps, "chart").state).toBe("blocked");
    // And it says which venue, because "draw a chart" is useless when one already exists.
    expect(stepOf(steps, "chart").reason).toContain("Sân vận động");
  });

  it("still reports done when every venue is drawn", () => {
    const a = showtime({ id: 10, venueName: "Nhà hát lớn" });
    const b = showtime({ id: 11, venueName: "Sân vận động", venueId: 6 });

    expect(stepOf(flowSteps(event({ eventType: "seated" }), [a, b]), "chart").state).toBe("done");
  });

  it("does not call a flagged event 'Đang bán' just because its status says on_sale", () => {
    // An admin can remove or flag an event that is already on sale. The rail used to key on status
    // alone and told the organizer it was selling while the catalog was hiding it.
    const steps = flowSteps(
      event({ status: "on_sale", moderation: "flagged", reviewNote: "Ảnh vi phạm." }),
      [showtime({ hasSeatMap: true, bookableSeats: 12 })],
    );

    const submit = stepOf(steps, "submit");
    expect(submit.state).toBe("blocked");
    expect(submit.label).not.toBe("Đang bán");
    // The admin's note is the most useful thing to show, so it wins over the generic text.
    expect(submit.reason).toBe("Ảnh vi phạm.");
  });

  it("still reports Đang bán for an approved, on-sale event", () => {
    const steps = flowSteps(event({ status: "on_sale", moderation: "approved" }), [
      showtime({ hasSeatMap: true, bookableSeats: 12 }),
    ]);

    expect(stepOf(steps, "submit").state).toBe("done");
    expect(stepOf(steps, "submit").label).toBe("Đang bán");
  });
});

describe("the four states events.status can hold", () => {
  const submitOf = (e: MyEvent) =>
    flowSteps(e, [showtime({ hasSeatMap: true, bookableSeats: 12 })]).find(
      (s) => s.id === "submit",
    )!;

  it("does not call the step done before the organizer has submitted anything", () => {
    // A brand-new event is inserted status='draft', moderation='pending_review' by column default
    // (0002_catalog.sql:85). Reading moderation alone reported "done" on an event nobody had sent.
    const fresh = submitOf(event({ status: "draft", moderation: "pending_review" }));
    expect(fresh.state).not.toBe("done");
    expect(fresh.label).toBe("Gửi duyệt");
  });

  it("reports waiting once it HAS been submitted", () => {
    // Submitting sets status='on_sale' and leaves moderation='pending_review'.
    const waiting = submitOf(event({ status: "on_sale", moderation: "pending_review" }));
    expect(waiting.state).toBe("done");
    expect(waiting.label).toBe("Chờ duyệt");
  });

  it("does not invite the organizer to submit a cancelled event", () => {
    // status='cancelled' with moderation still 'approved' fell through every branch and rendered
    // "Gửi duyệt — Đủ điều kiện" for a show whose tickets had already been refunded.
    const cancelled = submitOf(event({ status: "cancelled", moderation: "approved" }));
    expect(cancelled.state).toBe("blocked");
    expect(cancelled.label).toBe("Đã hủy");
    expect(cancelled.reason).toContain("hoàn");
  });

  it("does not invite the organizer to submit a finished event", () => {
    const finished = submitOf(event({ status: "finished", moderation: "approved" }));
    expect(finished.state).toBe("blocked");
    expect(finished.label).toBe("Đã kết thúc");
  });
});

describe("an on-sale event whose showtimes have all passed", () => {
  const past = () =>
    showtime({
      startsAt: new Date(Date.now() - 2 * HOUR).toISOString(),
      hasSeatMap: true,
      bookableSeats: 12,
      tiers: [tier()],
    });

  it("does not mark the selling step as not-yet-started", () => {
    // `upcoming()` filters on startsAt > now, so once the last showtime passes every earlier step
    // goes todo and `ready` is false. If readiness is consulted before liveness, the rail renders
    // label "Đang bán" with state "todo" — grey, not-started, on an event that is selling. Reachable
    // in the window between the last showtime passing and status being flipped to 'finished'.
    const steps = flowSteps(event({ status: "on_sale", moderation: "approved" }), [past()]);
    const submit = steps.find((s) => s.id === "submit")!;

    expect(submit.label).toBe("Đang bán");
    expect(submit.state).toBe("done");
  });

  it("does not demand a NEW showtime from an event that is already selling", () => {
    // The bug as reported: entering a published event whose dates have played out rendered step 2
    // blocked — "Chưa có suất chiếu sắp diễn…" with a "Thêm suất chiếu →" button — under a submit
    // step that correctly read Đang bán. Its history proves every setup step; the calendar does not
    // re-open gates the publish check already passed.
    const steps = flowSteps(event({ status: "on_sale", moderation: "approved" }), [past()]);

    expect(byId(steps, "showtime").state).toBe("done");
    expect(byId(steps, "tiers").state).toBe("done");
    expect(byId(steps, "chart").state).toBe("done");
    expect(byId(steps, "chart-ready").state).toBe("done");
    expect(byId(steps, "apply").state).toBe("done");
  });

  it("gives an event waiting for admin review the same treatment", () => {
    // pending_review passed the same server gates at submission time; only the admin's yes differs.
    const steps = flowSteps(event({ status: "on_sale", moderation: "pending_review" }), [past()]);
    expect(byId(steps, "showtime").state).toBe("done");
    expect(byId(steps, "apply").state).toBe("done");
  });

  it("keeps judging a DRAFT by what is ahead of it — a past showtime fixes nothing", () => {
    // The regression guard for the fix above: scoping by submission must not leak to events nobody
    // has submitted, where a date in the past genuinely cannot be repaired and the rail's job is to
    // say so.
    const steps = flowSteps(event({ status: "draft" }), [past()]);
    expect(byId(steps, "showtime").state).toBe("blocked");
    expect(byId(steps, "showtime").reason).toContain("Chưa có suất chiếu sắp diễn");
    expect(byId(steps, "showtime").action).toBe("showtimes");
  });
});

describe("two venues in the same unready state", () => {
  it("names both, not just whichever showtime came first", () => {
    // `worstChart` breaks ties with `<`, so the first wins. Naming only that one sent the organizer
    // to fix one venue while the other, identically unready, went unmentioned — and the step stayed
    // blocked afterwards for a reason it had never given.
    const a = showtime({
      id: 10,
      venueId: 5,
      venueName: "Nhà hát lớn",
      layoutId: null,
      sections: [],
    });
    const b = showtime({
      id: 11,
      venueId: 6,
      venueName: "Sân vận động",
      layoutId: null,
      sections: [],
    });

    const chart = flowSteps(event({ eventType: "seated" }), [a, b]).find((s) => s.id === "chart")!;

    expect(chart.state).toBe("blocked");
    expect(chart.reason).toContain("Nhà hát lớn");
    expect(chart.reason).toContain("Sân vận động");
  });

  it("names only the venue that is actually behind when the other is fine", () => {
    const drawn = showtime({ id: 10, venueId: 5, venueName: "Nhà hát lớn" });
    const bare = showtime({
      id: 11,
      venueId: 6,
      venueName: "Sân vận động",
      layoutId: null,
      sections: [],
    });

    const chart = flowSteps(event({ eventType: "seated" }), [drawn, bare]).find(
      (s) => s.id === "chart",
    )!;

    expect(chart.reason).toContain("Sân vận động");
    expect(chart.reason).not.toContain("Nhà hát lớn");
  });
});

describe("stepProgress — the strip's headline", () => {
  const readyGa = () => showtime({ tiers: [tier()] });

  it("counts only completed steps and names the first blocked one", () => {
    // A brand-new seated event: draft done, and the FIRST gate it can fail — an empty showtime list —
    // is already blocked, while every step the server cannot judge yet stays `todo`. Counting only
    // `done` here would ignore the blocked tally; the strip's arithmetic is judged steps, not green.
    const steps = flowSteps(event({ eventType: "seated" }), []);
    const { doneCount, active } = stepProgress(steps);

    expect(doneCount).toBe(1);
    expect(active?.id).toBe("showtime");
    expect(active?.state).toBe("blocked");
    expect(active?.action).toBe("showtimes");
  });

  it("stays silent on the ready reason while the showtimes have not loaded", () => {
    const steps = flowSteps(event({ eventType: "seated" }), null);
    const { active } = stepProgress(steps);
    // Steps past the draft are `todo`, so the first open one is the one the organizer can act on
    // NOW (the showtime list), not a guess about steps the fetch has not judged yet.
    expect(active?.id).toBe("showtime");
  });

  it("reports every step counted and hands back the final step when all are done", () => {
    const steps = flowSteps(
      event({ eventType: "general_admission", status: "on_sale", moderation: "approved" }),
      [readyGa()],
    );
    const { doneCount, active } = stepProgress(steps);

    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(doneCount).toBe(steps.length);
    expect(active?.id).toBe("submit");
    expect(active?.label).toBe("Đang bán");
  });
});

describe("workflow readiness regression", () => {
  it("accepts an applied zone-only chart even after its source returns to draft", () => {
    const steps = flowSteps(event(), [
      showtime({
        sections: [],
        bookableSeats: 0,
        zoneCapacity: 500,
        hasSeatMap: true,
        layoutStatus: "draft",
        tiers: [tier({ capacity: 500, categoryId: 9 })],
        categories: [{ id: 9, name: "Đứng", color: "#fff", seatCount: 0, hasInventory: true }],
      }),
    ]);
    for (const id of ["chart", "chart-ready", "apply", "tiers"])
      expect(byId(steps, id).state).toBe("done");
    expect(byId(steps, "submit").label).toBe("Gửi duyệt");
    expect(byId(steps, "submit").state).toBe("blocked");
  });
  it("does not count a cancelled future showtime or missing active tiers as ready", () => {
    expect(byId(flowSteps(event(), [showtime({ status: "cancelled" })]), "showtime").state).toBe(
      "blocked",
    );
    const steps = flowSteps(event(), [
      showtime({ hasSeatMap: true, bookableSeats: 12, tiers: [] }),
    ]);
    expect(byId(steps, "submit").state).toBe("todo");
  });
});

describe("fixItStage (final-page fix-it routing, C1)", () => {
  it("sends showtimes and tiers to the shared stage 3", () => {
    expect(fixItStage("showtimes", 4)).toBe(3);
    expect(fixItStage("tiers", 4)).toBe(3);
  });
  it("sends chart and apply to the seated map stage", () => {
    expect(fixItStage("chart", 4)).toBe(4);
    expect(fixItStage("apply", 4)).toBe(4);
  });
  it("has stage 3 for everything when the event has no chart stage", () => {
    for (const action of ["showtimes", "tiers", "chart", "apply"] as const)
      expect(fixItStage(action, null)).toBe(3);
  });
});
