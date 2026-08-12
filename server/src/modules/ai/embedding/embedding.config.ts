/**
 * The embedding model, and why it is this one.
 *
 * Chosen by measurement, not reputation. Two multilingual candidates were probed against Vietnamese
 * paraphrase queries over a seeded catalog, scoring how often the intended event ranked first and —
 * more importantly — how far apart the best and worst matches ended up:
 *
 *   multilingual-e5-small       q8    1/3 correct   +359 MB   score spread 0.002 – 0.039
 *   multilingual-e5-small       fp32  2/3 correct   +666 MB   score spread 0.009 – 0.039
 *   paraphrase-MiniLM-L12-v2    q8    3/4 correct   +352 MB   score spread 0.304
 *
 * E5 is the better-known retrieval model and was the first pick; it lost on the spread. A gap of
 * 0.002 between the best and worst candidate is noise, not signal — nothing can be thresholded on
 * it, rank fusion cannot weigh it against a lexical score, and a trivial perturbation reorders the
 * results. MiniLM separates by two orders of magnitude more, at half the memory.
 *
 * `fp16` is not offered: it fails ONNX Runtime graph initialisation on this build.
 */
export const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

/** Fixed by the model. Changing the model means re-embedding every chunk and a new migration. */
export const EMBEDDING_DIMENSIONS = 384;

/** Loopback only — see the note in `embedder.server.ts` on why this is a separate process. */
export const embedderPort = (): number => {
  const value = Number(process.env.AI_EMBEDDER_PORT);
  return Number.isFinite(value) && value > 0 ? value : 4100;
};

export const embedderUrl = (): string =>
  process.env.AI_EMBEDDER_URL?.trim() || `http://127.0.0.1:${embedderPort()}`;

/**
 * How long the API waits for a vector before giving up on the dense half.
 *
 * Short on purpose. Embedding one short question measured at ~4 ms once the model is warm, so
 * anything approaching this budget means the sidecar is down, restarting, or still loading — none
 * of which should hold up an answer that lexical retrieval can already produce.
 */
export const EMBED_TIMEOUT_MS = 1_500;
