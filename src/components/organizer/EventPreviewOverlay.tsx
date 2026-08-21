/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import type { EventDetail } from "@/shared/catalog/types";
import { organizerApi } from "../../services/catalogClient";
import { ageRestrictionLabel } from "@/shared/catalog/age-restriction";
import { formatVnd } from "../../services/currency";
import { ErrorRetry, Loading } from "./states";

/**
 * The organizer's listing, as a buyer would meet it — before it goes for review.
 *
 * Every surveyed ticketing platform puts a preview immediately before the publish decision, and for
 * a good reason: the organizer has been looking at a FORM, and a form tells you nothing about what
 * the thing you are about to publish reads like. Until now the first person to see a TixHub listing
 * was the admin reviewing it.
 *
 * Read through the owner-side endpoint rather than the buyer's URL, because the buyer's URL 404s on
 * anything not yet on sale (SC-004) — which is precisely the state a preview is for.
 *
 * It shows the listing's SUBSTANCE, not a pixel copy of the event page: banner, title, category,
 * age limit, description, prices. Those are the fields an organizer can still change at this point,
 * and a preview that invited them to fix things they cannot yet control would waste their time.
 */
export default function EventPreviewOverlay({
  eventId,
  onClose,
}: {
  eventId: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * Fetch only — no synchronous reset.
   *
   * The overlay is mounted fresh per preview, so `eventId` cannot change underneath it and there is
   * no stale detail to clear. Clearing anyway would be a `setState` during the effect, which React
   * has to throw away and re-render past (`react-hooks/set-state-in-effect`).
   */
  const fetchPreview = useCallback(() => {
    organizerApi
      .preview(eventId)
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [eventId]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  /** The retry button is an event handler, so clearing the failure here is free of that constraint. */
  const retry = () => {
    setError(null);
    setDetail(null);
    fetchPreview();
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl border-2 border-beige-kem bg-surface-2"
      >
        {/* Named as a preview at the top, so a screenshot of this can never be mistaken for the
            live page by whoever it gets sent to. */}
        <div className="flex items-center justify-between border-b border-beige-kem/25 bg-cam-dat/15 px-5 py-3">
          <p
            id="preview-title"
            className="font-meta text-eyebrow font-bold uppercase tracking-widest text-cam-dat"
          >
            Xem trước — chưa hiển thị công khai
          </p>
          <button
            ref={closeRef}
            onClick={onClose}
            className="border border-beige-kem/40 px-3 py-1 text-xs font-bold text-beige-kem"
          >
            Đóng
          </button>
        </div>

        {error && <ErrorRetry message={error} onRetry={retry} />}
        {!error && !detail && <Loading label="Đang tải bản xem trước…" />}

        {detail && (
          <div className="space-y-4 p-5">
            {/* The cover slot is always drawn — an empty banner renders as a named placeholder
                rather than a blank gap, so the organizer sees WHAT is missing, and where. */}
            {detail.imageUrl ? (
              <img src={detail.imageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
            ) : (
              <div
                className="flex aspect-[16/9] w-full items-center justify-center gap-2.5 border border-beige-kem/20"
                style={{ background: "#f0e3d0" }}
              >
                <Image className="h-[30px] w-[30px] text-ink-soft" />
                <span className="font-meta text-meta text-ink-soft">Ảnh bìa sự kiện 16:9</span>
              </div>
            )}

            <div>
              <h2 className="font-display text-title-m font-black text-beige-kem">
                {detail.title}
              </h2>
              <p className="mt-1 font-meta text-meta text-ink-soft">
                {detail.categoryLabel}
                {detail.ageRestriction ? ` · ${ageRestrictionLabel(detail.ageRestriction)}` : ""}
                {detail.city ? ` · ${detail.city}` : ""}
              </p>
            </div>

            {/* Empty is said out loud rather than rendered as a blank gap — a buyer would meet an
                event with no description, and the organizer should see that now. */}
            <div>
              <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-beige-kem/60">
                Giới thiệu
              </h3>
              {detail.description?.trim() ? (
                <p className="mt-1 whitespace-pre-line font-meta text-meta leading-6 text-beige-kem/85">
                  {detail.description}
                </p>
              ) : (
                <p className="mt-1 font-meta text-meta text-cam-dat">
                  Chưa có mô tả — khách sẽ thấy phần này trống.
                </p>
              )}
            </div>

            <div>
              <h3 className="font-meta text-eyebrow font-bold uppercase tracking-widest text-beige-kem/60">
                Giá vé
              </h3>
              {detail.tiers.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {detail.tiers.map((t) => (
                    <li
                      key={`${t.id}-${t.label}`}
                      className="flex justify-between font-meta text-meta text-beige-kem/85"
                    >
                      <span>{t.label}</span>
                      <span className="tabular-nums">{formatVnd(t.price)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 font-meta text-meta text-cam-dat">
                  Chưa có hạng vé — khách chưa mua được gì.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
