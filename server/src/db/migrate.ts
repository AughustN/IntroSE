import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

// Minimal migration runner (task T007): applies every .sql file in ./migrations
// in filename order, inside one transaction each. Idempotency is the migration's
// own concern; for a fresh DB the auth migration runs clean.
//   npm run db:migrate
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');

async function main() {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`applying ${file} ... `);
    await pool.query(sql);
    console.log('ok');
  }
  await pool.end();
  console.log(`done (${files.length} migration(s))`);
}

main().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
