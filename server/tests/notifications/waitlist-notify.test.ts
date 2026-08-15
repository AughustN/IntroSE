import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { notifyWaitlistForShowtime } from '../../src/modules/notifications/notifications.service.js';
import * as wl from '../helpers/waitlistSeed.js';

describe('telling the queue that tickets came back (US2, FR-007)', () => {
  it('tells everybody on the queue, not a leading few', async () => {
    // A full queue: ten places, one returned ticket. All ten are told and race for it. Telling
    // only the earliest handful would be join-order priority, which this feature does not grant —
    // it is also why the entry reports no position.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 10);
    await wl.releaseGaQuantity(tierId, 1);

    await notifyWaitlistForShowtime(showtimeId);

    const rows = await wl.getEntries(showtimeId);
    const notified = rows.filter((row) => row.status === 'notified');
    expect(notified).toHaveLength(10);
    expect(notified.map((row) => row.id).sort((a, b) => a - b)).toEqual(
      queued.map((entry) => entry.entryId).sort((a, b) => a - b),
    );
    expect(notified.every((row) => row.notified_at !== null)).toBe(true);
  });

  it('carries a link to the event page in every message it writes', async () => {
    // The in-app row can be followed because it carries `event_id`; a mail has only what is
    // written in it, so the destination has to travel in the payload.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const [waiter] = await wl.fillWaitlist(showtimeId, tierId, 1);
    await wl.releaseGaQuantity(tierId, 1);

    await notifyWaitlistForShowtime(showtimeId);

    const { rows } = await pool.query<{ channel: string; payload: Record<string, string> }>(
      `SELECT channel, payload FROM notifications WHERE user_id = $1 AND type = 'waitlist_open'`,
      [waiter.userId],
    );
    // One per channel: the app row and the mail say the same thing and lead to the same place.
    expect(rows.map((row) => row.channel).sort()).toEqual(['email', 'in_app']);
    for (const row of rows) {
      expect(row.payload.eventUrl).toMatch(/\/events\/[^/]+$/);
      expect(row.payload.startsAt).toBeTruthy();
      expect(row.payload.venue).toBeTruthy();
    }
  });

  it('writes one readable message per notified place, carrying its event', async () => {
    const { eventId, showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.releaseGaQuantity(tierId, 1);

    await notifyWaitlistForShowtime(showtimeId);

    for (const entry of queued) {
      const messages = await wl.getNotifications(entry.userId);
      const open = messages.filter((message) => message.type === 'waitlist_open');
      expect(open).toHaveLength(1);
      // Without the event reference the in-app row has no honest way back to the event.
      expect(open[0].event_id).toBe(eventId);
      expect(open[0].read_at).toBeNull();
    }
  });

  it('tells a waiter again at the next release and leaves their turn untouched (UC-17 A5)', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.releaseGaQuantity(tierId, 1);
    await notifyWaitlistForShowtime(showtimeId);
    const afterFirst = await wl.getEntries(showtimeId);

    // The two releases are seconds apart here; the re-notify cooldown exists to silence exactly
    // that, so the clock is moved on rather than the rule bent.
    await wl.ageNotifications(showtimeId);
    await wl.releaseGaQuantity(tierId, 1);
    await notifyWaitlistForShowtime(showtimeId);

    const afterSecond = await wl.getEntries(showtimeId);
    // Same order, same join times: losing the race costs a waiter nothing.
    expect(afterSecond.map((row) => row.id)).toEqual(afterFirst.map((row) => row.id));
    expect(afterSecond.map((row) => row.joined_at.toISOString())).toEqual(
      afterFirst.map((row) => row.joined_at.toISOString()),
    );
    const messages = await wl.getNotifications(queued[0].userId);
    expect(messages.filter((message) => message.type === 'waitlist_open')).toHaveLength(2);
  });

  it('tells nobody while the scope is still empty', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime();
    const queued = await wl.fillWaitlist(showtimeId, tierId, 3);

    await notifyWaitlistForShowtime(showtimeId);

    expect((await wl.getEntries(showtimeId)).every((row) => row.status === 'waiting')).toBe(true);
    expect(await wl.getNotifications(queued[0].userId)).toHaveLength(0);
  });

  it('tells only the queue for the tier that freed', async () => {
    const { showtimeId, soldOutTierId } = await wl.seedMixedGaShowtime();
    const other = (
      await pool.query<{ id: number }>(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, sold_quantity)
         VALUES ($1, 'Hạng C', 150000, 2, 2) RETURNING id`,
        [showtimeId],
      )
    ).rows[0].id;
    const waitingOnFreed = await wl.fillWaitlist(showtimeId, soldOutTierId, 1);
    const waitingOnOther = await wl.fillWaitlist(showtimeId, other, 1);

    await wl.releaseGaQuantity(soldOutTierId, 1);
    await notifyWaitlistForShowtime(showtimeId);

    const rows = await wl.getEntries(showtimeId);
    expect(rows.find((row) => row.id === waitingOnFreed[0].entryId)?.status).toBe('notified');
    expect(rows.find((row) => row.id === waitingOnOther[0].entryId)?.status).toBe('waiting');
  });

  it('tells nobody once the showtime has begun (UC-17 A6)', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.releaseGaQuantity(tierId, 1);
    await wl.beginShowtime(showtimeId);

    await notifyWaitlistForShowtime(showtimeId);

    expect((await wl.getEntries(showtimeId)).every((row) => row.status === 'waiting')).toBe(true);
    expect(await wl.getNotifications(queued[0].userId)).toHaveLength(0);
  });

  it('skips a place that has been served or has closed', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await pool.query(`UPDATE waitlists SET status = 'converted' WHERE id = $1`, [queued[0].entryId]);
    await wl.releaseGaQuantity(tierId, 1);

    await notifyWaitlistForShowtime(showtimeId);

    expect(await wl.getNotifications(queued[0].userId)).toHaveLength(0);
    expect(
      (await wl.getEntries(showtimeId)).find((row) => row.id === queued[1].entryId)?.status,
    ).toBe('notified');
  });

  it('says nothing twice inside the cooldown, however often stock flickers', async () => {
    // A seat held and released repeatedly used to be one mail per release per waiter. Ten waiters
    // and four flickers is forty mails about the same handful of tickets.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 3);
    await wl.releaseGaQuantity(tierId, 1);
    await notifyWaitlistForShowtime(showtimeId);

    await wl.releaseGaQuantity(tierId, 1);
    await notifyWaitlistForShowtime(showtimeId);

    for (const entry of queued) {
      const open = (await wl.getNotifications(entry.userId)).filter(
        (message) => message.type === 'waitlist_open',
      );
      expect(open).toHaveLength(1);
    }
  });

  it('tells nobody inside the 24-hour cutoff', async () => {
    // Stock can still flicker back through an expiring hold, but the queue is closing: telling
    // people to race for it now would cross the sweep that is about to shut their place.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.releaseGaQuantity(tierId, 1);
    await wl.enterCutoff(showtimeId);

    await notifyWaitlistForShowtime(showtimeId);

    expect((await wl.getEntries(showtimeId)).every((row) => row.status === 'waiting')).toBe(true);
    expect(await wl.getNotifications(queued[0].userId)).toHaveLength(0);
  });

  it('tells nobody about a cancelled showtime, whatever its seats say', async () => {
    // Cancelling releases the inventory, which used to read as "tickets came back" and invited ten
    // people to buy tickets to an occasion that is off.
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.releaseGaQuantity(tierId, 1);
    await wl.cancelShowtime(showtimeId);

    await notifyWaitlistForShowtime(showtimeId);

    expect(await wl.getNotifications(queued[0].userId)).toHaveLength(0);
  });

  it('tells nobody after the event is removed, even when the showtime still sells', async () => {
    const { eventId, showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 2);
    await wl.releaseGaQuantity(tierId, 1);
    await pool.query(`UPDATE events SET moderation_status = 'removed' WHERE id = $1`, [eventId]);

    await notifyWaitlistForShowtime(showtimeId);

    expect((await wl.getEntries(showtimeId)).every((row) => row.status === 'waiting')).toBe(true);
    expect(
      (await wl.getNotifications(queued[0].userId)).filter(
        (message) => message.type === 'waitlist_open',
      ),
    ).toHaveLength(0);
  });
});
