import crypto from 'node:crypto';
import { HOLD_TTL_MS } from '../config.js';
import { pushWaitingRoomAdmit, pushWaitingRoomPosition } from '../realtime/io.js';
import type { WaitingRoomJoinResponse, WaitingRoomStatusResponse } from '../../../shared/types/botDefense.js';

export interface WaitingRoomSettings {
  enabled: boolean;
  batchSize: number;
  admissionIntervalMs: number;
  tokenTtlMs: number; // Default: 3 * 60 * 1000 (3 minutes)
}

interface QueuedUser {
  userId: number;
  enqueuedAt: number;
  priorityScore: number;
}

interface AdmittedToken {
  token: string;
  userId: number;
  showtimeId: number;
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
}

class WaitingRoomState {
  showtimeId: number;
  settings: WaitingRoomSettings;
  queue: QueuedUser[] = [];
  admittedTokens = new Map<string, AdmittedToken>(); // Key: token or userId
  userTokenLookup = new Map<number, string>(); // Key: userId -> token
  private timer: NodeJS.Timeout | null = null;
  /** Monotonic arrival counter — see `enqueue`. Never reset while the room lives. */
  private nextTicket = 1;

  constructor(showtimeId: number, settings?: Partial<WaitingRoomSettings>) {
    this.showtimeId = showtimeId;
    this.settings = {
      enabled: true,
      /*
       * Five, not twenty.
       *
       * Nothing in the product ever calls `setWaitingRoomConfig`, so this default is what every real
       * drop runs on — and at twenty, the first twenty positions were admitted in the same instant.
       * Inside a batch there is no order at all: whoever clicks fastest wins, which is the thing a
       * numbered queue exists to stop, and the number on screen described a fairness the room was
       * not providing. A smaller batch is the whole of what makes the position mean something.
       *
       * Five every three seconds is 100 buyers a minute, which is the shape of demand this feature
       * is for. It does not make the room a seat allocator: admission is still permission to try,
       * and nothing here reserves inventory.
       */
      batchSize: 5,
      /*
       * One second, not three.
       *
       * Batch size and interval are separate knobs and were being confused for one. The batch sets
       * how coarse the ordering is — inside one there is no order at all — and `batch / interval`
       * sets throughput. Twenty every three seconds was 400 a minute with the ordering blurred
       * twenty deep; dropping the batch alone fixed the ordering and quietly cut throughput to a
       * hundred. Five every second keeps the fine ordering and gives back most of the rate.
       *
       * The tick is a splice on an in-memory array plus a handful of socket emits, so running it
       * three times as often costs nothing worth measuring. The server was never the constraint
       * here — 100 holds a minute is nothing to Postgres — and 3000 carried no reasoning with it.
       */
      admissionIntervalMs: 1000,
      /*
       * A pass lasts as long as a seat hold, because it is gating the same session.
       *
       * It was three minutes against a `seat_hold_ttl_minutes` of seven, and the two numbers meet
       * on the PATCH route: adding a seat re-checks the pass. So a buyer who spent four minutes
       * over a large chart — ordinary, not slow — was thrown back into the waiting room while the
       * seats they had already taken were still legitimately theirs, holding inventory they could
       * no longer add to.
       *
       * `HOLD_TTL_MS` is the default; the join route overrides it with the live admin setting,
       * which is adjustable from 1 to 30 minutes and would otherwise drift away from this again.
       */
      tokenTtlMs: HOLD_TTL_MS,
      ...settings,
    };
    this.startAdmissionLoop();
  }

  /**
   * How long a place in line is worth in seconds, given the batch size and the interval.
   *
   * The same expression was written out at three call sites; the push added a fourth, which is one
   * too many for a formula that has to agree with itself everywhere it appears.
   */
  private waitSecondsFor(position: number): number {
    return Math.ceil(
      (position / this.settings.batchSize) * (this.settings.admissionIntervalMs / 1000),
    );
  }

  startAdmissionLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.processAdmissions(), this.settings.admissionIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(userId: number): WaitingRoomJoinResponse {
    // Already through the door — rejoining is a refresh, not a new place in line.
    const live = this.tokenFor(userId);
    if (live) {
      return {
        status: 'admitted',
        queueToken: live.token,
        expiresAt: live.expiresAt,
        showtimeId: this.showtimeId,
      };
    }

    // Check if already in queue
    const existingIdx = this.queue.findIndex((q) => q.userId === userId);
    if (existingIdx !== -1) {
      return {
        status: 'waiting',
        queuePosition: existingIdx + 1,
        estimatedWaitSeconds: this.waitSecondsFor(existingIdx + 1),
        showtimeId: this.showtimeId,
      };
    }

    /*
     * Arrival order, decided by a counter rather than by the clock.
     *
     * This used to add `Math.random() * 500` to `Date.now()` and sort on the result, described as
     * "fair distribution at drop time". It is the opposite of fair: two people who arrive in the
     * same millisecond are ordered by a coin toss, and someone who arrives 400ms later can be
     * placed ahead of someone already waiting. A queue whose whole promise is "you are number N"
     * cannot hand out a number that a later arrival can take.
     *
     * `Date.now()` alone is not enough either — a drop puts dozens of joins inside one millisecond,
     * and ties would fall back to whatever order `sort` happens to produce. The counter is
     * monotonic, so arrival order survives the tie.
     */
    const item: QueuedUser = { userId, enqueuedAt: Date.now(), priorityScore: this.nextTicket++ };
    this.queue.push(item);

    /*
     * No short cut for an arrival that finds the room empty, deliberately.
     *
     * Admitting them on the spot was tried: the loop returns early on an empty queue, so the first
     * person at a quiet showtime waits out whatever is left of the current cycle with nobody ahead
     * of them. It bought at most one interval and cost a second admission path — two places that
     * mint passes, two places to keep the batch bound honest — and it broke the contract this
     * room's own tests are written against, which is that joining puts you in line and the loop is
     * what lets people out of it. At a one-second cycle the wait it saved is not worth the second
     * way in.
     */
    const position = this.queue.length;
    return {
      status: 'waiting',
      queuePosition: position,
      estimatedWaitSeconds: this.waitSecondsFor(position),
      showtimeId: this.showtimeId,
    };
  }

  /** This user's live pass, if they hold one that is neither expired nor already spent. */
  private tokenFor(userId: number): AdmittedToken | null {
    const tokenStr = this.userTokenLookup.get(userId);
    if (!tokenStr) return null;
    const token = this.admittedTokens.get(tokenStr);
    if (!token || token.expiresAt <= Date.now() || token.consumed) return null;
    return token;
  }

  processAdmissions() {
    if (this.queue.length === 0) return;

    const toAdmit = this.queue.splice(0, this.settings.batchSize);
    const now = Date.now();
    const expiresAt = now + this.settings.tokenTtlMs;

    for (const user of toAdmit) {
      const tokenString = `qt_${crypto.randomUUID()}_${this.showtimeId}_${user.userId}`;
      const tokenObj: AdmittedToken = {
        token: tokenString,
        userId: user.userId,
        showtimeId: this.showtimeId,
        issuedAt: now,
        expiresAt,
        consumed: false,
      };
      this.admittedTokens.set(tokenString, tokenObj);
      this.userTokenLookup.set(user.userId, tokenString);
      indexQueueToken(tokenString, this.showtimeId);
      // Pushed, not waited for: the client used to learn this on its own two-second poll, which
      // spread one instant of admission across a window wider than the queue's own ordering.
      pushWaitingRoomAdmit(user.userId, {
        showtimeId: this.showtimeId,
        queueToken: tokenString,
        expiresAt,
      });
    }

    // And everyone still waiting has moved up. Sent from here rather than left to the poll for the
    // same reason: a position that updates on someone else's timer is not a position.
    for (const [index, waiting] of this.queue.entries()) {
      pushWaitingRoomPosition(waiting.userId, {
        showtimeId: this.showtimeId,
        queuePosition: index + 1,
        estimatedWaitSeconds: this.waitSecondsFor(index + 1),
      });
    }
  }

  getStatus(userId: number): WaitingRoomStatusResponse {
    const live = this.tokenFor(userId);
    if (live) {
      return {
        status: 'admitted',
        queueToken: live.token,
        expiresAt: live.expiresAt,
        validitySecondsRemaining: Math.ceil((live.expiresAt - Date.now()) / 1000),
      };
    }

    const pos = this.queue.findIndex((q) => q.userId === userId);
    if (pos !== -1) {
      const position = pos + 1;
      return {
        status: 'waiting',
        queuePosition: position,
        estimatedWaitSeconds: this.waitSecondsFor(position),
      };
    }

    return { status: 'expired' };
  }

  verifyToken(userId: number, tokenStr: string): { valid: boolean; error?: string } {
    const token = this.admittedTokens.get(tokenStr);
    if (!token) {
      return { valid: false, error: 'invalid_queue_token' };
    }
    if (token.userId !== userId) {
      return { valid: false, error: 'user_mismatch' };
    }
    if (token.showtimeId !== this.showtimeId) {
      return { valid: false, error: 'showtime_mismatch' };
    }
    if (token.expiresAt <= Date.now()) {
      return { valid: false, error: 'queue_token_expired' };
    }
    if (token.consumed) {
      return { valid: false, error: 'token_already_consumed' };
    }
    return { valid: true };
  }

