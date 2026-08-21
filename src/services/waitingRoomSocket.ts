// The live waiting-room channel (feature 013), the seat channel's sibling in `seatSocket.ts`.
//
// The room used to run on a two-second poll, and the poll was coarser than the thing it measured: a
// batch is admitted in one instant, and each client then discovered that at a random point inside
// its own window. The spread was wider than the gaps the queue positions described, so the order
// people actually got in had nothing to do with the order they were shown. The push removes that.
//
// Advisory, like the seat channel: the REST status endpoint remains the source of truth and the
// caller keeps a slow poll behind this, so a dropped socket costs latency and never a lost place.
import { io, type Socket } from "socket.io-client";
import {
  WAITING_ROOM_ADMIT_EVENT,
  WAITING_ROOM_JOIN_EVENT,
  WAITING_ROOM_LEAVE_EVENT,
  WAITING_ROOM_POSITION_EVENT,
  type WaitingRoomAdmitPush,
  type WaitingRoomPositionPush,
} from "@/shared/types/botDefense";
import { getAccessToken } from "./authClient";
import { API_ORIGIN } from "./api";

let socket: Socket | null = null;

function connect(): Socket {
  if (socket) return socket;
  // Unlike the seat map, this channel is useless without an identity: the server keys its room by
  // user id and will not join a socket that presented no token.
  socket = io(API_ORIGIN, { auth: { token: getAccessToken() ?? "" }, withCredentials: true });
  return socket;
}

/**
 * Watch one showtime's queue for this buyer. Returns an unsubscribe that leaves the room.
 */
export function watchWaitingRoom(
  showtimeId: number,
  handlers: {
    onAdmitted: (push: WaitingRoomAdmitPush) => void;
    onPosition: (push: WaitingRoomPositionPush) => void;
  },
): () => void {
  const s = connect();

  const admit = (push: WaitingRoomAdmitPush) => {
    if (push.showtimeId === showtimeId) handlers.onAdmitted(push);
  };
  const position = (push: WaitingRoomPositionPush) => {
    if (push.showtimeId === showtimeId) handlers.onPosition(push);
  };

  s.on(WAITING_ROOM_ADMIT_EVENT, admit);
  s.on(WAITING_ROOM_POSITION_EVENT, position);

  const join = () => s.emit(WAITING_ROOM_JOIN_EVENT, { showtimeId });
  join();
  // Rejoin after a reconnect. Anything pushed while the socket was down is not replayed — the
  // caller's poll is what closes that gap, which is the reason it is still there.
  s.on("connect", join);

  return () => {
    s.off(WAITING_ROOM_ADMIT_EVENT, admit);
    s.off(WAITING_ROOM_POSITION_EVENT, position);
    s.off("connect", join);
    s.emit(WAITING_ROOM_LEAVE_EVENT, { showtimeId });
  };
}
