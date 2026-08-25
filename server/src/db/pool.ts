import pg from "pg";
import { config, DB_LOCK_TIMEOUT_MS } from "../config.js";

type PromiseQuery = (...args: unknown[]) => Promise<pg.QueryResult>;

const sensitiveField = /password|secret|token|hash|key|authorization|cookie|otp/i;

function queryInfo(args: unknown[]) {
  const statement = args[0];
  const query =
    typeof statement === "string"
      ? statement
      : statement &&
          typeof statement === "object" &&
          "text" in statement &&
          typeof statement.text === "string"
        ? statement.text
        : "[unknown query]";
  const configValues =
    statement && typeof statement === "object" && "values" in statement
      ? statement.values
      : undefined;
  const values = Array.isArray(args[1]) ? args[1] : configValues;

  return { query, values: sensitiveField.test(query) ? "[redacted]" : values };
}

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveField.test(key) ? "[redacted]" : sanitizeForLog(item),
    ]),
  );
}

async function logQuery(args: unknown[], execute: PromiseQuery): Promise<pg.QueryResult> {
  const info = queryInfo(args);

  try {
    const result = await execute(...args);
    console.log("[sql] success", {
      ...info,
      rowCount: result.rowCount,
      rows: sanitizeForLog(result.rows),
    });
    return result;
  } catch (error) {
    const err = error as { message?: string; code?: string; detail?: string };
    console.error("[sql] error", {
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

pool.on("error", (error) => {
  console.error("[sql] pool error", error);
});

export type Db = pg.Pool | pg.PoolClient;

/** Run a function inside a single transaction, rolling back on any error.
 *
 *  A Postgres deadlock (40P01) means the server picked THIS transaction as the victim and already
 *  rolled it back — re-running the same work from a clean BEGIN is the sanctioned recovery, so the
 *  helper retries a few times with jitter before surfacing the error. Every caller wraps its whole
 *  statement set in one transaction, so the retry never observes its own half-applied writes.
 *
 *  Every transaction also opens with a `lock_timeout`, so no caller can sit on a pool connection
 *  indefinitely waiting for a row another transaction holds. See `DB_LOCK_TIMEOUT_MS`. A caller
 *  whose work legitimately queues longer than the default passes its own `lockTimeoutMs`; the
 *  ceiling still has to exist, because an unbounded one is what turns seat contention into a
 *  site-wide outage. */
const DEADLOCK = "40P01";
const DEADLOCK_RETRIES = 3;

/** `lock_not_available` — this transaction waited out `lock_timeout` and was aborted. */
export const LOCK_TIMEOUT = "55P03";

export interface TransactionOptions {
  /** Overrides `DB_LOCK_TIMEOUT_MS` for this transaction only. Rounded to whole milliseconds. */
  lockTimeoutMs?: number;
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  // `SET` takes no bind parameters, so the value is interpolated — hence the coercion to a positive
  // integer here rather than trusting the caller. `lock_timeout` counts milliseconds by default.
  const requested = Math.trunc(options.lockTimeoutMs ?? DB_LOCK_TIMEOUT_MS);
  const lockTimeout = Number.isFinite(requested) && requested > 0 ? requested : DB_LOCK_TIMEOUT_MS;

  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    const originalClientQuery = client.query.bind(client) as unknown as PromiseQuery;
    (client.query as unknown as PromiseQuery) = (...args) => logQuery(args, originalClientQuery);

    try {
      // One round trip, not two: the pool talks to Neon over the network, and an extra RTT on every
      // transaction in the app is a real cost next to the milliseconds a hold transaction takes.
      // `SET LOCAL` reverts at COMMIT/ROLLBACK, so the pooled connection goes back unmodified.
      await client.query(`BEGIN; SET LOCAL lock_timeout = ${lockTimeout}`);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if ((err as { code?: string }).code === DEADLOCK && attempt <= DEADLOCK_RETRIES) {
        await new Promise((r) => setTimeout(r, 40 * attempt + Math.random() * 80));
        continue;
      }
      throw err;
    } finally {
      (client.query as unknown as PromiseQuery) = originalClientQuery;
      client.release();
    }
  }
}
