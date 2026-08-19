/**
 * Cinemas, and a fortnight of showtimes for the films that are actually in cinemas.
 *
 * Run with `npm run seed:cinemas`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 *
 * The catalogue held 237 films and 4 showtimes. A film with no showtime fails the public
 * visibility predicate (`SHOWTIME_HAS_AVAILABILITY`), so 233 of them were invisible and unbookable —
 * which is why the cinema band on the landing page looked empty.
 *
 * The 465 venues already in the database could not fix that. They are concert and conference
 * venues — stadiums, exhibition halls, a university auditorium in Seoul — and exactly two have a
 * cinema-shaped name. Scheduling a film into Sân Vận Động Quân Khu 7 would have produced rows that
 * are technically valid and obviously wrong. So this seeds a real cinema estate beside them and
 * leaves the existing venues to the events they belong to.
 *
 * ── Where the names come from ───────────────────────────────────────────────────────────────────
 *
 * City, chain and cinema are taken from Moveek's public sitemap (`/sitemap-pages.xml`, advertised in
 * their `robots.txt`), which lists every `/rap/<slug>` they publish. Only the names are used: their
 * showtimes sit behind `Disallow: /showtime/`, and are not read here. The schedule below is
 * generated, not copied — which is also the only way it could work, since these rooms and their
 * seats exist only in this database.
 *
 * ── The shape of a schedule ─────────────────────────────────────────────────────────────────────
 *
 * Six sessions a day from 08:00 to 22:00, tapering with distance: a cinema publishes tomorrow in
 * full and next week in outline, because the far end of the schedule is still being decided. Films
 * rotate across rooms so no cinema shows one title all day and no title is stuck in one city.
 */
import { pool } from "./pool.js";

/* ── The estate ─────────────────────────────────────────────────────────────────────────────── */

interface Cinema {
  city: string;
  chain: string;
  name: string;
  address: string;
}

/**
 * Real cinemas, in the three tiers the estate is organised by: city → chain → cinema.
 *
 * Eight cities and eight chains rather than all 232 names in the sitemap. The point is a structure
 * that behaves like the real thing — several chains competing in one city, one chain spanning
 * several — and past a couple of dozen rooms every extra one only adds seats to write.
 */
