/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vietnam's provinces and centrally-governed cities, as they stand after the 2025 reorganisation:
 * 34 units — 6 cities and 28 provinces, down from 63.
 *
 * ONE list, two readers. The organizer's city picker offers these names, and
 * `server/src/db/normalize-venue-cities.ts` files a venue address under one of them. Those were
 * separate lists and they had already drifted: the picker offered three cities and the matcher knew
 * fifty-eight, so an organizer in Nghệ An could not say so and the frontend's `toCity` quietly
 * relabelled their event "TP.HCM".
 *
 * `aliases` carries what an address might actually say — the pre-merger province names, districts,
 * unaccented spellings, common short forms. They are what makes existing data keep resolving: a
 * venue whose address reads "Thủ Dầu Một, Bình Dương" was written before the merger and still has
 * to land somewhere, and it lands in Tp. Hồ Chí Minh, which is where that address is now.
 *
 * The merger data below is from general knowledge and is worth checking against the official
 * resolution before it goes in front of anyone: names are the part of this that has to be right,
 * and a wrong one is a place an organizer cannot find themselves in.
 */

export interface Province {
  /** The canonical name, as stored and as shown. */
  name: string;
  /** Centrally-governed city rather than a province — the six are conventionally listed first. */
  city?: true;
  /** Spellings, districts and pre-2025 names that should file under `name`. Fold-compared. */
  aliases: string[];
}

