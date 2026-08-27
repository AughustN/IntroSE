import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowtimeMap } from "@/shared/catalog/seatmap";
import type { SeatUpdate } from "@/shared/holds/types";
import { layoutApi } from "../../services/catalogClient";
import { watchShowtime } from "../../services/seatSocket";

type Frame = NonNullable<SeatUpdate["seats"]>[number];

export function applySeatFrames(map: ShowtimeMap, frames: Map<number, Frame>): ShowtimeMap {
  return {
    ...map,
    seats: map.seats.map((seat) => {
      const frame = frames.get(seat.id);
      if (!frame) return seat;
      const tier =
        frame.tier === undefined
          ? undefined
          : map.tierLegend.find(
              (entry) => entry.label === frame.tier && entry.price === frame.price,
            );
      return {
        ...seat,
        status: frame.status,
        tier: frame.tier ?? seat.tier,
        price: frame.price ?? seat.price,
        ticketTierId: tier?.tierId ?? seat.ticketTierId,
        // A released/refunded seat no longer belongs to the previous buyer.
        buyerName: frame.status === "sold" ? seat.buyerName : null,
        checkedInAt: frame.status === "sold" ? seat.checkedInAt : null,
      };
    }),
  };
}

interface LiveState {
  showtimeId: number;
  map: ShowtimeMap | null;
  updatedAt: Date | null;
  connected: boolean;
  refreshing: boolean;
  error: string | null;
}

const initial = (showtimeId: number): LiveState => ({
  showtimeId,
  map: null,
  updatedAt: null,
  connected: false,
  refreshing: true,
  error: null,
});

/** Owner-only snapshots reconcile the advisory stream, including updates missed while offline. */
export function useLiveShowtimeMap(showtimeId: number) {
  const [state, setState] = useState<LiveState>(() => initial(showtimeId));
  const reloadRef = useRef<() => void>(() => {});
  const reload = useCallback(() => reloadRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;
    let queued = false;
    let frames = new Map<number, Frame>();
    const change = (update: (current: LiveState) => LiveState) => {
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
      frames = new Map();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      change((current) => ({ ...current, refreshing: true }));
      try {
        const snapshot = await layoutApi.showtimeMap(showtimeId, controller.signal);
        if (disposed) return;
        // A response begun before a sale must not paint that seat available again.
        const reconciled = applySeatFrames(snapshot, frames);
        change((current) => ({ ...current, map: reconciled, updatedAt: new Date(), error: null }));
      } catch (error) {
        change((current) => ({
          ...current,
          error: controller.signal.aborted
            ? "Kết nối quá lâu. Chưa thể xác nhận trạng thái mới nhất."
            : error instanceof Error
              ? error.message
              : "Không thể cập nhật sơ đồ.",
        }));
      } finally {
        window.clearTimeout(timeout);
        request = null;
        change((current) => ({ ...current, refreshing: false }));
        if (queued && !disposed) {
          queued = false;
          void refresh();
        }
      }
    };
    reloadRef.current = () => {
      void refresh();
    };
    const stop = watchShowtime(
      showtimeId,
      (update) => {
        if (disposed || update.showtimeId !== showtimeId) return;
        const incoming = new Map(
          (update.seats ?? []).map((frame) => [frame.showtimeSeatId, frame]),
        );
        for (const [id, frame] of incoming) {
          frames.set(id, { ...frames.get(id), ...frame });
        }
        if (incoming.size > 0)
          change((current) => ({
            ...current,
            map: current.map ? applySeatFrames(current.map, incoming) : null,
            updatedAt: current.map ? new Date() : current.updatedAt,
          }));
      },
      (connected) => {
        change((current) => ({ ...current, connected }));
        if (connected) void refresh();
      },
    );
    if (!request) void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const interval = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      disposed = true;
      stop();
      request?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      reloadRef.current = () => {};
    };
  }, [showtimeId]);

  return { ...(state.showtimeId === showtimeId ? state : initial(showtimeId)), reload };
}
