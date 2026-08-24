/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";

/**
 * First-open coachmarks for the chart editor (Phase 4 / FareHarbor parity).
 *
 * Shown ONCE — the very first time any chart opens on this browser, and only while the chart is
 * still empty. A first-timer staring at a blank canvas with a dozen rail groups has no map of the
 * map: what a block is, where the seats come from, how a draft becomes sellable. Rather than a
 * tour that walks the organizer's pointer around the screen (fragile, and wrong the moment the
 * layout changes), this is five sentences the organizer can actually hold in mind, and the toolbar
 * already names every tool in words.
 *
 * The "once" lives in one localStorage flag, not per chart: reading the same five sentences for the
 * second chart would be noise, and the chart is the hard part, not the editor around it.
 */

const STEPS: { title: string; body: string }[] = [
  {
    title: "Vẽ một khối chỗ ngồi",
    body: 'Mở chế độ "Thêm" ở bên trái, chọn "Khối ghế", rồi bấm hoặc kéo khối vào bản vẽ. Mỗi khối giữ số hàng, số ghế và khoảng cách để bạn có thể chỉnh lại sau.',
  },
  {
    title: "Khu vực & hạng ghế",
    body: 'Chọn khối, mở "Khu vực" để gom theo vị trí, rồi mở "Hạng ghế" để phân loại bán. Giá vé vẫn được gán ở bước thiết lập suất chiếu.',
  },
  {
    title: "Lưu, rồi phát hành",
    body: '"Lưu ngay" giữ bản nháp. Sơ đồ chỉ có thể áp cho suất chiếu sau khi bấm "Phát hành" — mở chế độ "Kiểm tra" bên trái để sửa hết lỗi trước.',
  },
  {
    title: "Áp sơ đồ cho suất chiếu",
    body: 'Sơ đồ thuộc về địa điểm, không thuộc sự kiện. Sau khi phát hành, mở "Sơ đồ ghế" từ sự kiện để áp sơ đồ này cho từng suất và gán hạng vé.',
  },
  {
    title: "Có phím tắt",
    body: 'Ctrl+Z hoàn tác, các phím mũi tên di chuyển khối đang chọn. Bấm "Phím tắt" trên thanh công cụ để xem toàn bộ.',
  },
];

export default function ChartEditorCoachmarks({ onDone }: { onDone: () => void }) {
  const firstBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onDone}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coachmarks-title"
        onClick={(e) => e.stopPropagation()}
        /*
         * Capped to the viewport, with the list — not the panel — taking the scroll.
         *
         * At a 656px-tall window the five steps pushed "Bắt đầu vẽ" below the bottom edge, so the
         * only visible way out of a first-run dialog was off screen. Escape worked, but nothing said
         * so, and this is the very first thing an organizer meets in the editor. Keeping the heading
         * and the button pinned while the steps scroll means the way out is always on screen.
         */
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col border-2 border-beige-kem bg-xanh-pho p-6 text-beige-kem"
      >
        <p className="font-meta text-meta uppercase tracking-widest text-burgundy-ink">
          Làm quen nhanh
        </p>
        <h2 id="coachmarks-title" className="mt-1 font-display text-title-m font-black">
          5 điều cần biết trước khi vẽ
        </h2>

        <ol className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border border-beige-kem/25 bg-surface-2 p-3">
              <div>
                <p className="text-eyebrow font-bold">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-1 font-meta text-meta leading-5 text-beige-kem/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex shrink-0 items-center justify-between gap-3">
          <p className="font-meta text-meta text-beige-kem/70">
            Có thể mở lại bằng nút Hướng dẫn trên thanh công cụ.
          </p>
          <button
            ref={firstBtn}
            onClick={onDone}
            className="bg-burgundy px-5 py-2.5 font-meta text-body font-bold text-white transition hover:brightness-95"
          >
            Mở trình thiết kế
          </button>
        </div>
      </div>
    </div>
  );
}
