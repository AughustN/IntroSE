/**
 * One spelling per place, in `venues.city`.
 *
 * Run with `npm run db:cities`.
 *
 * The column was filled by several importers that never agreed with each other, so the catalogue
 * had Hồ Chí Minh under three names — "Hồ Chí Minh" (107), "Tp. Hồ Chí Minh" (14) and "TP.HCM" (4)
 * — which a city filter shows as three separate places holding a third of the estate each. Another
 * 297 venues carried the literal string "Chưa xác định" while their own address named the province
 * in the next field along.
 *
 * Two passes, in this order:
 *
 *   1. **Alias** — a known variant spelling becomes the canonical one. Loses nothing: the strings
 *      already meant the same place.
 *   2. **Derive** — a venue with no city gets one from its address, but only on a confident match.
 *      Anything still unidentifiable keeps "Chưa xác định", which is a true statement about a row
 *      whose address is "Online" or "DreamS".
 *
 * The target is the PROVINCE, not the town: `venues.city` feeds a filter, and a reader picking a
 * place expects the administrative unit — the same one Moveek lists. So Biên Hòa files under Đồng
 * Nai and Nha Trang under Khánh Hòa, which is also what the cinema estate already uses.
 */
import { pool } from "./pool.js";

/** Accent- and case-insensitive, punctuation-free. `Tp. Hồ Chí Minh` → `tp ho chi minh`. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every province, and the spellings and towns that should file under it. */
const PROVINCES: Record<string, string[]> = {
  "Tp. Hồ Chí Minh": ["ho chi minh", "tp hcm", "hcm", "saigon", "sai gon", "thu duc", "go vap", "binh thanh", "tan binh", "phu nhuan", "cu chi"],
  "Hà Nội": ["ha noi", "hanoi", "hoan kiem", "cau giay", "dong da", "ba dinh", "tay ho", "long bien", "ha dong", "nam tu liem", "bac tu liem", "thanh xuan", "my dinh"],
  "Đà Nẵng": ["da nang", "danang", "son tra", "hai chau", "thanh khe", "ngu hanh son"],
  "Hải Phòng": ["hai phong", "haiphong", "le chan", "hong bang", "ngo quyen"],
  "Cần Thơ": ["can tho", "ninh kieu", "cai rang"],
  "Đồng Nai": ["dong nai", "bien hoa", "long khanh", "trang bom"],
  "Bình Dương": ["binh duong", "thu dau mot", "di an", "thuan an", "tan uyen"],
  "Khánh Hòa": ["khanh hoa", "nha trang", "cam ranh"],
  "Lâm Đồng": ["lam dong", "da lat", "dalat", "bao loc"],
  "Thừa Thiên Huế": ["thua thien hue", "thua thien", "hue"],
  "Bà Rịa - Vũng Tàu": ["ba ria", "vung tau"],
  "Quảng Ninh": ["quang ninh", "ha long", "halong", "cam pha", "mong cai"],
  "Hưng Yên": ["hung yen", "ocean park", "ecopark"],
  "Tây Ninh": ["tay ninh", "ben luc"],
  "Long An": ["long an", "tan an"],
  "Nghệ An": ["nghe an", "vinh"],
  "Thanh Hóa": ["thanh hoa", "sam son"],
  "Bắc Ninh": ["bac ninh", "tu son", "que vo"],
  "Bắc Giang": ["bac giang"],
  "Thái Nguyên": ["thai nguyen"],
  "Nam Định": ["nam dinh"],
  "Ninh Bình": ["ninh binh"],
  "Hải Dương": ["hai duong"],
  "Vĩnh Phúc": ["vinh phuc", "vinh yen"],
  "Phú Thọ": ["phu tho", "viet tri"],
  "Quảng Nam": ["quang nam", "tam ky", "hoi an"],
  "Quảng Ngãi": ["quang ngai"],
  "Quảng Bình": ["quang binh", "dong hoi"],
  "Quảng Trị": ["quang tri"],
  "Bình Định": ["binh dinh", "quy nhon"],
  "Phú Yên": ["phu yen", "tuy hoa"],
  "Ninh Thuận": ["ninh thuan", "phan rang"],
  "Bình Thuận": ["binh thuan", "phan thiet"],
  "Đắk Lắk": ["dak lak", "buon ma thuot", "ban me thuot"],
  "Gia Lai": ["gia lai", "pleiku"],
  "Kon Tum": ["kon tum"],
  "Lào Cai": ["lao cai", "sa pa", "sapa"],
  "Sơn La": ["son la"],
  "Lạng Sơn": ["lang son"],
  "Tuyên Quang": ["tuyen quang"],
  "Hòa Bình": ["hoa binh"],
  "Yên Bái": ["yen bai"],
  "Thái Bình": ["thai binh"],
  "Hà Nam": ["ha nam", "phu ly"],
  "Hà Tĩnh": ["ha tinh"],
  "An Giang": ["an giang", "long xuyen", "chau doc"],
  "Kiên Giang": ["kien giang", "rach gia", "phu quoc"],
  "Cà Mau": ["ca mau"],
  "Bạc Liêu": ["bac lieu"],
  "Sóc Trăng": ["soc trang"],
  "Trà Vinh": ["tra vinh"],
  "Vĩnh Long": ["vinh long"],
  "Bến Tre": ["ben tre"],
  "Tiền Giang": ["tien giang", "my tho"],
  "Đồng Tháp": ["dong thap", "cao lanh", "hong ngu"],
  "Hậu Giang": ["hau giang"],
  "Bình Phước": ["binh phuoc", "dong xoai", "chon thanh"],
  "Seoul": ["seoul"],
};

