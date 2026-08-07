import pg from 'pg';
import { config } from '../config.js';

type PromiseQuery = (...args: unknown[]) => Promise<pg.QueryResult>;

const sensitiveField = /password|secret|token|hash|key|authorization|cookie|otp/i;

function queryInfo(args: unknown[]) {
  const statement = args[0];
  const query =
    typeof statement === 'string'
      ? statement
      : statement && typeof statement === 'object' && 'text' in statement && typeof statement.text === 'string'
        ? statement.text
        : '[unknown query]';
  const configValues = statement && typeof statement === 'object' && 'values' in statement ? statement.values : undefined;
  const values = Array.isArray(args[1]) ? args[1] : configValues;

  return { query, values: sensitiveField.test(query) ? '[redacted]' : values };
}

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sensitiveField.test(key) ? '[redacted]' : sanitizeForLog(item)]),
  );
}

async function logQuery(args: unknown[], execute: PromiseQuery): Promise<pg.QueryResult> {
  const info = queryInfo(args);

  try {
    const result = await execute(...args);
    console.log('[sql] success', {
      ...info,
      rowCount: result.rowCount,
      rows: sanitizeForLog(result.rows),
    });
    return result;
  } catch (error) {
    const err = error as { message?: string; code?: string; detail?: string };
    console.error('[sql] error', {
      ...info,
      message: err.message ?? String(error),
      code: err.code,
      detail: err.detail,
    });
    throw error;
  }
}

// Parse BIGINT (int8, OID 20) as a JS number — all our ids and VND amounts sit well within
// Number.MAX_SAFE_INTEGER. Without this, pg returns bigints as strings, breaking strict === owner
// checks and numeric zod validation on ids echoed back by the client.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));

// Bounded pool (≤20, SCAL-01). Neon requires TLS.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  ssl: { rejectUnauthorized: false },
});

const originalPoolQuery = pool.query.bind(pool) as unknown as PromiseQuery;
(pool.query as unknown as PromiseQuery) = (...args) => logQuery(args, originalPoolQuery);

pool.on('error', (error) => {
  console.error('[sql] pool error', error);
});

export type Db = pg.Pool | pg.PoolClient;

/** Run a function inside a single transaction, rolling back on any error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const originalClientQuery = client.query.bind(client) as unknown as PromiseQuery;
  (client.query as unknown as PromiseQuery) = (...args) => logQuery(args, originalClientQuery);

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    (client.query as unknown as PromiseQuery) = originalClientQuery;
    client.release();
  }
}