const CINEMAS: Cinema[] = [
  // ── Tp. Hồ Chí Minh ──
  { city: "Tp. Hồ Chí Minh", chain: "CGV", name: "CGV Vincom Landmark 81", address: "Vincom Center Landmark 81, 720A Điện Biên Phủ, Bình Thạnh" },
  { city: "Tp. Hồ Chí Minh", chain: "CGV", name: "CGV Vincom Đồng Khởi", address: "Vincom Center, 72 Lê Thánh Tôn, Quận 1" },
  { city: "Tp. Hồ Chí Minh", chain: "CGV", name: "CGV Crescent Mall", address: "Crescent Mall, 101 Tôn Dật Tiên, Quận 7" },
  { city: "Tp. Hồ Chí Minh", chain: "CGV", name: "CGV Sư Vạn Hạnh", address: "Vạn Hạnh Mall, 11 Sư Vạn Hạnh, Quận 10" },
  { city: "Tp. Hồ Chí Minh", chain: "Lotte Cinema", name: "Lotte Cinema Gold View", address: "Gold View, 346 Bến Vân Đồn, Quận 4" },
  { city: "Tp. Hồ Chí Minh", chain: "Lotte Cinema", name: "Lotte Cinema Cộng Hòa", address: "Pico Plaza, 20 Cộng Hòa, Tân Bình" },
  { city: "Tp. Hồ Chí Minh", chain: "Lotte Cinema", name: "Lotte Cinema Gò Vấp", address: "242 Nguyễn Văn Lượng, Gò Vấp" },
  { city: "Tp. Hồ Chí Minh", chain: "Galaxy", name: "Galaxy Nguyễn Du", address: "116 Nguyễn Du, Quận 1" },
  { city: "Tp. Hồ Chí Minh", chain: "Galaxy", name: "Galaxy Sala", address: "Thiso Mall Sala, 10 Mai Chí Thọ, Thủ Đức" },
  { city: "Tp. Hồ Chí Minh", chain: "Galaxy", name: "Galaxy Quang Trung", address: "Co.opmart, 304A Quang Trung, Gò Vấp" },
  { city: "Tp. Hồ Chí Minh", chain: "BHD Star", name: "BHD Star Quang Trung", address: "Vincom Quang Trung, 190 Quang Trung, Gò Vấp" },
  { city: "Tp. Hồ Chí Minh", chain: "BHD Star", name: "BHD Star Vincom Lê Văn Việt", address: "Vincom Plaza, 50 Lê Văn Việt, Thủ Đức" },
  { city: "Tp. Hồ Chí Minh", chain: "Cinestar", name: "Cinestar Quốc Thanh", address: "271 Nguyễn Trãi, Quận 1" },
  { city: "Tp. Hồ Chí Minh", chain: "Mega GS", name: "Mega GS Cao Thắng", address: "19 Cao Thắng, Quận 3" },

  // ── Hà Nội ──
  { city: "Hà Nội", chain: "CGV", name: "CGV Vincom Bà Triệu", address: "Vincom Center, 191 Bà Triệu, Hai Bà Trưng" },
  { city: "Hà Nội", chain: "CGV", name: "CGV Vincom Royal City", address: "Royal City, 72A Nguyễn Trãi, Thanh Xuân" },
  { city: "Hà Nội", chain: "CGV", name: "CGV Times City", address: "Times City, 458 Minh Khai, Hai Bà Trưng" },
  { city: "Hà Nội", chain: "CGV", name: "CGV Vincom Metropolis Liễu Giai", address: "Vincom Metropolis, 29 Liễu Giai, Ba Đình" },
  { city: "Hà Nội", chain: "Lotte Cinema", name: "Lotte Cinema Thăng Long", address: "Thăng Long, 89 Láng Hạ, Đống Đa" },
  { city: "Hà Nội", chain: "Lotte Cinema", name: "Lotte Cinema West Lake", address: "Lotte Mall West Lake, 272 Võ Chí Công, Tây Hồ" },
  { city: "Hà Nội", chain: "Beta", name: "Beta Cineplex Mỹ Đình", address: "Trung tâm thương mại, Mỹ Đình, Nam Từ Liêm" },
  { city: "Hà Nội", chain: "Beta", name: "Beta Cineplex Thanh Xuân", address: "Hà Nội Center Point, 27 Lê Văn Lương, Thanh Xuân" },
  { city: "Hà Nội", chain: "Beta", name: "Beta Giải Phóng", address: "889 Giải Phóng, Hoàng Mai" },
  { city: "Hà Nội", chain: "BHD Star", name: "BHD Star Phạm Hùng", address: "The Garden, Mễ Trì, Nam Từ Liêm" },
  { city: "Hà Nội", chain: "Galaxy", name: "Galaxy Mipec Long Biên", address: "Mipec Riverside, 2 Long Biên, Long Biên" },

  // ── Đà Nẵng ──
  { city: "Đà Nẵng", chain: "CGV", name: "CGV Vincom Đà Nẵng", address: "Vincom Plaza, 910A Ngô Quyền, Sơn Trà" },
  { city: "Đà Nẵng", chain: "Lotte Cinema", name: "Lotte Cinema Đà Nẵng", address: "Lotte Mart, 6 Nại Nam, Hải Châu" },
  { city: "Đà Nẵng", chain: "Galaxy", name: "Galaxy Đà Nẵng", address: "Vĩnh Trung Plaza, 255 Hùng Vương, Thanh Khê" },
  { city: "Đà Nẵng", chain: "Starlight", name: "Starlight Đà Nẵng", address: "Indochina Riverside, 74 Bạch Đằng, Hải Châu" },

  // ── Hải Phòng ──
  { city: "Hải Phòng", chain: "CGV", name: "CGV AEON Mall Hải Phòng", address: "AEON Mall, 10 Võ Nguyên Giáp, Lê Chân" },
  { city: "Hải Phòng", chain: "Lotte Cinema", name: "Lotte Cinema Hải Phòng", address: "Lotte Mart, 1 Sở Dầu, Hồng Bàng" },
  { city: "Hải Phòng", chain: "Galaxy", name: "Galaxy Hải Phòng", address: "Vincom Plaza, Lê Thánh Tông, Ngô Quyền" },

  // ── Cần Thơ ──
  { city: "Cần Thơ", chain: "CGV", name: "CGV Sense City", address: "Sense City, 1 Đại lộ Hòa Bình, Ninh Kiều" },
  { city: "Cần Thơ", chain: "CGV", name: "CGV Vincom Xuân Khánh", address: "Vincom Plaza, 209 Đường 30/4, Ninh Kiều" },
  { city: "Cần Thơ", chain: "Lotte Cinema", name: "Lotte Cinema Cần Thơ", address: "Lotte Mart, 84 Mậu Thân, Ninh Kiều" },

  // ── Đồng Nai ──
  { city: "Đồng Nai", chain: "CGV", name: "CGV Biên Hòa", address: "Coopmart Biên Hòa, Phạm Văn Thuận, Biên Hòa" },
  { city: "Đồng Nai", chain: "Lotte Cinema", name: "Lotte Cinema Biên Hòa", address: "Lotte Mart, 1155 Phạm Văn Thuận, Biên Hòa" },
  { city: "Đồng Nai", chain: "Beta", name: "Beta Cineplex Biên Hòa", address: "Vincom Plaza, Võ Thị Sáu, Biên Hòa" },

  // ── Bình Dương ──
  { city: "Bình Dương", chain: "CGV", name: "CGV Bình Dương Square", address: "Bình Dương Square, Hòa Phú, Thủ Dầu Một" },
  { city: "Bình Dương", chain: "Lotte Cinema", name: "Lotte Cinema Bình Dương", address: "Lotte Mart, Hòa Phú, Thủ Dầu Một" },
  { city: "Bình Dương", chain: "Beta", name: "Beta Cineplex Empire Bình Dương", address: "Empire Tower, Hòa Phú, Thủ Dầu Một" },

  // ── Khánh Hòa ──
  { city: "Khánh Hòa", chain: "Galaxy", name: "Galaxy Nha Trang Center", address: "Nha Trang Center, 20 Trần Phú, Nha Trang" },
  { city: "Khánh Hòa", chain: "Lotte Cinema", name: "Lotte Cinema Nha Trang", address: "Gold Coast, 1 Trần Hưng Đạo, Nha Trang" },
  { city: "Khánh Hòa", chain: "CGV", name: "CGV Big C Nha Trang", address: "Big C, 30 Tháng 4, Nha Trang" },
];

