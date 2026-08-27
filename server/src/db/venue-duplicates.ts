/**
 * Read-only survey of duplicate venues — the evidence for whether the unique index is worth doing.
 *
 * `createVenue` is now lookup-or-create, so no NEW duplicates are made. This counts what the old
 * unconditional INSERT already left behind, and — the part that actually decides the question —
 * splits the clusters by whether merging them would need a judgement call or is a pure delete.
 *
 * WRITES NOTHING. Only SELECTs, and deliberately no `SET` of any kind: `DATABASE_URL` is a PgBouncer
 * endpoint where a session-level SET leaks into other sessions (it broke `db:migrate` once already).
 *
 *   npx tsx --tsconfig tsconfig.server.json server/src/db/venue-duplicates.ts
 */

import { pool } from "./pool.js";

/** The same normalisation `createVenue`'s SAME_TEXT and the client's `dedupedVenues` apply. */
const NORM = (col: string) => `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;

interface Row {
  cluster: string;
  venue_id: number;
  owner: number;
  name: string;
  city: string;
  raw_address: string;
  events: number;
  showtimes: number;
  layouts: number;
  sold: number;
  held: number;
}

/*
 * The three tables that actually point at a venue, confirmed against pg_constraint rather than read
 * off migration 0002 — `sections.venue_id` and `seats.venue_id` were in that file but have since
 * moved to `layout_id`, so a survey written from the migrations alone counts columns that are gone.
 */
const isAnchored = (r: Row) => r.events + r.showtimes + r.layouts > 0;

async function main(): Promise<void> {
  const { rows: totals } = await pool.query<{ venues: string; places: string }>(
    `SELECT count(*)::text AS venues,
            count(DISTINCT (created_by, ${NORM("name")}, ${NORM("city")}, ${NORM("raw_address")}))::text
              AS places
       FROM venues`,
  );
  const venues = Number(totals[0].venues);
  const places = Number(totals[0].places);

  /*
   * The two figures that look like they disagree, reconciled in the report rather than left to trip
   * the next reader up.
   *
   * `dedupedVenues` records "216 duplicates" — that is duplicates by NAME ALONE, across all owners,
   * and it is the number that justifies collapsing the PICKER. It is not the number that justifies a
   * unique index, because two organizers each with a venue called "Online" are not one row typed
   * twice. The address-level count below is the one this survey is about.
   */
  const { rows: byName } = await pool.query<{ rows_over: string; names: string }>(
    `SELECT COALESCE(sum(n - 1), 0)::text AS rows_over, count(*)::text AS names
       FROM (SELECT count(*) AS n FROM venues GROUP BY ${NORM("name")} HAVING count(*) > 1) x`,
  );

  const { rows } = await pool.query<Row>(
    `WITH keyed AS (
       SELECT v.id, v.created_by, v.name, v.city, v.raw_address,
              created_by || '|' || ${NORM("v.name")} || '|' || ${NORM("v.city")} || '|'
                || ${NORM("v.raw_address")} AS cluster
         FROM venues v
     ),
     dup AS (
       SELECT cluster FROM keyed GROUP BY cluster HAVING count(*) > 1
     )
     SELECT k.cluster, k.id AS venue_id, k.created_by AS owner, k.name, k.city, k.raw_address,
            (SELECT count(*)::int FROM events    e WHERE e.venue_id = k.id) AS events,
            (SELECT count(*)::int FROM showtimes s WHERE s.venue_id = k.id) AS showtimes,
            (SELECT count(*)::int FROM venue_layouts l WHERE l.venue_id = k.id) AS layouts,
            -- Money already taken. A cluster with this on more than one row is not a tidy-up.
            COALESCE((SELECT sum(t.sold_quantity)::int FROM ticket_tiers t
                        JOIN showtimes s ON s.id = t.showtime_id WHERE s.venue_id = k.id), 0) AS sold,
            COALESCE((SELECT sum(t.reserved_quantity)::int FROM ticket_tiers t
                        JOIN showtimes s ON s.id = t.showtime_id WHERE s.venue_id = k.id), 0) AS held
       FROM keyed k JOIN dup ON dup.cluster = k.cluster
      ORDER BY k.cluster, k.id`,
    );

  const clusters = new Map<string, Row[]>();
  for (const r of rows) clusters.set(r.cluster, [...(clusters.get(r.cluster) ?? []), r]);

  const empty: Row[][] = [];
  const oneAnchor: Row[][] = [];
  const contested: Row[][] = [];
  for (const c of clusters.values()) {
    const anchored = c.filter(isAnchored).length;
    if (anchored === 0) empty.push(c);
    else if (anchored === 1) oneAnchor.push(c);
    else contested.push(c);
  }

  const rowsIn = (cs: Row[][]) => cs.reduce((n, c) => n + c.length, 0);
  const deletable = (cs: Row[][]) => cs.reduce((n, c) => n + c.filter((r) => !isAnchored(r)).length, 0);

  console.log("\n=== ĐỊA ĐIỂM TRÙNG — BÁO CÁO CHỈ ĐỌC ===\n");
  console.log(`Tổng số hàng venues        : ${venues}`);
  console.log(`Số địa điểm thực sự khác   : ${places}`);
  console.log(`Số hàng dư thừa            : ${venues - places}`);
  console.log(`Số cụm trùng               : ${clusters.size}\n`);
  console.log(
    `Đối chiếu: trùng theo TÊN không thôi (mọi chủ) là ${byName[0].rows_over} hàng thừa trên ` +
      `${byName[0].names} tên.\nĐó là con số biện minh cho việc gom DANH SÁCH CHỌN, không phải cho ` +
      `unique index — hai\nnhà tổ chức cùng có địa điểm tên "Online" không phải một hàng gõ hai lần.\n`,
  );

  console.log("--- Phân loại cụm (đây là thứ quyết định có nên làm tiếp) ---\n");
  console.log(`A. Cụm KHÔNG hàng nào bị trỏ tới : ${empty.length} cụm, ${rowsIn(empty)} hàng`);
  console.log(`   → gộp = xoá thuần, giữ id nhỏ nhất. Không phải quyết định gì.\n`);
  console.log(`B. Cụm CHỈ MỘT hàng bị trỏ tới   : ${oneAnchor.length} cụm, ${rowsIn(oneAnchor)} hàng`);
  console.log(`   → giữ hàng đang được dùng, xoá ${deletable(oneAnchor)} bản sao rỗng. Không trỏ lại gì.\n`);
  console.log(`C. Cụm NHIỀU hàng bị trỏ tới     : ${contested.length} cụm, ${rowsIn(contested)} hàng`);
  console.log(`   → phải trỏ lại events/showtimes/layouts/sections/seats. ĐÂY là phần cần bạn quyết.\n`);

  if (contested.length > 0) {
    console.log("--- Chi tiết các cụm tranh chấp ---\n");
    for (const c of contested) {
      const head = c[0];
      console.log(`  chủ #${head.owner} · "${head.name}" · ${head.city} · ${head.raw_address}`);
      for (const r of c) {
        const bits = [
          r.events && `${r.events} sự kiện`,
          r.showtimes && `${r.showtimes} suất`,
          r.layouts && `${r.layouts} sơ đồ`,
        ].filter(Boolean);
        const money = r.sold + r.held > 0 ? `  ⚠ đã bán ${r.sold}, đang giữ ${r.held}` : "";
        console.log(`    #${r.venue_id}  ${bits.length ? bits.join(" · ") : "(không gì trỏ tới)"}${money}`);
      }
      console.log("");
    }
  }

  const withMoney = contested.filter((c) => c.filter((r) => r.sold + r.held > 0).length > 1);
  console.log("--- Kết luận ---\n");
  if (clusters.size === 0) {
    console.log("Không có cụm trùng nào. Thêm unique index được ngay, không cần dọn gì.\n");
  } else if (contested.length === 0) {
    console.log(
      `Mọi cụm đều gộp được cơ học: xoá ${rowsIn(empty) - empty.length + deletable(oneAnchor)} hàng thừa,\n` +
        "không trỏ lại gì, không đụng tới dữ liệu bán. Có thể làm tiếp mà không cần quyết định nào.\n",
    );
  } else {
    console.log(`${contested.length} cụm cần quyết định thủ công: hàng nào sống, và cái gì trỏ lại.`);
    if (withMoney.length > 0) {
      console.log(
        `Trong đó ${withMoney.length} cụm có VÉ ĐÃ BÁN/GIỮ trên nhiều hàng — trộn tồn kho của chúng\n` +
          "không phải là dọn dẹp, nên tôi sẽ không tự làm.",
      );
    }
    console.log(
      "\nCòn lại nhóm A + B (" +
        `${empty.length + oneAnchor.length} cụm) vẫn dọn được an toàn ngay, và unique index có thể\n` +
        "hoãn tới khi nhóm C được xử lý xong.\n",
    );
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
