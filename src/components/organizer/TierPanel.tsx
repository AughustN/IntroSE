/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import type { ManagedTier } from "@/shared/catalog/types";
import { studioApi } from "../../services/catalogClient";
import { Empty, ErrorRetry, Loading, Refusal, dong } from "./states";

const MAX_ACTIVE_TIERS = 4;

const input =
  "h-10 w-full border-2 border-beige-kem/60 bg-surface-2 px-3 text-sm text-beige-kem outline-none focus:border-burgundy";
const btn =
  " bg-burgundy px-3 py-2 text-xs font-black text-white transition hover:brightness-95 disabled:opacity-50";
const ghost =
  " border-2 border-beige-kem px-3 py-1.5 text-xs font-bold text-beige-kem/80 disabled:opacity-40";

/**
 * Level 4 of the console: a showtime's ticket tiers (UC-26).
 *
 * The sold / held / remaining columns are not decoration. A refusal that says "capacity is below what
 * is committed" is meaningless on a screen that never showed those numbers, so they are shown before
 * the organizer can trigger the refusal (FR-009).
 */
export default function TierPanel({
  showtimeId,
  onChanged,
}: {
  showtimeId: number;
  /** Fired when a write returned the event for review, so the parent can refresh its badge. */
  onChanged: (returnedToReview: boolean) => void;
}) {
  const [tiers, setTiers] = useState<ManagedTier[] | null>(null);
  const [eventType, setEventType] = useState<"general_admission" | "seated">("general_admission");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCapacity, setNewCapacity] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    setTiers(null);
    try {
      const res = await studioApi.tiers(showtimeId);
      setTiers(res.tiers);
      setEventType(res.eventType);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [showtimeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const seated = eventType === "seated";
  const active = (tiers ?? []).filter((t) => !t.archived);

  /** Every write funnels through here so a refusal is surfaced, not swallowed, and input survives. */
  const run = async (fn: () => Promise<{ returnedToReview: boolean }>) => {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fn();
      onChanged(res.returnedToReview);
      await load();
      return true;
    } catch (e) {
      setRefusal((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const price = Number(newPrice);
    if (!newLabel.trim() || !Number.isInteger(price) || price < 0) {
      setRefusal("Hạng vé cần tên và giá là số nguyên đồng không âm.");
      return;
    }
    const capacity = seated || newCapacity === "" ? undefined : Number(newCapacity);
    const ok = await run(() =>
      studioApi.addTier(showtimeId, { label: newLabel.trim(), price, capacity }),
    );
    if (ok) {
      setNewLabel("");
      setNewPrice("");
      setNewCapacity("");
    }
  };

  if (loadError) return <ErrorRetry message={loadError} onRetry={load} />;
  if (tiers === null) return <Loading label="Đang tải hạng vé…" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-sm font-bold">
          Hạng vé ({active.length}/{MAX_ACTIVE_TIERS} đang bán)
        </h4>
        {seated && (
          <span className="font-mono text-[10px] text-beige-kem/50">Sức chứa lấy từ sơ đồ ghế</span>
        )}
      </div>

      {tiers.length === 0 && (
        <Empty title="Chưa có hạng vé nào." hint="Thêm hạng vé đầu tiên bên dưới." />
      )}

      {tiers.map((t) => (
        <TierRow key={t.id} tier={t} seated={seated} busy={busy} run={run} />
      ))}

      <div className="border-2 border-dashed border-beige-kem/40 p-3">
        <p className="mb-2 font-mono text-[11px] text-beige-kem/60">Thêm hạng vé</p>
        <div
          className={`grid gap-2 ${seated ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_1fr_auto]"}`}
        >
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Tên hạng (VIP…)"
            className={input}
          />
          <input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            inputMode="numeric"
            placeholder="Giá (đ)"
            className={input}
          />
          {!seated && (
            <input
              value={newCapacity}
              onChange={(e) => setNewCapacity(e.target.value)}
              inputMode="numeric"
              placeholder="Sức chứa"
              className={input}
            />
          )}
          <button
            onClick={add}
            disabled={busy || active.length >= MAX_ACTIVE_TIERS}
            className={btn}
          >
            Thêm
          </button>
        </div>
        {active.length >= MAX_ACTIVE_TIERS && (
          <p className="mt-2 font-mono text-[11px] text-beige-kem/50">
            Đã đạt tối đa {MAX_ACTIVE_TIERS} hạng vé đang bán. Hãy lưu trữ một hạng để thêm hạng
            mới.
          </p>
        )}
      </div>

      <Refusal message={refusal} />
    </div>
  );
}

function TierRow({
  tier,
  seated,
  busy,
  run,
}: {
  tier: ManagedTier;
  seated: boolean;
  busy: boolean;
  run: (fn: () => Promise<{ returnedToReview: boolean }>) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(tier.label);
  const [price, setPrice] = useState(String(tier.price));
  const [capacity, setCapacity] = useState(tier.capacity === null ? "" : String(tier.capacity));

  const dirty =
    label !== tier.label ||
    price !== String(tier.price) ||
    capacity !== (tier.capacity === null ? "" : String(tier.capacity));

  const save = () =>
    run(() =>
      studioApi.updateTier(tier.id, {
        label: label !== tier.label ? label : undefined,
        price: price !== String(tier.price) ? Number(price) : undefined,
        capacity:
          !seated && capacity !== String(tier.capacity ?? "") ? Number(capacity) : undefined,
      }),
    );

  return (
    <div
      className={`border-2 p-3 ${tier.archived ? "border-beige-kem/25 opacity-70" : "border-beige-kem"}`}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={tier.archived}
          className={input}
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="numeric"
          disabled={tier.archived}
          className={input}
        />
        <input
          value={seated ? "" : capacity}
          onChange={(e) => setCapacity(e.target.value)}
          inputMode="numeric"
          disabled={seated || tier.archived}
          placeholder={seated ? "Từ sơ đồ ghế" : "Sức chứa"}
          className={input}
        />
        <div className="flex gap-2">
          {tier.archived ? (
            <button
              onClick={() => run(() => studioApi.restoreTier(tier.id))}
              disabled={busy}
              className={ghost}
            >
              Khôi phục
            </button>
          ) : (
            <>
              <button onClick={save} disabled={busy || !dirty} className={btn}>
                Lưu
              </button>
              <button
                onClick={() => run(() => studioApi.removeTier(tier.id))}
                disabled={busy}
                className={ghost}
              >
                Xoá
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-beige-kem/60">
        {tier.archived && <span className="mr-2 text-cam-dat">Đã lưu trữ · không còn bán</span>}
        Đã bán {tier.sold} · Đang giữ {tier.held} ·{" "}
        {tier.remaining === null ? "Không giới hạn" : `Còn ${tier.remaining}`} · Giá{" "}
        {dong(tier.price)}
      </p>
    </div>
  );
}
