import { useCallback, useEffect, useRef, useState } from "react";
import type { SeatMap } from "@/shared/catalog/types";
import type { SeatUpdate } from "@/shared/holds/types";
import { catalogClient } from "../../services/catalogClient";
import { watchShowtime } from "../../services/seatSocket";

type SeatFrame = NonNullable<SeatUpdate["seats"]>[number];
type TierFrame = NonNullable<SeatUpdate["tier"]>;

function reconcile(
  map: SeatMap,
  seats: Map<number, SeatFrame>,
  tiers: Map<number, TierFrame>,
): SeatMap {
  return {
    ...map,
    seats: map.seats?.map((seat) => {
      const frame = seats.get(seat.id);
      if (!frame) return seat;
      const tier =
        frame.tier === undefined
          ? undefined
          : map.tierLegend?.find(
              (entry) => entry.label === frame.tier && entry.price === frame.price,
            );
      return {
        ...seat,
        status: frame.status,
        tier: frame.tier ?? seat.tier,
        price: frame.price ?? seat.price,
        tierId: tier?.tierId ?? seat.tierId,
      };
    }),
    zoneTiers: map.zoneTiers?.map((tier) => {
      const frame = tiers.get(tier.id);
      return frame ? { ...tier, remaining: frame.remaining } : tier;
    }),
  };
}

interface State {
  showtimeId: number | null;
  map: SeatMap | null;
  error: string | null;
}
const initial = (showtimeId: number | null): State => ({ showtimeId, map: null, error: null });

/** Public map snapshots + advisory frames. A frame received during a read wins over that read. */
export function useBuyerSeatMap(showtimeId: number | null) {
  const [state, setState] = useState<State>(() => initial(showtimeId));
  const reloadRef = useRef<() => void>(() => {});
  const reload = useCallback(() => reloadRef.current(), []);

  useEffect(() => {
    if (showtimeId === null) return;
    let disposed = false;
    let request: AbortController | null = null;
    let queued = false;
    let seatFrames = new Map<number, SeatFrame>();
    let tierFrames = new Map<number, TierFrame>();
    const change = (update: (current: State) => State) => {
      if (!disposed)
        setState((current) =>
          update(current.showtimeId === showtimeId ? current : initial(showtimeId)),
        );
    };
    const refresh = async () => {
      if (disposed) return;
      if (request) {
        queued = true;
        return;
      }
      const controller = new AbortController();
      request = controller;
      seatFrames = new Map();
      tierFrames = new Map();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const snapshot = await catalogClient.getSeatMap(showtimeId, controller.signal);
        if (disposed) return;
        const map = reconcile(snapshot, seatFrames, tierFrames);
        change((current) => ({ ...current, map, error: null }));
      } catch {
        change((current) => ({
          ...current,
          error: "Không tải được trạng thái vé mới nhất. Vui lòng thử lại.",
        }));
      } finally {
        window.clearTimeout(timeout);
        request = null;
        if (queued && !disposed) {
          queued = false;
          void refresh();
        }
      }
    };
    reloadRef.current = () => {
      void refresh();
    };
    // Subscribe first: the initial connection callback may start the first read itself.
    const stop = watchShowtime(
      showtimeId,
      (update) => {
        if (disposed || update.showtimeId !== showtimeId) return;
        const incomingSeats = new Map(
          (update.seats ?? []).map((frame) => [frame.showtimeSeatId, frame]),
        );
        const incomingTiers = new Map<number, TierFrame>();
        if (update.tier) incomingTiers.set(update.tier.ticketTierId, update.tier);
        if (request) {
          for (const [id, frame] of incomingSeats)
            seatFrames.set(id, { ...seatFrames.get(id), ...frame });
          for (const [id, frame] of incomingTiers) tierFrames.set(id, frame);
        }
        change((current) => ({
          ...current,
          map: current.map ? reconcile(current.map, incomingSeats, incomingTiers) : null,
        }));
      },
      (connected) => {
        if (connected) void refresh();
      },
    );
    if (!request) void refresh();
    const onOnline = () => {
      void refresh();
    };
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      stop();
      request?.abort();
      window.removeEventListener("online", onOnline);
      reloadRef.current = () => {};
    };
  }, [showtimeId]);

  const current = state.showtimeId === showtimeId ? state : initial(showtimeId);
  return {
    map: current.map,
    error: current.error,
    loading: showtimeId !== null && !current.map && !current.error,
    reload,
  };
}
