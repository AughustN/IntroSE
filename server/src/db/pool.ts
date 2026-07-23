import pg from 'pg';
import { config } from '../config.js';

// Bounded pool (≤20, SCAL-01). Neon requires TLS.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  ssl: { rejectUnauthorized: false },
});

export type Db = pg.Pool | pg.PoolClient;

/** Run a function inside a single transaction, rolling back on any error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
