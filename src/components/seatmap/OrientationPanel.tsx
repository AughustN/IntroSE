import type { DocumentBlock } from "@/shared/catalog/seatmap-document";

import { RAIL_PANEL } from "./panelSurface";
const btn =
  "border border-beige-kem/50 px-2 py-1 font-mono text-[10px] font-bold text-beige-kem/80 transition hover:border-beige-kem hover:text-beige-kem";

export default function OrientationPanel({
  stages,
  primaryKey,
  onAdd,
  onFocus,
  onMakePrimary,
}: {
  stages: DocumentBlock[];
  primaryKey: string | null;
  onAdd: () => void;
  onFocus: (key: string) => void;
  onMakePrimary: (key: string) => void;
}) {
  return (
    <div className={RAIL_PANEL}>
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-beige-kem/70">
        Hướng khán giả
      </h3>

      {stages.length === 0 ? (
        <div className="mt-3 border border-cam-dat-ink/70 p-3">
          <p className="text-[11px] leading-4 text-cam-dat-ink">
            Chưa có sân khấu. Hệ thống đang dùng tâm của toàn bộ ghế làm điểm hướng.
          </p>
          <button type="button" className={`${btn} mt-2`} onClick={onAdd}>
            Thêm sân khấu tại khung nhìn
          </button>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {stages.map((stage) => (
            <li key={stage.key} className="border border-beige-kem/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-beige-kem">{stage.title}</span>
                {stage.key === primaryKey && (
                  <span className="shrink-0 bg-la-co/20 px-1.5 py-0.5 font-mono text-[9px] text-la-co-ink">
                    Điểm chính
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[10px] text-beige-kem/70">
                Tâm {Math.round(stage.x + stage.width / 2)},{" "}
                {Math.round(stage.y + stage.height / 2)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className={btn} onClick={() => onFocus(stage.key)}>
                  Xem trên sơ đồ
                </button>
                {stage.key !== primaryKey && (
                  <button type="button" className={btn} onClick={() => onMakePrimary(stage.key)}>
                    Dùng làm điểm chính
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {stages.length > 1 && (
        <p className="mt-2 text-[10px] leading-4 text-beige-kem/70">
          Sơ đồ có nhiều sân khấu; sân khấu được đánh dấu “Điểm chính” quyết định gợi ý ghế.
        </p>
      )}
    </div>
  );
}
