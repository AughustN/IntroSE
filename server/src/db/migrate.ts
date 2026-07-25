import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

// Minimal migration runner: applies every .sql file in ./migrations in filename order and records
// what it applied in `schema_migrations`, so re-running is a no-op instead of an error.
//   npm run db:migrate
//
// Backfill note: 0001/0002 were applied before this ledger existed and their DDL is not written with
// IF NOT EXISTS. So when an unrecorded migration fails with "already exists" (42P07 duplicate table,
// 42710 duplicate object, 42P16 duplicate index) it is treated as already applied and recorded,
// rather than blocking every later migration.
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');

const ALREADY_APPLIED = new Set(['42P07', '42710', '42P16']);

async function main() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skipping ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`applying ${file} ... `);
    try {
      await pool.query(sql);
      console.log('ok');
      ran += 1;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!code || !ALREADY_APPLIED.has(code)) {
        console.log('failed');
        throw e;
      }
      console.log('already present, recording');
    }
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
  }

  await pool.end();
  console.log(`done (${ran} applied, ${files.length} total)`);
}

main().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
