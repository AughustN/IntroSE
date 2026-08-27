import request from "supertest";
import { describe, expect, it } from "vitest";
import { STARTERS } from "@shared/catalog/seatmap-starters.js";
import { app } from "../helpers/app.js";
import { bearer, makeApprovedOrganizer, registerUser } from "../helpers/authFixture.js";
import { pool } from "../../src/db/pool.js";

/** How many `layout_tables` rows this chart owns. */
async function countTables(layoutId: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM layout_tables WHERE layout_id = $1",
    [layoutId],
  );
  return Number(rows[0].n);
}

/**
 * The seam the shared unit tests cannot reach: a starter's document carries NEGATIVE placeholder ids
 * for its sections and categories, and only `saveLayout` turns those into rows. A starter that
 * projects perfectly in memory and is rejected by the server is worth nothing, and nothing else in
 * the suite exercises that round trip.
 */
async function organizer() {
  const o = await registerUser();
  await makeApprovedOrganizer(o.userId);
  return { ...o, h: bearer(o.token) };
}

describe("built-in starters survive a real save", () => {
  it.each(STARTERS.map((s) => [s.id, s] as const))(
    'saves "%s" and gets back the seats it promised',
    { timeout: 60_000 },
    async (_id, starter) => {
      const o = await organizer();
      const venue = (
        await request(app)
          .post("/api/organizer/venues")
          .set(o.h)
          .send({ name: `V-${starter.id}`, city: "Hà Nội", rawAddress: "a" })
          .expect(201)
      ).body.id;

      const layout = (
        await request(app)
          .post(`/api/organizer/venues/${venue}/layouts`)
          .set(o.h)
          .send({ name: starter.name })
          .expect(201)
      ).body;

      const saved = (
        await request(app)
          .put(`/api/organizer/layouts/${layout.id}`)
          .set(o.h)
          .send({ version: layout.version, document: starter.build() })
          .expect(200)
      ).body;

      // The capacity the picker advertises before anything exists must be the capacity that lands.
      expect(saved.seats).toHaveLength(starter.sizes[0].seatCount);

      // Placeholders resolved: every section and category is a real row, and every seat points at one.
      for (const s of saved.sections) expect(s.id).toBeGreaterThan(0);
      for (const c of saved.categories) expect(c.id).toBeGreaterThan(0);
      const sectionIds = new Set(saved.sections.map((s: { id: number }) => s.id));
      const categoryIds = new Set(saved.categories.map((c: { id: number }) => c.id));
      for (const seat of saved.seats) {
        expect(sectionIds.has(seat.sectionId)).toBe(true);
        expect(categoryIds.has(seat.categoryId)).toBe(true);
      }

      /*
       * Companion pairs survive the round trip.
       *
       * This is the assertion the shared tests cannot make. In the document a companion names its
       * wheelchair seat by a NEGATIVE placeholder; `layouts.repo.ts` resolves those in a second pass
       * after every seat has a real row. If that remap regressed, the pointer would come back null —
       * or worse, pointing at whatever row happened to take the id — and the chart would still look
       * right on screen while selling a companion seat as a stranger.
       */
      /*
       * Tables described BY THE DOCUMENT become real `layout_tables` rows (0048), and their seats
       * point at them. Before this a table block drew an outline with nothing behind it.
       *
       * Saving twice is the assertion that matters: the new ids are written back onto the blocks, so
       * the second save must recognise the tables rather than insert a duplicate set. Getting that
       * wrong gives a chart that grows a fresh set of tables every time it is saved.
       */
      const tableBlocks = starter.build().blocks.filter((b) => b.kind === "table");
      if (tableBlocks.length > 0) {
        const tablesAfterFirst = await countTables(layout.id);
        expect(tablesAfterFirst).toBe(tableBlocks.length);

        const seatsOnTables = saved.seats.filter(
          (s: { tableId: number | null }) => s.tableId !== null,
        );
        expect(seatsOnTables.length).toBe(
          tableBlocks.reduce((n, b) => n + (b.tableSeatCount ?? 0), 0),
        );

        // The document the SERVER returned, not a fresh build: that is what an editor holds after a
        // save, and it carries the real seat and table ids. Re-sending a fresh build would present
        // every seat as new and collide on `seats_section_row_number_key` — a fact about placeholder
        // ids, not about tables.
        const reloaded = (
          await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)
        ).body;
        const again = (
          await request(app)
            .put(`/api/organizer/layouts/${layout.id}`)
            .set(o.h)
            .send({ version: reloaded.version, document: reloaded.document })
            .expect(200)
        ).body;
        expect(await countTables(layout.id), "a second save must not duplicate tables").toBe(
          tableBlocks.length,
        );
        expect(again.seats).toHaveLength(starter.sizes[0].seatCount);
      }

      const byId = new Map(saved.seats.map((s: { id: number }) => [s.id, s]));
      const pairs = saved.seats.filter(
        (s: { companionSeatId: number | null }) => s.companionSeatId !== null,
      );
      const accessible = saved.seats.filter((s: { isAccessible: boolean }) => s.isAccessible);
      expect(pairs).toHaveLength(accessible.length);
      for (const companion of pairs) {
        const target = byId.get(companion.companionSeatId) as { isAccessible: boolean } | undefined;
        expect(target, "companion points at a real seat").toBeDefined();
        expect(target!.isAccessible, "companion points at the wheelchair seat").toBe(true);
      }

      /*
       * ...and so does the pointer in the stored DOCUMENT, which is a separate fact.
       *
       * The rows above are written by `resolveCompanion`, which remaps placeholder → real. The
       * document is written by `remapDocument`, whose seat map was identity-only — correct for a
       * seat's OWN id, which `stitchSeatIds` has already made real, and wrong for a pointer it never
       * touched. `via` mints a fresh placeholder for anything its map does not answer, so the
       * companion came back naming a seat that exists nowhere.
       *
       * It matters because the EDITOR validates the document, not the rows: a chart correct in the
       * database opened reading "Ghế đi kèm đang trỏ tới một ghế không có trong sơ đồ" and refused to
       * publish. Asserting the rows alone cannot see it.
       */
      const reread = (
        await request(app).get(`/api/organizer/layouts/${layout.id}`).set(o.h).expect(200)
      ).body;
      const docSeatIds = new Set<number>(
        reread.document.blocks.flatMap((b: { seats?: { seatId: number }[] }) =>
          (b.seats ?? []).map((s) => s.seatId),
        ),
      );
      const docPairs = reread.document.blocks.flatMap(
        (b: { seats?: { seatId: number; companionSeatId?: number }[] }) =>
          (b.seats ?? []).filter((s) => s.companionSeatId !== undefined),
      );
      expect(docPairs).toHaveLength(accessible.length);
      for (const c of docPairs) {
        expect(
          docSeatIds.has(c.companionSeatId as number),
          `document companion ${c.companionSeatId} names a seat in the document`,
        ).toBe(true);
      }
    },
  );
});
