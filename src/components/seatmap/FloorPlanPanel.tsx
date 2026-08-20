/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { LayoutFloorPlan } from "@/shared/catalog/seatmap";
import { layoutApi } from "../../services/catalogClient";

import { MediaDropzone } from "../common/MediaDropzone";
import ConfirmDialog from "../ConfirmDialog";

/**
 * Floor-plan upload and alignment (FR-020..FR-026a).
 *
 * The plan is a BACKGROUND LAYER ONLY: it never creates a seat and never determines a seat's status
 * — the database decides (Principle I). Aligning it moves the picture under the seats; the seats
 * themselves never move (FR-024), and removing it leaves every position untouched (FR-025).
 */

const btn =
  " border-2 border-beige-kem px-2.5 py-1.5 text-eyebrow font-bold text-beige-kem/80 transition hover:text-beige-kem disabled:opacity-40";

export default function FloorPlanPanel({
  layoutId,
  plan,
  onChange,
}: {
  layoutId: number;
  plan: LayoutFloorPlan;
  onChange: (plan: LayoutFloorPlan) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<LayoutFloorPlan | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) onChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const align = (patch: Partial<Omit<LayoutFloorPlan, "url">>) =>
    run(() =>
      layoutApi.alignPlan(layoutId, {
        scale: patch.scale ?? plan.scale,
        offsetX: patch.offsetX ?? plan.offsetX,
        offsetY: patch.offsetY ?? plan.offsetY,
        opacity: patch.opacity ?? plan.opacity,
        visibleToBuyers: patch.visibleToBuyers ?? plan.visibleToBuyers,
      }),
    );

  return (
    <div className="border-2 border-beige-kem bg-surface-2 p-4 space-y-3">
      <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-beige-kem/70">
        Bản vẽ mặt bằng
      </h3>

      <MediaDropzone
        label="Tải lên bản vẽ mặt bằng"
        mediaType="floorplan"
        currentUrl={plan.url}
        // The dropzone reports `null` when its own clear button empties the field. That is not an
        // upload of nothing — removal has its own call below, and firing this one with no file
        // would post an empty body to the upload route.
        onFileSelected={(file) => {
          if (file) void run(() => layoutApi.uploadPlan(layoutId, file));
        }}
        // Asked first. Deleting the file is not undoable and the organizer may have spent a while
        // aligning it — every other destructive action in this editor confirms, and this one being
        // one click was an inconsistency waiting to cost somebody their upload.
        onRemove={() => setConfirmRemove(true)}
        helpText="JPG, PNG, WEBP hoặc SVG tối đa 5MB"
        aspectRatio="banner"
        disabled={busy}
      />

      {error && <p className="mt-2 text-meta text-on-tint">{error}</p>}

      {plan.url && (
        <>
          <label className="mt-3 block font-meta text-eyebrow text-beige-kem/60">
            Tỉ lệ {plan.scale}‰
            <input
              type="range"
              min={100}
              max={3000}
              step={50}
              value={plan.scale}
              disabled={busy}
              onChange={(e) => align({ scale: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="block font-meta text-eyebrow text-beige-kem/60">
            Lệch ngang {plan.offsetX}
            <input
              type="range"
              min={-5000}
              max={5000}
              step={50}
              value={plan.offsetX}
              disabled={busy}
              onChange={(e) => align({ offsetX: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="block font-meta text-eyebrow text-beige-kem/60">
            Lệch dọc {plan.offsetY}
            <input
              type="range"
              min={-5000}
              max={5000}
              step={50}
              value={plan.offsetY}
              disabled={busy}
              onChange={(e) => align({ offsetY: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="block font-meta text-eyebrow text-beige-kem/60">
            Độ mờ {plan.opacity}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={plan.opacity}
              disabled={busy}
              onChange={(e) => align({ opacity: Number(e.target.value) })}
              className="w-full"
            />
          </label>

          <label className="mt-3 flex items-center gap-2 text-meta text-beige-kem/80">
            <input
              type="checkbox"
              checked={plan.visibleToBuyers}
              disabled={busy}
              onChange={(e) => align({ visibleToBuyers: e.target.checked })}
            />
            Cho người mua xem bản vẽ
          </label>

          {/* Said plainly at upload time rather than discovered later: the toggle governs display,
              not reachability. The file sits at an unguessable URL with no access check (FR-026a). */}
          <p className="mt-2 text-eyebrow leading-4 text-beige-kem/45">
            Ảnh được lưu ở một đường dẫn ngẫu nhiên. Bất kỳ ai có đường dẫn đều mở được, kể cả khi
            tuỳ chọn trên đang tắt — tuỳ chọn chỉ quyết định việc hiển thị trên sơ đồ.
          </p>

          <button
            className={`${btn} mt-3`}
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            Xoá bản vẽ
          </button>
        </>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Xoá bản vẽ mặt bằng?"
          message="Tệp sẽ bị xoá khỏi máy chủ và không khôi phục được. Căn chỉnh đã lưu cũng mất theo."
          confirmLabel="Xoá"
          cancelLabel="Giữ lại"
          tone="danger"
          onConfirm={() => {
            setConfirmRemove(false);
            void run(async () => {
              await layoutApi.removePlan(layoutId);
              return { ...plan, url: null };
            });
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}
