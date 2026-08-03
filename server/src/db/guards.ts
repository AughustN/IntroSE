import { config } from "../config.js";

/**
 * Two URLs are the same Neon branch when they reach the same endpoint and database. Credentials,
 * `sslmode`, `channel_binding` and the `-pooler` suffix all vary between copies of the same branch
 * URL, so comparing whole strings would let a pooled URL slip past a direct one.
 */
function branchKey(url: string, label: string): string {
  try {
    // Quotes survive when the value arrives from a shell rather than through dotenv, which strips
    // them. Left in place they make the URL unparseable — and an unparseable demo URL used to
    // disable this guard silently, which is worse than any typo it was meant to catch.
    const parsed = new URL(url.trim().replace(/^["']|["']$/g, ""));
    return `${parsed.hostname.replace("-pooler", "")}${parsed.pathname}`;
  } catch {
    throw new Error(`${label} is set but is not a valid connection URL, so it cannot be checked.`);
  }
}

/**
 * Refuse to run a job that deletes rows while pointed at the demo branch. The demo data was
 * uploaded by hand and no script rebuilds it, so a wrong DATABASE_URL there is not recoverable
 * by re-running anything.
 *
 * A blank DEMO_DATABASE_URL disables the check — there is no branch to protect yet.
 */
export function assertNotDemoBranch(job: string): void {
  if (!config.demoDatabaseUrl.trim()) return;

  const demo = branchKey(config.demoDatabaseUrl, "DEMO_DATABASE_URL");
  if (branchKey(config.databaseUrl, "the configured database URL") !== demo) return;

  throw new Error(
    `${job} refuses to run: the configured database is the demo branch (${demo}). ` +
      `Demo data is not regenerable. Point DATABASE_URL somewhere else first.`,
  );
}
