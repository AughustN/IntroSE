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
import {
  WAITING_ROOM_ADMIT_EVENT,
  WAITING_ROOM_JOIN_EVENT,
  WAITING_ROOM_LEAVE_EVENT,
  WAITING_ROOM_POSITION_EVENT,
  type WaitingRoomAdmitPush,
  type WaitingRoomPositionPush,
  type WaitingRoomRoomJoin,
  waitingRoomUserRoom,
} from "@shared/types/botDefense.js";
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

    /*
     * The waiting room, unlike the seat map, is not watchable by a guest.
     *
     * Its room name carries a user id and its payload carries that user's queue pass, so a socket
     * that never presented a token has no room to join — `socket.data.userId` is set in the
     * handshake above only when the token verified. Falling through silently is deliberate: an
     * unauthenticated socket is a normal thing here (the seat map admits one), and the client still
     * has its polling fallback if the push never arrives.
     */
    socket.on(WAITING_ROOM_JOIN_EVENT, (payload: WaitingRoomRoomJoin) => {
      const userId = socket.data.userId as number | undefined;
      const id = Number(payload?.showtimeId);
      if (userId && Number.isInteger(id) && id > 0) void socket.join(waitingRoomUserRoom(id, userId));
    });

    socket.on(WAITING_ROOM_LEAVE_EVENT, (payload: WaitingRoomRoomJoin) => {
      const userId = socket.data.userId as number | undefined;
      const id = Number(payload?.showtimeId);
      if (userId && Number.isInteger(id) && id > 0) void socket.leave(waitingRoomUserRoom(id, userId));
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

/**
 * Tell one buyer their turn has come, with the pass in the message.
 *
 * Best-effort in exactly the way `broadcastSeatUpdate` is: no socket server is attached under
 * supertest, and a client whose push is lost still finds out on its next poll. What the push buys
 * is the removal of the poll's timing noise for everyone it does reach, not a new source of truth.
 */
export function pushWaitingRoomAdmit(userId: number, payload: WaitingRoomAdmitPush): void {
  io?.to(waitingRoomUserRoom(payload.showtimeId, userId)).emit(WAITING_ROOM_ADMIT_EVENT, payload);
}

/** The line moved: someone ahead was let in. */
export function pushWaitingRoomPosition(userId: number, payload: WaitingRoomPositionPush): void {
  io?.to(waitingRoomUserRoom(payload.showtimeId, userId)).emit(WAITING_ROOM_POSITION_EVENT, payload);
}

// In-process observers of the same stream. Lets a test assert what a viewer would have received
// without standing up a socket server (supertest drives Express directly).
type SeatUpdateListener = (update: SeatUpdate) => void;
const listeners = new Set<SeatUpdateListener>();

export function subscribeSeatUpdates(listener: SeatUpdateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