export const PROVINCES: readonly Province[] = [
  // ---- The six centrally-governed cities ----
  {
    name: "Tp. Hồ Chí Minh",
    city: true,
    // Absorbed Bình Dương and Bà Rịa – Vũng Tàu.
    aliases: [
      "ho chi minh", "tp hcm", "hcm", "saigon", "sai gon", "thu duc", "go vap", "binh thanh",
      "tan binh", "phu nhuan", "cu chi",
      "binh duong", "thu dau mot", "di an", "thuan an", "tan uyen",
      "ba ria", "vung tau", "ba ria vung tau", "phu my",
    ],
  },
  {
    name: "Hà Nội",
    city: true,
    aliases: [
      "ha noi", "hanoi", "hoan kiem", "cau giay", "dong da", "ba dinh", "tay ho", "long bien",
      "ha dong", "nam tu liem", "bac tu liem", "thanh xuan", "my dinh",
    ],
  },
  {
    name: "Hải Phòng",
    city: true,
    // Absorbed Hải Dương.
    aliases: ["hai phong", "haiphong", "le chan", "hong bang", "ngo quyen", "hai duong", "chi linh"],
  },
  {
    name: "Đà Nẵng",
    city: true,
    // Absorbed Quảng Nam.
    aliases: [
      "da nang", "danang", "son tra", "hai chau", "thanh khe", "ngu hanh son",
      "quang nam", "hoi an", "tam ky", "dien ban",
    ],
  },
  {
    name: "Huế",
    city: true,
    // Thừa Thiên Huế, raised to a centrally-governed city.
    aliases: ["hue", "thua thien hue", "thua thien", "phu vang", "huong thuy"],
  },
  {
    name: "Cần Thơ",
    city: true,
    // Absorbed Sóc Trăng and Hậu Giang.
    aliases: ["can tho", "ninh kieu", "cai rang", "soc trang", "hau giang", "vi thanh", "nga bay"],
  },

  // ---- The twenty-eight provinces ----
  { name: "Lai Châu", aliases: ["lai chau", "tam duong"] },
  { name: "Điện Biên", aliases: ["dien bien", "dien bien phu", "muong lay"] },
  { name: "Sơn La", aliases: ["son la", "moc chau", "mai son"] },
  { name: "Lạng Sơn", aliases: ["lang son", "huu lung", "dong dang"] },
  { name: "Cao Bằng", aliases: ["cao bang", "trung khanh"] },
  { name: "Quảng Ninh", aliases: ["quang ninh", "ha long", "cam pha", "uong bi", "mong cai"] },
  { name: "Thanh Hóa", aliases: ["thanh hoa", "sam son", "bim son"] },
  { name: "Nghệ An", aliases: ["nghe an", "vinh", "cua lo"] },
  { name: "Hà Tĩnh", aliases: ["ha tinh", "hong linh", "ky anh"] },
  // Absorbed Hà Giang.
  { name: "Tuyên Quang", aliases: ["tuyen quang", "ha giang", "dong van", "meo vac"] },
  // Absorbed Yên Bái.
  { name: "Lào Cai", aliases: ["lao cai", "sa pa", "sapa", "yen bai", "nghia lo", "mu cang chai"] },
  // Absorbed Bắc Kạn.
  { name: "Thái Nguyên", aliases: ["thai nguyen", "song cong", "pho yen", "bac kan", "ba be"] },
  // Absorbed Vĩnh Phúc and Hòa Bình.
  {
    name: "Phú Thọ",
    aliases: ["phu tho", "viet tri", "vinh phuc", "vinh yen", "phuc yen", "hoa binh", "luong son"],
  },
  // Absorbed Bắc Giang.
  { name: "Bắc Ninh", aliases: ["bac ninh", "tu son", "bac giang", "viet yen", "yen the"] },
  // Absorbed Thái Bình.
  { name: "Hưng Yên", aliases: ["hung yen", "my hao", "van lam", "thai binh", "tien hai"] },
  // Absorbed Hà Nam and Nam Định.
  {
    name: "Ninh Bình",
    aliases: ["ninh binh", "tam diep", "trang an", "ha nam", "phu ly", "nam dinh", "y yen"],
  },
  // Absorbed Quảng Bình.
  { name: "Quảng Trị", aliases: ["quang tri", "dong ha", "quang binh", "dong hoi", "phong nha"] },
  // Absorbed Kon Tum.
  { name: "Quảng Ngãi", aliases: ["quang ngai", "duc pho", "ly son", "kon tum", "ngoc hoi"] },
  // Absorbed Bình Định.
  { name: "Gia Lai", aliases: ["gia lai", "pleiku", "an khe", "binh dinh", "quy nhon", "an nhon"] },
  // Absorbed Ninh Thuận.
  { name: "Khánh Hòa", aliases: ["khanh hoa", "nha trang", "cam ranh", "ninh thuan", "phan rang"] },
  // Absorbed Đắk Nông and Bình Thuận.
  {
    name: "Lâm Đồng",
    aliases: ["lam dong", "da lat", "dalat", "bao loc", "dak nong", "gia nghia", "binh thuan", "phan thiet", "mui ne"],
  },
  // Absorbed Phú Yên.
  { name: "Đắk Lắk", aliases: ["dak lak", "daklak", "buon ma thuot", "phu yen", "tuy hoa"] },
  // Absorbed Bình Phước.
  { name: "Đồng Nai", aliases: ["dong nai", "bien hoa", "long khanh", "trang bom", "binh phuoc", "dong xoai"] },
  // Absorbed Long An.
  { name: "Tây Ninh", aliases: ["tay ninh", "trang bang", "long an", "tan an", "duc hoa"] },
  // Absorbed Bến Tre and Trà Vinh.
  { name: "Vĩnh Long", aliases: ["vinh long", "binh minh", "ben tre", "mo cay", "tra vinh", "duyen hai"] },
  // Absorbed Tiền Giang.
  { name: "Đồng Tháp", aliases: ["dong thap", "cao lanh", "sa dec", "tien giang", "my tho", "cai lay"] },
  // Absorbed Bạc Liêu.
  { name: "Cà Mau", aliases: ["ca mau", "nam can", "bac lieu", "gia rai"] },
  // Absorbed Kiên Giang.
  { name: "An Giang", aliases: ["an giang", "long xuyen", "chau doc", "kien giang", "rach gia", "phu quoc"] },
];

/** Just the names, in the order above — cities first, then provinces. */
export const PROVINCE_NAMES: readonly string[] = PROVINCES.map((p) => p.name);

/**
 * Diacritics and punctuation removed, for comparing what somebody typed against what we hold.
 *
 * `đ` is handled before the combining marks are stripped: it is a distinct letter rather than a `d`
 * with an accent, so `normalize("NFD")` leaves it alone and it has to be replaced by hand.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The province a free-text address belongs to, or null.
 *
 * Matches on the LAST alias to appear, because a Vietnamese address runs from the smallest unit to
 * the largest — "Quận 1, Tp. Hồ Chí Minh" ends with the province, and a street named after another
 * city would otherwise win.
 */
export function provinceOf(text: string): string | null {
  const hay = ` ${fold(text)} `;
  let best: { name: string; at: number } | null = null;

  for (const province of PROVINCES) {
    for (const alias of [fold(province.name), ...province.aliases]) {
      const at = hay.lastIndexOf(` ${alias} `);
      if (at !== -1 && (!best || at > best.at)) best = { name: province.name, at };
    }
  }

  return best ? best.name : null;
}
