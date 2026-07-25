// The live seat channel (feature 003, US3). Advisory by design: the map it paints is a fast preview
// of the database, and a missed update only costs a stale pixel — the hold itself is still refused
// correctly by the server's row lock (FR-023). Never treat this stream as the source of truth.
import { io, type Socket } from 'socket.io-client';
import {
  SEAT_JOIN_EVENT,
  SEAT_LEAVE_EVENT,
  SEAT_UPDATE_EVENT,
  type SeatUpdate,
} from '@/shared/holds/types';
import { getAccessToken } from './authClient';

let socket: Socket | null = null;

function connect(): Socket {
  if (socket) return socket;
  // Same origin as the API (Nginx reverse-proxies both). The token is optional — a guest may watch
  // a map, they simply cannot hold through it.
  socket = io({ auth: { token: getAccessToken() ?? '' } });
  return socket;
}

/**
 * Watch one showtime's map. Returns an unsubscribe that leaves the room — call it when the screen
 * unmounts so a buyer browsing several showtimes does not accumulate rooms.
 */
export function watchShowtime(showtimeId: number, onUpdate: (update: SeatUpdate) => void): () => void {
  const s = connect();
  const handler = (update: SeatUpdate) => {
    if (update.showtimeId === showtimeId) onUpdate(update);
  };

  s.on(SEAT_UPDATE_EVENT, handler);
  const join = () => s.emit(SEAT_JOIN_EVENT, { showtimeId });
  join();
  // Rejoin after a reconnect; the caller re-reads the full map separately (FR-022).
  s.on('connect', join);

  return () => {
    s.off(SEAT_UPDATE_EVENT, handler);
    s.off('connect', join);
    s.emit(SEAT_LEAVE_EVENT, { showtimeId });
  };
}

/** Drop the shared connection (sign-out): the next watch reconnects with the new identity. */
export function disconnectSeatSocket(): void {
  socket?.disconnect();
  socket = null;
}
