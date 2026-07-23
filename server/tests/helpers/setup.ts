import { afterAll, beforeEach } from 'vitest';
import { pool } from '../../src/db/pool.js';

// Integration tests share one Postgres database (the Neon TEST branch). Truncate the
// auth tables before every test so cases don't leak into each other. Runs serially
// (vitest.config: fileParallelism false).
beforeEach(async () => {
  await pool.query(
    `TRUNCATE users, wallets, refresh_tokens, password_resets, auth_events, organizers RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});