/**
 * The films in cinemas right now, matched against Moveek's `/dang-chieu/` listing.
 *
 * Named explicitly rather than taken from an organizer id: the two are close but not the same set,
 * and "what is on at the cinema" is a claim about the world, not about who uploaded the row.
 */
const NOW_SHOWING = [
  "Nghỉ Hè Sợ Nghỉ Hưu",
  "Người Nhện 4: Khởi Đầu Mới",
  "Thư Tình Gửi Ngoại",
  "Ngày Tàn Của Phố Oak",
  "PAW Patrol: Phim Khủng Long",
  "Conan Movie 29 (2026): Thiên Thần Sa Ngã Trên Xa Lộ",
  "Điểm Mù",
  "The Odyssey",
  "Agito: Cuộc Chiến Siêu Năng Lực",
  "Ma Xưởng Hòm",
  "Ám: Chuỗi Phim Ngắn Linh Dị",
  "Umamusume: Pretty Derby – Khởi Đầu Kỷ Nguyên Mới",
  "Cô Nàng Ngổ Ngáo",
  "Moana live action",
  "Minions & Quái Vật",
  "Lầu Chú Hoả",
  "Đại Chiến Người Khổng Lồ: Lần Tấn Công Cuối Cùng",
];

/* ── The schedule ───────────────────────────────────────────────────────────────────────────── */

