import { EMBED_TIMEOUT_MS, EMBEDDING_DIMENSIONS, embedderUrl } from './embedding.config.js';

/**
 * Ask the sidecar for vectors, and never let that be the reason an answer fails.
 *
 * Returning `null` rather than throwing is the whole design: the dense retriever is one half of a
 * hybrid, and the lexical half needs no model, no sidecar and no network. A sidecar that is down,
 * restarting, or still warming degrades the assistant from "understands paraphrase" to "matches
 * words", which is where it was last week — a quality reduction, not an outage. That is the same
 * bargain every other AI path in this module makes (Principle III).
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  try {
    const response = await fetch(`${embedderUrl()}/embed`, {
      method: 'POST',
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    if (!response.ok) {
      console.warn(`[embedding] sidecar answered ${response.status}; falling back to lexical only`);
      return null;
    }
    const body = (await response.json()) as { embeddings?: unknown };
    const vectors = body.embeddings;
    // Shape-checked rather than trusted: a vector of the wrong width would be rejected by Postgres
    // anyway, but as a 500 on a chat request rather than as a quiet fallback.
    if (
      !Array.isArray(vectors) ||
      vectors.length !== texts.length ||
      !vectors.every((v) => Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS)
    ) {
      console.warn('[embedding] sidecar returned an unexpected shape; falling back to lexical only');
      return null;
    }
    return vectors as number[][];
  } catch (error) {
    console.warn(
      '[embedding] sidecar unreachable; falling back to lexical only:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** One vector, or null. Convenience for the query side, which only ever embeds one string. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const vectors = await embedTexts([text]);
  return vectors?.[0] ?? null;
}

/** pgvector's text input format. `JSON.stringify` happens to produce exactly it. */
export const toVectorLiteral = (vector: number[]): string => JSON.stringify(vector);
