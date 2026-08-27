import { expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { api, auth, makeStudio } from "./helpers.js";

it("keeps past showtimes' tiers read-only across add, edit, remove and restore", async () => {
  const s = await makeStudio();
  await pool.query(`UPDATE showtimes SET starts_at=now()-interval '1 hour' WHERE id=$1`, [
    s.showtimeId,
  ]);
  await api()
    .post(`/api/organizer/showtimes/${s.showtimeId}/tiers`)
    .set(auth(s.token))
    .send({ label: "Vé mới", price: 0 })
    .expect(409);
  await api()
    .patch(`/api/organizer/tiers/${s.tierId}`)
    .set(auth(s.token))
    .send({ price: 1 })
    .expect(409);
  await api().delete(`/api/organizer/tiers/${s.tierId}`).set(auth(s.token)).expect(409);
  await pool.query(`UPDATE ticket_tiers SET archived_at=now() WHERE id=$1`, [s.tierId]);
  await api().post(`/api/organizer/tiers/${s.tierId}/restore`).set(auth(s.token)).expect(409);
  const row = (
    await pool.query(
      `SELECT price_amount::int AS price, archived_at FROM ticket_tiers WHERE id=$1`,
      [s.tierId],
    )
  ).rows[0];
  expect(row.price).toBe(100000);
  expect(row.archived_at).not.toBeNull();
});
