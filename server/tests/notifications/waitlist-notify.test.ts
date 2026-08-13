import { describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { notifyWaitlistForShowtime } from '../../src/modules/notifications/notifications.service.js';
import * as wl from '../helpers/waitlistSeed.js';

describe('telling the queue that tickets came back (US2, FR-007)', () => {
  it('tells the five earliest joiners and nobody else', async () => {
    const { showtimeId, tierId } = await wl.seedSoldOutGaShowtime(10);
    const queued = await wl.fillWaitlist(showtimeId, tierId, 7);
    await wl.releaseGaQuantity(tierId, 1);

    await notifyWaitlistForShowtime(showtimeId);

    const rows = await wl.getEntries(showtimeId);
    const notified = rows.filter((row) => row.status === 'notified');
    expect(notified).toHaveLength(5);
    // Earliest five by join time — the first five ids `fillWaitlist` produced, in that order.
    expect(notified.map((row) => row.id).sort((a, b) => a - b)).toEqual(
      queued.slice(0, 5).map((entry) => entry.entryId).sort((a, b) => a - b),
    );
    expect(notified.every((row) => row.notified_at !== null)).toBe(true);
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
});
