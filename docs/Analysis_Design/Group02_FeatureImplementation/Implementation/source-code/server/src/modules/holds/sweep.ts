import { HOLD_SWEEP_INTERVAL_MS } from '../../config.js';
import { broadcastSeatUpdate } from '../../realtime/io.js';
import { findExpiredActive } from './holds.repo.js';
import { releaseEverything } from './holds.service.js';

/**
 * The release sweep (REL-02, FR-007). Expiry itself is exact — `reservations.expires_at` is an
 * absolute instant — and this loop is only the mechanism that acts on it, which is why the guarantee
 * is "released within about a minute of expiry" rather than "released instantly".
 *
 * Crucially it is **server-side and client-independent**: an attendee who closed their browser keeps
 * nothing. Each reservation is released in its own transaction, so one failure cannot strand the rest.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const expired = await findExpiredActive();
  let released = 0;

  for (const reservation of expired) {
    try {
      const updates = await releaseEverything(reservation, 'expired');
      for (const update of updates) broadcastSeatUpdate(update);
      released += 1;
    } catch (e) {
      // A single bad reservation must not stop the sweep — the rest of the map still needs freeing.
      console.error('hold sweep failed for reservation', reservation.id, e instanceof Error ? e.message : e);
    }
  }

  return released;
}

let timer: NodeJS.Timeout | null = null;

export function startHoldSweep(intervalMs = HOLD_SWEEP_INTERVAL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    // A database blip must not take the API down with it. `findExpiredActive` runs before the
    // per-reservation try/catch inside the sweep, so without this its rejection is unhandled and
    // Node exits the whole process — one lost DNS lookup logged out every signed-in user.
    void sweepExpiredHolds().catch((e) => {
      console.error("hold sweep failed:", e instanceof Error ? e.message : e);
    });
  }, intervalMs);
  // Never keep the process alive just to sweep.
  timer.unref?.();
}

export function stopHoldSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
