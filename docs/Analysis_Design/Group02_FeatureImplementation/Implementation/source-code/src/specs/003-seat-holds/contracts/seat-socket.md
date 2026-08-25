# Contract: Seat real-time channel (Socket.IO)

The live seat-map channel for feature 003. Transport is Socket.IO on the same origin/host as the REST
API (same `http.Server`). Types live in `shared/holds/types.ts` and are imported by both server and
web (constitution Principle VI).

## Connection & auth

- **Path**: default Socket.IO endpoint (`/socket.io`), same-origin (Nginx reverse-proxies it).
- **Handshake auth** (`socket.handshake.auth.token`): the Bearer **access token**, optional.
  - Verified with `verifyAccessToken` + `familyHasLiveToken` (reuse `server/src/modules/auth/sessions.ts`).
  - **Valid token** → the socket is associated with `userId` (used only to tag which updates are the
    caller's own holds).
  - **No / invalid token** → the socket still connects **read-only** (guests may watch the map,
    FR-022). It receives broadcasts but can trigger no state change — holds happen over the
    `requireAuth` REST route, never the socket.
- The socket **never mutates state**. It is a broadcast + presence channel only; the database (via the
  REST hold path) is the source of truth (FR-023).

## Rooms

- One room per showtime: `showtime:<showtimeId>`.
- Client emits `seat:join { showtimeId }` after connecting → server joins the room and (optionally)
  returns nothing; the client fetches the authoritative full map from the existing 002 REST endpoint
  `GET /api/showtimes/:id/seat-map` on join and on every reconnect (resync, FR-022).

## Events

### Client → server

| Event | Payload | Effect |
|---|---|---|
| `seat:join` | `{ showtimeId: number }` | join the showtime room |
| `seat:leave` | `{ showtimeId: number }` | leave the room |

Holds/releases are **not** socket events — they are REST calls (`POST/PATCH/DELETE /api/reservations`).
The server broadcasts the resulting change.

### Server → room (`seat:update`)

Emitted after a committed hold, release, or sweep expiry. Advisory — clients reconcile against it but
a missed update is still corrected by the REST lock on the next action.

```ts
interface SeatUpdate {
  showtimeId: number;
  // seated: the seats whose status changed
  seats?: { showtimeSeatId: number; status: 'available' | 'held' | 'sold' | 'blocked' }[];
  // general admission: the tier whose remaining changed
  tier?: { ticketTierId: number; remaining: number };
  at: string; // ISO instant of the change
}
```

Notes:
- A `held` broadcast does **not** reveal who holds it — other viewers see only `held` (unavailable),
  never the owner. The owner learns their own holds from the REST reservation response, not the
  broadcast.
- Sweep expiry emits a `seats: [... status:'available']` (or `tier.remaining` bump) so viewers see
  freed inventory within about one second of release (SC-003).

## Latency target

`seat:update` round trip (client action → broadcast echo back to a client) < 1 s p95 (PERF-03),
sustained at ≥ 60 concurrent sockets on one room (PERF-06). Verified by the k6 WebSocket harness
(deferred, shared with catalog T034).
