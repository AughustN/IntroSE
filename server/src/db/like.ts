/**
 * A user's words, turned into a safe `LIKE`/`ILIKE` pattern.
 *
 * Every admin search built its pattern in SQL as `'%' || $1 || '%'`, which passes the caller's text
 * through with its metacharacters intact: `%` matches anything, `_` matches any single character.
 * That is not an injection — the value is still a parameter — but it is wrong in a way that is hard
 * to report. Searching an order for `100%` matched every order in the table; searching a name for
 * `a_b` matched `axb`. Nobody sees an error, they just see the wrong rows.
 *
 * Escaped here rather than in each query, so a fifth search cannot quietly reintroduce it, and so
 * the SQL reads `ILIKE $1` instead of a three-deep `replace()` nobody will maintain.
 *
 * Backslash is Postgres's default `LIKE` escape character, and it is escaped first — reversing the
 * order would double the backslashes this function itself inserts.
 */
export function likePattern(query: string | null | undefined): string | null {
  const text = query?.trim();
  if (!text) return null;
  const escaped = text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${escaped}%`;
}
