/*
 * Build and embed the chunk index.
 *
 * Run after seeding, after a bulk catalog import, and on a schedule. Safe to run repeatedly: an
 * event whose text has not changed since its last run is skipped on a hash comparison, so a no-op
 * pass over the whole catalog costs one query and no model calls.
 *
 *   npm run ai:index          -- only what changed
 *   npm run ai:index -- --all -- rebuild everything (after a model change)
 *
 * Deliberately a script, not a request path. Embedding several hundred chunks takes a minute of
 * CPU; nothing a user is waiting on should ever trigger it.
 */

import { pool } from '../../../db/pool.js';
import { chunkEvent, sourceHash, type ChunkableEvent } from '../chunking.js';
import { embedTexts, toVectorLiteral } from './embedding.client.js';

/** Embedding requests per call to the sidecar. Large enough to amortise, small enough to bound memory. */
const BATCH = 32;

type Row = ChunkableEvent & { id: number; stored_hash: string | null };

async function loadEvents(): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT e.id, e.title, e.original_title AS "originalTitle", e.description,
            coalesce(e.lineup, '{}') AS lineup, coalesce(e.genre, '{}') AS genre,
            coalesce(array_agg(DISTINCT v.name || ', ' || v.city) FILTER (WHERE v.id IS NOT NULL), '{}') AS venues,
            (SELECT c.source_hash FROM event_chunks c WHERE c.event_id = e.id LIMIT 1) AS stored_hash
       FROM events e
       LEFT JOIN showtimes s ON s.event_id = e.id
       LEFT JOIN venues v ON v.id = s.venue_id
      GROUP BY e.id
      ORDER BY e.id`,
  );
  return rows;
}

async function main(): Promise<void> {
  const rebuildAll = process.argv.includes('--all');
  const events = await loadEvents();

  let skipped = 0;
  let indexed = 0;
  let embedded = 0;
  let unembedded = 0;

  for (const event of events) {
    const source: ChunkableEvent = {
      title: event.title,
      originalTitle: event.originalTitle,
      description: event.description,
      lineup: event.lineup,
      genre: event.genre,
      venues: event.venues,
    };
    const hash = sourceHash(source);
    if (!rebuildAll && event.stored_hash === hash) {
      skipped += 1;
      continue;
    }

    const chunks = chunkEvent(source);
    if (!chunks.length) continue;

    // Vectors first, rows second: if the sidecar is down we still want the chunks written, so a
    // later run can embed them without re-splitting. `null` embeddings are invisible to retrieval.
    const vectors = await embedTexts(chunks.map((c) => c.content));
    if (vectors) embedded += chunks.length;
    else unembedded += chunks.length;

    await pool.query('DELETE FROM event_chunks WHERE event_id = $1', [event.id]);
    for (const [i, chunk] of chunks.entries()) {
      await pool.query(
        `INSERT INTO event_chunks (event_id, ordinal, kind, content, embedding, source_hash)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [event.id, chunk.ordinal, chunk.kind, chunk.content, vectors ? toVectorLiteral(vectors[i]!) : null, hash],
      );
    }
    indexed += 1;

    if (indexed % BATCH === 0) console.warn(`[index] ${indexed} events…`);
  }

  console.warn(
    `[index] done — ${indexed} indexed, ${skipped} unchanged, ${embedded} chunks embedded` +
      (unembedded ? `, ${unembedded} left unembedded (sidecar unavailable — rerun to fill)` : ''),
  );
  await pool.end();
}

await main();