/** Local session times, 08:00 to 22:00. The last film starts at 22:00; nothing starts after it. */
const SLOTS = ["08:00", "11:00", "13:30", "16:00", "19:00", "22:00"];

/**
 * Which of the six sessions a given day runs.
 *
 * A cinema publishes tomorrow in full and next week in outline — the far end of a schedule is still
 * being negotiated with distributors — so the listing thins with distance rather than stopping dead.
 *
 * Returns slot INDICES, not a count, because thinning a day is not the same as truncating it. The
 * sessions that survive are the ones that sell: a Saturday a fortnight out keeps its evening
 * screenings and drops the 08:00, not the other way round.
 */
function slotsForDay(dayOffset: number): number[] {
  if (dayOffset <= 2) return [0, 1, 2, 3, 4, 5];
  if (dayOffset <= 6) return [1, 2, 4, 5];
  return [3, 4];
}

const DAYS = 14;
/** Rows per room. Five rows of ten: small enough to write quickly, big enough to look like a room. */
const ROWS = ["A", "B", "C", "D", "E"];
const PER_ROW = 10;
/** The back two rows cost more, as they do everywhere. Whole VND đồng. */
const PRICE_STANDARD = 75_000;
const PRICE_VIP = 105_000;
const VIP_ROWS = new Set(["D", "E"]);

/** `2026-08-17T08:00` in Vietnam, as an instant. The column is `timestamptz`; the clock is local. */
function localInstant(dayOffset: number, slot: string): Date {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const d = vn.getUTCDate() + dayOffset;
  const [hh, mm] = slot.split(":").map(Number);
  // Built in UTC then shifted back by the offset, so 08:00 local is 01:00Z whatever the host's zone.
  return new Date(Date.UTC(y, m, d, hh! - 7, mm!));
}

