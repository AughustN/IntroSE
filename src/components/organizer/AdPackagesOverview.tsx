import { ArrowDown, ArrowUpRight, Check, ChevronDown, Flame, Play, Repeat2 } from "lucide-react";
import { AD_POLICY, AD_TERMS, type AdPackage } from "@shared/ads/types.js";
import { formatVnd } from "../../services/currency";

export const adButton =
  "inline-flex min-h-12 items-center justify-center gap-2 border px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-beige-kem";
export const adPrimary = `${adButton} border-burgundy bg-burgundy text-white hover:brightness-110`;
export const adSecondary = `${adButton} border-beige-kem/35 text-beige-kem hover:bg-beige-kem/5`;

export function focusAdSection(id: string) {
  const section = document.getElementById(id);
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "start",
  });
}

/** A schematic, not a paid event or a promise of exclusive placement. */
function PlacementPreview() {
  return (
    <figure className="min-w-0 border border-beige-kem/25 bg-surface-2 p-5 sm:p-7">
      <div aria-hidden="true">
        <div className="flex items-center justify-between border-b border-beige-kem/20 pb-4">
          <span className="font-display text-2xl font-black">TixHub</span>
          <span className="text-xs text-ink-soft">TRANG CHỦ</span>
        </div>
        <div className="relative mt-5 flex min-h-44 items-center justify-center overflow-hidden border border-burgundy/30 bg-burgundy/5 p-6">
          <div className="absolute inset-6 rotate-6 border border-burgundy/20" />
          <div className="absolute inset-9 -rotate-6 border border-burgundy/20" />
          <div className="relative flex flex-col items-center gap-3 text-center">
            <Play className="h-9 w-9 text-burgundy-ink" strokeWidth={1.5} />
            <span className="font-display text-2xl font-bold">Sự kiện của bạn</span>
            <span className="text-xs text-ink-soft">01 / Trailer đầu trang</span>
          </div>
        </div>
        <div className="mb-3 mt-5 flex items-center justify-between text-sm font-semibold">
          <span>Sự kiện hot</span>
          <Flame className="h-4 w-4 text-burgundy-ink" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((n) => (
            <div
              key={n}
              className={`flex aspect-[4/3] items-center justify-center border ${n === 0 ? "border-burgundy/50 bg-burgundy/10" : "border-beige-kem/20 bg-beige-kem/5"}`}
            >
              {n === 0 ? (
                <ArrowUpRight className="h-6 w-6 text-burgundy-ink" />
              ) : (
                <span className="h-1 w-8 bg-beige-kem/15" />
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-5 border-t border-beige-kem/20 pt-4 text-xs leading-relaxed text-ink-soft">
        Minh họa hai vị trí quảng cáo trên trang chủ. Nội dung được luân phiên, không giữ vị trí độc
        quyền.
      </figcaption>
    </figure>
  );
}

export function AdIntroduction() {
  return (
    <>
      <section
        className="grid items-center gap-8 py-4 lg:grid-cols-[1.1fr_1fr] lg:gap-12"
        aria-labelledby="ad-intro-title"
      >
        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-burgundy-ink">
            TixHub dành cho nhà tổ chức
          </p>
          <h3
            id="ad-intro-title"
            className="max-w-xl font-display text-4xl font-black leading-tight sm:text-5xl"
          >
            Đưa sự kiện của bạn
            <br className="hidden sm:block" /> lên vị trí nổi bật.
          </h3>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-soft">
            Chọn vị trí và thời gian quảng bá phù hợp. Theo dõi lượt hiển thị và lượt nhấp ngay
            trong trang quản lý chiến dịch.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              className={adPrimary}
              onClick={() => focusAdSection("ad-packages")}
            >
              Xem các gói <ArrowDown aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={adSecondary}
              onClick={() => focusAdSection("ad-placements")}
            >
              Xem vị trí hiển thị
            </button>
          </div>
        </div>
        <PlacementPreview />
      </section>
      <section
        id="ad-placements"
        tabIndex={-1}
        aria-labelledby="ad-placements-title"
        className="scroll-mt-24 border-t border-beige-kem/20 pt-8"
      >
        <p className="text-sm font-semibold text-burgundy-ink">01 — VỊ TRÍ HIỂN THỊ</p>
        <h3 id="ad-placements-title" className="mt-2 font-display text-3xl font-bold">
          Xuất hiện đúng nơi khán giả khám phá
        </h3>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <article className="border-l-2 border-burgundy pl-5">
            <Play aria-hidden="true" className="mb-4 h-6 w-6 text-burgundy-ink" />
            <h4 className="text-lg font-semibold">Trailer trang chủ</h4>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Giới thiệu không khí sự kiện bằng video tại khu vực đầu trang. Cần trailer hợp lệ, có
              thể phát được.
            </p>
          </article>
          <article className="border-l-2 border-beige-kem/35 pl-5">
            <Flame aria-hidden="true" className="mb-4 h-6 w-6 text-burgundy-ink" />
            <h4 className="text-lg font-semibold">Sự kiện hot</h4>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Đưa thẻ sự kiện vào danh sách nổi bật trên trang chủ, giúp khán giả mở trang chi tiết
              để tìm hiểu và mua vé.
            </p>
          </article>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-ink-soft">
          Các chiến dịch cùng vị trí có trọng số ngang nhau. Gói dài ngày kéo dài thời gian quảng
          bá, không tăng mức ưu tiên mỗi lượt.
        </p>
      </section>
    </>
  );
}

export function AdComparison({ packages }: { packages: AdPackage[] }) {
  if (!packages.length) return null;
  return (
    <details className="group border border-beige-kem/25 bg-surface-2">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-5 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-beige-kem">
        So sánh quyền lợi từng gói
        <ChevronDown
          aria-hidden="true"
          className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div
        role="region"
        aria-label="Bảng so sánh gói, cuộn ngang để xem thêm"
        tabIndex={0}
        className="overflow-x-auto border-t border-beige-kem/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-beige-kem"
      >
        <table className="w-full min-w-[620px] text-left text-sm">
          <caption className="sr-only">So sánh giá, thời lượng và vị trí quảng cáo</caption>
          <thead>
            <tr className="bg-beige-kem/5">
              <th scope="col" className="p-4">
                Quyền lợi
              </th>
              {packages.map((pkg) => (
                <th scope="col" key={pkg.id} className="p-4">
                  {pkg.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-beige-kem/15">
              <th scope="row" className="p-4 font-medium">
                Giá gói
              </th>
              {packages.map((pkg) => (
                <td key={pkg.id} className="whitespace-nowrap p-4 tabular-nums">
                  {formatVnd(pkg.price)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-beige-kem/15">
              <th scope="row" className="p-4 font-medium">
                Thời lượng
              </th>
              {packages.map((pkg) => (
                <td key={pkg.id} className="p-4">
                  {pkg.durationDays} ngày
                </td>
              ))}
            </tr>
            {(
              [
                ["hero_trailer", "Trailer trang chủ"],
                ["hot_events", "Sự kiện hot"],
              ] as const
            ).map(([placement, label]) => (
              <tr key={placement} className="border-t border-beige-kem/15">
                <th scope="row" className="p-4 font-medium">
                  {label}
                </th>
                {packages.map((pkg) => (
                  <td key={pkg.id} className="p-4">
                    {pkg.placements.includes(placement) ? (
                      <span className="inline-flex items-center gap-2">
                        <Check aria-hidden="true" className="h-4 w-4" />
                        Có
                      </span>
                    ) : (
                      "Không bao gồm"
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-beige-kem/15">
              <th scope="row" className="p-4 font-medium">
                Báo cáo hiển thị / nhấp
              </th>
              {packages.map((pkg) => (
                <td key={pkg.id} className="p-4">
                  Có
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

const steps = [
  ["Chọn gói và sự kiện", "Chọn vị trí, thời lượng và sự kiện đang mở bán phù hợp."],
  ["Kiểm tra và thanh toán", "Xem lại quyền lợi, điều khoản và tổng tiền trừ từ ví."],
  ["Theo dõi chiến dịch", "Chiến dịch bắt đầu sau thanh toán. Xem số liệu trong tab quản lý."],
];
const faqs = [
  [
    "Nếu nhiều nhà tổ chức cùng mua một gói thì sao?",
    "Các chiến dịch cùng vị trí được luân phiên với trọng số ngang nhau. Gói có giá cao hơn hoặc dài ngày hơn không được ưu tiên lượt ở cùng vị trí. Hệ thống giới hạn số chiến dịch nhận vào; tình trạng chỗ được kiểm tra lại khi thanh toán.",
  ],
  [
    "Sự kiện nào có thể mua quảng cáo?",
    "Sự kiện của nhà tổ chức đã được duyệt, đang mở bán và còn suất chưa diễn. Suất diễn cuối phải sau ngày hết hạn gói; không được có chiến dịch còn hạn cho cùng sự kiện. Gói trailer cần video hợp lệ. Máy chủ kiểm tra lại trước khi thu tiền.",
  ],
  [
    "Lượt hiển thị có phải số người đã xem không?",
    "Không. Một lượt hiển thị được ghi nhận khi ít nhất 50% quảng cáo xuất hiện trong vùng nhìn thấy trong 1 giây. Mỗi chỉ số được khử trùng trong 30 phút theo dấu vết truy cập ẩn danh; đây không phải số người duy nhất.",
  ],
  [
    "Nếu sự kiện bị ẩn hoặc phải duyệt lại?",
    "Quảng cáo không hiển thị khi sự kiện không còn đủ điều kiện, nhưng thời hạn đã mua vẫn tiếp tục tính. Hãy kiểm tra nội dung sự kiện trước khi bắt đầu chiến dịch.",
  ],
  [
    "Có bảo đảm bán được vé hoặc hoàn tiền tự động không?",
    "Không cam kết số lượt xem, nhấp hoặc vé bán và không có cơ chế hoàn tiền tự động. Lỗi nền tảng đã được xác minh được xem xét bù thời gian tương ứng theo điều kiện vận hành; không áp dụng cho lượng truy cập thấp.",
  ],
];

export function AdGuide() {
  return (
    <>
      <section aria-labelledby="ad-steps-title" className="border-t border-beige-kem/20 pt-8">
        <p className="text-sm font-semibold text-burgundy-ink">03 — BẮT ĐẦU QUẢNG BÁ</p>
        <h3 id="ad-steps-title" className="mt-2 font-display text-3xl font-bold">
          Từ lựa chọn đến chiến dịch, trong ba bước
        </h3>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {steps.map(([title, description], i) => (
            <li key={title} className="border-t border-beige-kem/25 pt-5">
              <span aria-hidden="true" className="font-display text-3xl text-burgundy-ink">
                0{i + 1}
              </span>
              <h4 className="mt-3 text-base font-semibold">{title}</h4>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="ad-faq-title" className="border-t border-beige-kem/20 pt-8">
        <h3 id="ad-faq-title" className="font-display text-3xl font-bold">
          Giải đáp trước khi bắt đầu
        </h3>
        <div className="mt-5 divide-y divide-beige-kem/20">
          {faqs.map(([question, answer]) => (
            <details key={question} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-beige-kem">
                {question}
                <ChevronDown
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="max-w-3xl pb-5 text-sm leading-relaxed text-ink-soft">{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <AdTerms />
    </>
  );
}

export function AdTerms() {
  return (
    <section
      id="ad-terms"
      tabIndex={-1}
      aria-labelledby="ad-terms-title"
      className="scroll-mt-24 border border-beige-kem/25 bg-surface-2 p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="ad-terms-title" className="font-display text-3xl font-bold">
          Điều khoản quảng cáo
        </h3>
      </div>
      <p className="mt-4 text-sm leading-relaxed">{AD_TERMS}</p>
      <dl className="mt-6 grid gap-6 text-sm md:grid-cols-2">
        <div>
          <dt className="font-semibold">Điều kiện nội dung</dt>
          <dd className="mt-2 leading-relaxed text-ink-soft">
            Sự kiện phải được duyệt và đủ điều kiện mở bán trong thời gian quảng cáo. Suất diễn cuối
            phải sau ngày hết hạn gói. Vị trí trailer yêu cầu video hợp lệ.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Thanh toán và thời hạn</dt>
          <dd className="mt-2 leading-relaxed text-ink-soft">
            Thanh toán một lần từ ví. Chiến dịch bắt đầu ngay sau thanh toán; thời gian chính xác
            được ghi trong chi tiết chiến dịch. Không tự động gia hạn.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Đo lường</dt>
          <dd className="mt-2 leading-relaxed text-ink-soft">
            Báo cáo gồm lượt hiển thị, nhấp và phát video nếu có. Đây không phải số người duy nhất
            hay cam kết hiệu quả bán vé.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Gián đoạn và bù thời gian</dt>
          <dd className="mt-2 leading-relaxed text-ink-soft">
            Bù thời gian do quản trị viên xử lý sau khi xác minh sự cố nền tảng, tùy chỗ còn lại,
            thời gian diễn và chiến dịch trùng lịch. Không tự động hoàn tiền hoặc bù vì ít lượt xem.
          </dd>
        </div>
      </dl>
    </section>
  );
}