/**
 * The province a piece of text names, or null.
 *
 * The LAST match wins, because a Vietnamese address runs small to large — "628 Phạm Văn Thuận, Tam
 * Hiệp, Biên Hòa, Đồng Nai" names the district before the province, and the province is the answer.
 * Matching is on folded text with word boundaries, so "Vinh" cannot be found inside "Vĩnh Long".
 */
function provinceOf(text: string): string | null {
  const hay = ` ${fold(text)} `;
  let best: { province: string; at: number } | null = null;
  for (const [province, needles] of Object.entries(PROVINCES)) {
    for (const needle of needles) {
      const at = hay.lastIndexOf(` ${needle} `);
      if (at !== -1 && (!best || at > best.at)) best = { province, at };
    }
  }
  return best?.province ?? null;
}

const UNKNOWN = "Chưa xác định";

async function main(): Promise<void> {
  const before = await pool.query<{ city: string; n: number }>(
    `SELECT city, count(*)::int AS n FROM venues GROUP BY city ORDER BY n DESC`,
  );
  console.log(`before: ${before.rows.length} distinct cities across ${before.rows.reduce((s, r) => s + r.n, 0)} venues`);

  const venues = await pool.query<{ id: number; name: string; city: string; raw_address: string | null }>(
    `SELECT id, name, city, raw_address FROM venues`,
  );

  let aliased = 0;
  let derived = 0;
  let stillUnknown = 0;
  const changes = new Map<string, number>();

  for (const venue of venues.rows) {
    let next: string | null = null;

    if (venue.city && venue.city !== UNKNOWN) {
      // Pass 1: a spelling that already names a place, made canonical.
      const canonical = provinceOf(venue.city);
      if (canonical && canonical !== venue.city) {
        next = canonical;
        aliased++;
      }
    } else {
      // Pass 2: no city, so read the address. The name is a fallback — several venues carry their
      // location in the title and nothing else ("KIM LIVESTAGE, … Bien Hoa City, Dong Nai").
      const found = provinceOf(venue.raw_address ?? "") ?? provinceOf(venue.name);
      if (found) {
        next = found;
        derived++;
      } else {
        stillUnknown++;
      }
    }

    if (next) {
      await pool.query(`UPDATE venues SET city = $2 WHERE id = $1`, [venue.id, next]);
      const key = `${venue.city} → ${next}`;
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
  }

  console.log(`\naliased ${aliased}, derived ${derived}, left as "${UNKNOWN}" ${stillUnknown}\n`);
  for (const [key, n] of [...changes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${key}`);
  }

  const after = await pool.query<{ city: string; n: number }>(
    `SELECT city, count(*)::int AS n FROM venues GROUP BY city ORDER BY n DESC`,
  );
  console.log(`\nafter: ${after.rows.length} distinct cities`);
  for (const row of after.rows) console.log(`  ${String(row.n).padStart(4)}  ${row.city}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
