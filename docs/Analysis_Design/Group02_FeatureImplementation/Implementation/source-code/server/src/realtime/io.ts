import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import {
  SEAT_JOIN_EVENT,
  SEAT_LEAVE_EVENT,
  SEAT_UPDATE_EVENT,
  type SeatRoomJoin,
  type SeatUpdate,
  showtimeRoom,
} from "@shared/holds/types.js";
import { familyHasLiveToken, verifyAccessToken } from "../modules/auth/sessions.js";
import { config } from "../config.js";

/**
 * The live seat channel (R-5). One room per showtime; the server broadcasts a `seat:update` after
 * every committed transition so other viewers' maps follow within about a second (PERF-03).
 *
 * The socket **never mutates state**: holds and releases go through the `requireAuth` REST routes,
 * and this channel only carries the result. That is what keeps the database the single source of
 * truth and lets a client that missed an update still be refused correctly by the row lock (FR-023).
 *
 * A guest may connect and watch — viewing a map is open (FR-022, 002 FR-012) — they simply cannot
 * trigger anything through it.
 */

let io: IOServer | null = null;

export function attachIo(server: HttpServer): IOServer {
  io = new IOServer(server, {
    cors: { origin: config.corsOrigins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    // Auth is optional: a valid token only tags the socket so a returning owner can be told which
    // holds are their own. An invalid one is not an error — it connects read-only.
    const token = socket.handshake.auth?.token;
    if (typeof token === "string" && token.length > 0) {
      try {
        const { userId, familyId } = verifyAccessToken(token);
        if (await familyHasLiveToken(familyId)) {
          socket.data.userId = userId;
        }
      } catch {
        // fall through as a guest
      }
    }
    next();
  });

  io.on("connection", (socket) => {
    socket.on(SEAT_JOIN_EVENT, (payload: SeatRoomJoin) => {
      const id = Number(payload?.showtimeId);
      if (Number.isInteger(id) && id > 0) void socket.join(showtimeRoom(id));
    });

    socket.on(SEAT_LEAVE_EVENT, (payload: SeatRoomJoin) => {
      const id = Number(payload?.showtimeId);
      if (Number.isInteger(id) && id > 0) void socket.leave(showtimeRoom(id));
    });
  });

  return io;
}

/**
 * Broadcast a committed change to everyone watching that showtime. Safe to call when no Socket.IO
 * server is attached (tests drive Express directly through supertest) — the hold itself is already
 * committed, and a missed broadcast is only a stale pixel, never a wrong seat (FR-023).
 */
export function broadcastSeatUpdate(update: SeatUpdate): void {
  io?.to(showtimeRoom(update.showtimeId)).emit(SEAT_UPDATE_EVENT, update);
  for (const listener of listeners) listener(update);
}

// In-process observers of the same stream. Lets a test assert what a viewer would have received
// without standing up a socket server (supertest drives Express directly).
type SeatUpdateListener = (update: SeatUpdate) => void;
const listeners = new Set<SeatUpdateListener>();

export function subscribeSeatUpdates(listener: SeatUpdateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
