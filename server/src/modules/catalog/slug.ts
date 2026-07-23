import type { Db } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

/** Slugify a title: fold Vietnamese diacritics, lowercase, non-alphanumerics → hyphens (R-4, FR-031). */
export function slugify(input: string): string {
  const s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'su-kien';
}

/** A slug unique across events; set once at create, never regenerated on title edit. */
export async function generateUniqueSlug(title: string, db: Db = pool): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  while ((await db.query('SELECT 1 FROM events WHERE slug = $1', [slug])).rows.length > 0) {
    slug = `${base}-${++n}`;
  }
  return slug;
}
