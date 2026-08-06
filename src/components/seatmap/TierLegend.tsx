/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SeatMapTierLegendEntry } from "@/shared/catalog/types";

/**
 * The buyer's price key (FR-067, FR-071).
 *
 * One component used by BOTH buyer renderers, so the event page and the seat-selection screen cannot
 * drift into two visual languages (FR-069). The colours come from the server, derived from the tier
 * order by price — nothing is stored, so there is no value for the two screens to disagree about.
 *
 * The legend, not the colour, is the authority: it names every tier and its price in whole đồng, so a
 * buyer who cannot distinguish two colours still learns what a seat costs.
 */
export default function TierLegend({ legend }: { legend?: SeatMapTierLegendEntry[] }) {
  if (!legend || legend.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Bảng giá theo hạng vé">
      {legend.map((t) => (
        <span key={t.tierId} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-beige-kem/40"
            style={{ backgroundColor: t.color }}
            aria-hidden="true"
          />
          <span className="text-xs text-beige-kem/80">
            {t.label} — <b>{t.price.toLocaleString("vi-VN")}đ</b>
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * A seat's fill. Status outranks price on purpose (FR-068): a sold or held seat must keep reading as
 * unavailable whatever its tier colour, because "can I have it" is a more urgent question than
 * "what does it cost".
 */
export function seatFillStyle(
  status: string,
  tierId: number | null | undefined,
  legend?: SeatMapTierLegendEntry[],
): { backgroundColor?: string; opacity?: number } {
  if (status !== "available") return {};
  const color = legend?.find((t) => t.tierId === tierId)?.color;
  return color ? { backgroundColor: color } : {};
}
