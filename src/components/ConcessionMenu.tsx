/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Minus, Plus, Popcorn } from "lucide-react";
import type { PublicConcession } from "@/shared/types/fnb";
import { formatVnd } from "../services/currency";

interface ConcessionMenuProps {
  items: PublicConcession[];
  /** Current quantity per item id — absent means zero. */
  quantities: Record<number, number>;
  busy: boolean;
  onChange: (concessionItemId: number, quantity: number) => void;
}

/**
 * The snack picker on the checkout screen (014 FR-004).
 *
 * Presentational on purpose: quantities live in the parent so the order summary, the wallet
 * balance colouring and the charge all read one number. Stepping is bounded at ten here to match
 * the server's cap — a control that lets you reach eleven just to watch it refuse is not honest.
 */
const MAX_PER_ITEM = 10;

export default function ConcessionMenu({
  items,
  quantities,
  busy,
  onChange,
}: ConcessionMenuProps) {
  if (items.length === 0) return null;

  return (
    <section className="border border-beige-kem/35 bg-surface-2 p-5 sm:p-6" aria-label="Bắp nước">
      <div className="flex items-center gap-3">
        <Popcorn aria-hidden="true" className="h-5 w-5 text-beige-kem" />
        <h3 className="font-display text-body font-black uppercase tracking-[0.04em] text-beige-kem">
          Bắp nước & đồ uống
        </h3>
        <span className="ml-auto font-meta text-meta text-ink-soft">
          Nhận tại quầy sự kiện · tối đa 10 phần/món
        </span>
      </div>

      <ul className="mt-4 divide-y divide-beige-kem/20">
        {items.map((item) => {
          const qty = quantities[item.id] ?? 0;
          return (
            <li key={item.id} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-meta text-body text-beige-kem">{item.label}</p>
                {item.description && (
                  <p className="truncate font-meta text-meta text-ink-soft">{item.description}</p>
                )}
              </div>

              <span className="font-meta text-body tabular-nums text-beige-kem">
                {formatVnd(item.priceAmount)}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Bớt một ${item.label}`}
                  disabled={busy || qty === 0}
                  onClick={() => onChange(item.id, Math.max(qty - 1, 0))}
                  className="grid h-8 w-8 place-items-center border border-beige-kem/40 text-beige-kem transition hover:border-beige-kem disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus aria-hidden="true" className="h-4 w-4" />
                </button>
                <span
                  className="w-6 text-center font-meta text-body tabular-nums text-beige-kem"
                  aria-live="polite"
                >
                  {qty}
                </span>
                <button
                  type="button"
                  aria-label={`Thêm một ${item.label}`}
                  disabled={busy || qty >= MAX_PER_ITEM}
                  onClick={() => onChange(item.id, Math.min(qty + 1, MAX_PER_ITEM))}
                  className="grid h-8 w-8 place-items-center border border-beige-kem/40 text-beige-kem transition hover:border-beige-kem disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
