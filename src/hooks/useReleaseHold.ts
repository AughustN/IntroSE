import { useCallback, useRef } from "react";
import type { HoldSession } from "../types";
import { HoldError, holdsClient } from "../services/holdsClient";

/** The next booking action may proceed only after the server has released the previous hold. */
export function useReleaseHold({
  onReleased,
  onError,
  onBusyChange,
}: {
  onReleased: (session: HoldSession) => void;
  onError: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const pending = useRef(false);
  return useCallback(
    async (session: HoldSession): Promise<boolean> => {
      if (pending.current) return false;
      pending.current = true;
      onBusyChange(true);
      try {
        try {
          await holdsClient.cancel(session.reservationId);
        } catch (error) {
          // A previous cancellation may have succeeded while its response was lost. The API also
          // returns this exact refusal for expired/closed holds; those no longer block a new choice.
          if (!(error instanceof HoldError && error.status === 404 && error.code === "not_found")) {
            onError();
            return false;
          }
        }
        onReleased(session);
        return true;
      } finally {
        pending.current = false;
        onBusyChange(false);
      }
    },
    [onReleased, onError, onBusyChange],
  );
}