async function main(): Promise<void> {
  const started = Date.now();

  // The account that owns the estate. Moveek's organizer already holds the films it published.
  const owner = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM organizers WHERE display_name = 'Moveek Cinema Platform' LIMIT 1`,
  );
  const ownerId = owner.rows[0]?.user_id;
  if (!ownerId) throw new Error("No 'Moveek Cinema Platform' organizer — run the catalogue seed first.");

  /* ── 1. Films: what is on, and what has been and gone ─────────────────────────────────────── */

  const showing = await pool.query<{ id: number; title: string }>(
    `SELECT e.id, e.title FROM events e
       JOIN event_categories c ON c.id = e.category_id
      WHERE c.code = 'movie' AND e.title = ANY($1::text[])`,
    [NOW_SHOWING],
  );
  const filmIds = showing.rows.map((r) => r.id);
  if (filmIds.length === 0) throw new Error("None of the now-showing titles are in the catalogue.");

  await pool.query(
    `UPDATE events SET status = 'on_sale', moderation_status = 'approved'
      WHERE id = ANY($1::bigint[])`,
    [filmIds],
  );
  // Everything else in the film category has finished its run — "Đã diễn".
  const finished = await pool.query(
    `UPDATE events e SET status = 'finished'
       FROM event_categories c
      WHERE c.id = e.category_id AND c.code = 'movie'
        AND e.id <> ALL($1::bigint[]) AND e.status <> 'finished'`,
    [filmIds],
  );
  console.log(`films: ${filmIds.length} showing, ${finished.rowCount} marked đã diễn`);

  /* ── 2. The estate ────────────────────────────────────────────────────────────────────────── */

  /*
   * Chains ("cụm rạp") are rows, not prose — see migration 0036. That migration seeds the eight
   * operators, so this only has to look them up; the insert below is the safety net for a database
   * that somehow has the column but not the reference data, and keeps the seed runnable on its own.
   */
  const chainIdOf = new Map<string, number>();
  for (const name of new Set(CINEMAS.map((c) => c.chain))) {
    const code = name.toLowerCase().replace(/\s+/g, "-");
    const found = await pool.query<{ id: number }>(`SELECT id FROM cinema_chains WHERE code = $1`, [code]);
    const id =
      found.rows[0]?.id ??
      (
        await pool.query<{ id: number }>(
          `INSERT INTO cinema_chains (code, name) VALUES ($1, $2)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [code, name],
        )
      ).rows[0]!.id;
    chainIdOf.set(name, id);
  }
  console.log(`chains: ${chainIdOf.size} cụm rạp`);

  const venueIds: number[] = [];
  /** Which auditorium each cinema sells against — a showtime has to name one. */
  const layoutOf = new Map<number, number>();
  let newVenues = 0;
  for (const cinema of CINEMAS) {
    const chainId = chainIdOf.get(cinema.chain)!;
    const existing = await pool.query<{ id: number }>(
      `SELECT id FROM venues WHERE name = $1 AND city = $2`,
      [cinema.name, cinema.city],
    );
    let venueId = existing.rows[0]?.id;
    if (!venueId) {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO venues (created_by, name, city, raw_address, address_line, guide, chain_id)
         VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING id`,
        [ownerId, cinema.name, cinema.city, `${cinema.address}, ${cinema.city}`, `Hệ thống ${cinema.chain}`, chainId],
      );
      venueId = inserted.rows[0]!.id;
      newVenues++;
    } else {
      // A cinema seeded before 0036 existed has the chain in its `guide` text and nothing in the
      // column. Claim it, so re-running the seed is what backfills the estate.
      await pool.query(`UPDATE venues SET chain_id = $2 WHERE id = $1 AND chain_id IS DISTINCT FROM $2`, [
        venueId,
        chainId,
      ]);
    }
    venueIds.push(venueId);

    /*
     * One auditorium per cinema: a layout, one section inside it, and the seats.
     *
     * Seats hang off a LAYOUT, not off the venue — the seat-map editor (0007+) made the plan the
     * thing that owns geometry, so a venue can hold several and a showtime names the one it sold
     * against. `pos_x`/`pos_y` are required because the editor draws from them, so the rows are
     * laid out on the same 10000×10000 canvas the existing charts use.
     */
    const layout = await pool.query<{ id: number }>(
      `SELECT id FROM venue_layouts WHERE venue_id = $1 AND name = $2`,
      [venueId, "Phòng chiếu 1"],
    );
    let layoutId = layout.rows[0]?.id;
    if (!layoutId) {
      const madeLayout = await pool.query<{ id: number }>(
        `INSERT INTO venue_layouts (venue_id, name, status, width, height)
         VALUES ($1, 'Phòng chiếu 1', 'ready', 10000, 10000) RETURNING id`,
        [venueId],
      );
      layoutId = madeLayout.rows[0]!.id;
    }

    const section = await pool.query<{ id: number }>(
      `SELECT id FROM sections WHERE layout_id = $1 AND name = 'Toàn phòng'`,
      [layoutId],
    );
    let sectionId = section.rows[0]?.id;
    if (!sectionId) {
      const madeSection = await pool.query<{ id: number }>(
        `INSERT INTO sections (layout_id, name, description, display_order)
         VALUES ($1, 'Toàn phòng', $2, 0) RETURNING id`,
        [layoutId, `${cinema.chain} · ${cinema.city}`],
      );
      sectionId = madeSection.rows[0]!.id;
    }

    const already = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seats WHERE layout_id = $1`,
      [layoutId],
    );
    if (already.rows[0]!.n === 0) {
      // Centred on the canvas, 260 units apart — the spacing the seeded charts already use.
      const seatValues: string[] = [];
      const seatParams: unknown[] = [layoutId, sectionId];
      ROWS.forEach((row, rowIndex) => {
        for (let n = 1; n <= PER_ROW; n++) {
          const x = 3_700 + (n - 1) * 260;
          const y = 2_600 + rowIndex * 320;
          seatValues.push(
            `($1, $2, $${seatParams.length + 1}, $${seatParams.length + 2}, 'single', $${seatParams.length + 3}, $${seatParams.length + 4})`,
          );
          seatParams.push(row, n, x, y);
        }
      });
      await pool.query(
        `INSERT INTO seats (layout_id, section_id, row_label, seat_number, seat_type, pos_x, pos_y)
         VALUES ${seatValues.join(",")}`,
        seatParams,
      );
    }
    layoutOf.set(venueId, layoutId);
  }
  console.log(`venues: ${CINEMAS.length} cinemas (${newVenues} new), ${ROWS.length * PER_ROW} seats each`);

  /* ── 3. The fortnight ─────────────────────────────────────────────────────────────────────── */

  let madeShowtimes = 0;
  let madeSeats = 0;
  let rotation = 0;

  for (const [index, venueId] of venueIds.entries()) {
    const layoutId = layoutOf.get(venueId)!;
    const seats = await pool.query<{ id: number; row_label: string }>(
      `SELECT id, row_label FROM seats WHERE layout_id = $1 ORDER BY row_label, seat_number`,
      [layoutId],
    );

    for (let day = 0; day < DAYS; day++) {
      for (const slot of slotsForDay(day)) {
        const startsAt = localInstant(day, SLOTS[slot]!);
        // Offset by venue as well as by session, so two cinemas in one city are never showing the
        // same film at the same hour and no film is trapped in one corner of the country.
        const filmId = filmIds[(rotation + index) % filmIds.length]!;
        rotation++;

        const dupe = await pool.query<{ id: number }>(
          `SELECT id FROM showtimes WHERE venue_id = $1 AND starts_at = $2`,
          [venueId, startsAt],
        );
        if (dupe.rows[0]) continue;

        const showtime = await pool.query<{ id: number }>(
          `INSERT INTO showtimes (event_id, venue_id, layout_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '2 hours', 'on_sale')
           RETURNING id`,
          [filmId, venueId, layoutId, startsAt],
        );
        const showtimeId = showtime.rows[0]!.id;
        madeShowtimes++;

        const tiers = await pool.query<{ id: number; label: string }>(
          `INSERT INTO ticket_tiers (showtime_id, label, price_amount, description)
           VALUES ($1, 'Ghế thường', $2, 'Dãy A–C'), ($1, 'Ghế VIP', $3, 'Dãy D–E, vị trí trung tâm')
           RETURNING id, label`,
          [showtimeId, PRICE_STANDARD, PRICE_VIP],
        );
        const standardId = tiers.rows.find((t) => t.label === "Ghế thường")!.id;
        const vipId = tiers.rows.find((t) => t.label === "Ghế VIP")!.id;

        const values: string[] = [];
        const params: unknown[] = [showtimeId];
        for (const seat of seats.rows) {
          values.push(`($1, $${params.length + 1}, $${params.length + 2}, 'available')`);
          params.push(seat.id, VIP_ROWS.has(seat.row_label) ? vipId : standardId);
        }
        await pool.query(
          `INSERT INTO showtime_seats (showtime_id, seat_id, ticket_tier_id, status)
           VALUES ${values.join(",")} ON CONFLICT (showtime_id, seat_id) DO NOTHING`,
          params,
        );
        madeSeats += seats.rows.length;
      }
    }
    process.stdout.write(`\r  scheduling ${index + 1}/${venueIds.length} cinemas…`);
  }

  console.log(
    `\nshowtimes: ${madeShowtimes} created, ${madeSeats} seats laid out in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