  consumeToken(tokenStr: string): void {
    const token = this.admittedTokens.get(tokenStr);
    if (token) {
      token.consumed = true;
    }
  }
}

/*
 * Every live queue, in this process's memory and nowhere else.
 *
 * That is a real bound on the feature, not an oversight to read past: a restart drops every queue
 * and invalidates every pass in flight, and a second instance behind the same origin would run its
 * own independent queue with its own positions. Neither is fixed here — a shared store means a
 * fifth external integration, which the constitution caps at four (v2.1.0), and the deployment is
 * a single VPS process today, so the second case cannot arise yet.
 *
 * What IS handled is the restart: an orphaned pass no longer resolves in `tokenIndex`, comes back
 * `invalid_queue_token`, and the client treats that like any other gate rejection — it clears the
 * pass and queues again. The buyer loses their place, which is honest, rather than being left
 * pressing a seat that will never hold.
 */
const waitingRooms = new Map<number, WaitingRoomState>();

/*
 * Every live queue token, mapped to the showtime that issued it.
 *
 * `verifyQueueToken` used to answer from `waitingRooms.get(showtimeId)` alone, which made two very
 * different situations indistinguishable and one of them unreachable: a token minted for ANOTHER
 * showtime and a token that never existed both came back as `waiting_room_not_found`, and
 * `verifyToken`'s `showtime_mismatch` branch could never run — it compares the token's showtime
 * against the room it was just looked up in, which is the same number by construction.
 *
 * The index is what tells the two apart, and it is also the seam that keeps `stop()`/`reset` from
 * leaking: a room that goes away takes its tokens out with it.
 */
const tokenIndex = new Map<string, number>();

/** Records a freshly admitted token so `verifyQueueToken` can place it. Called by the room. */
export function indexQueueToken(token: string, showtimeId: number): void {
  tokenIndex.set(token, showtimeId);
}

export function getOrCreateWaitingRoom(
  showtimeId: number,
  settings?: Partial<WaitingRoomSettings>,
): WaitingRoomState {
  let room = waitingRooms.get(showtimeId);
  if (!room) {
    room = new WaitingRoomState(showtimeId, settings);
    waitingRooms.set(showtimeId, room);
  }
  return room;
}

export function setWaitingRoomConfig(
  showtimeId: number,
  settings: Partial<WaitingRoomSettings>,
): void {
  const room = getOrCreateWaitingRoom(showtimeId, settings);
  room.settings = { ...room.settings, ...settings };
  room.startAdmissionLoop();
}

export function joinWaitingRoom(
  showtimeId: number,
  userId: number,
  /**
   * How long the pass this join may earn should live, in ms — the caller reads it from the live
   * `seat_hold_ttl_minutes` setting. Applied to the existing room too, not only a new one: an admin
   * who changes the hold window mid-sale should not leave a long-lived room minting the old length.
   */
  tokenTtlMs?: number,
): WaitingRoomJoinResponse {
  const room = getOrCreateWaitingRoom(showtimeId, tokenTtlMs ? { tokenTtlMs } : undefined);
  if (tokenTtlMs) room.settings.tokenTtlMs = tokenTtlMs;
  return room.enqueue(userId);
}

export function getWaitingRoomStatus(showtimeId: number, userId: number): WaitingRoomStatusResponse {
  const room = getOrCreateWaitingRoom(showtimeId);
  return room.getStatus(userId);
}

export function verifyQueueToken(
  showtimeId: number,
  userId: number,
  tokenStr: string,
): { valid: boolean; error?: string } {
  const issuedFor = tokenIndex.get(tokenStr);
  if (issuedFor === undefined) {
    // No room holds this string. It was never issued, or the process that issued it has restarted
    // and taken its in-memory queue with it (see the note on `waitingRooms`).
    return { valid: false, error: 'invalid_queue_token' };
  }
  if (issuedFor !== showtimeId) {
    return { valid: false, error: 'showtime_mismatch' };
  }
  const room = waitingRooms.get(showtimeId);
  if (!room) {
    return { valid: false, error: 'waiting_room_not_found' };
  }
  return room.verifyToken(userId, tokenStr);
}

export function consumeQueueToken(showtimeId: number, tokenStr: string): void {
  const room = waitingRooms.get(showtimeId);
  if (room) {
    room.consumeToken(tokenStr);
  }
}

export function resetWaitingRooms(): void {
  waitingRooms.forEach((room) => room.stop());
  waitingRooms.clear();
  tokenIndex.clear();
}
