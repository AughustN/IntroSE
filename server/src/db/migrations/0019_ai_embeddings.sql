-- 0019_ai_embeddings.sql -- The dense half of retrieval (008).
--
-- Lexical retrieval (0018) finds an event when the reader uses its words. It cannot find "Đêm nhạc
-- Trịnh Công Sơn" from "nhạc buồn nhẹ nhàng cuối tuần", which shares one common noun with it and
-- nothing else. That is what embeddings are for, and it is the gap this migration fills.
--
-- 384 dimensions because that is what `Xenova/paraphrase-multilingual-MiniLM-L12-v2` produces.
-- Changing the model later means re-embedding every row, so the number is a commitment: see
-- specs/008-ai-chatbot/rag-upgrade-plan.md for the measurements behind the choice.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

/*
 * Chunks, not whole events.
 *
 * A festival's thousand-word blurb and its six-word title are not one document. Embedded together
 * the title's signal is averaged away, and a question about the headline act matches worse than a
 * question about a sentence buried in paragraph four. Splitting lets each part be found on its own
 * terms; `kind` is what lets a title hit outrank a description hit at fusion time.
 *
 * Retrieval is per chunk, the answer is still per event: a chunk's score is credited to its parent
 * and an event scores as its best chunk. Nothing downstream sees a chunk.
 */
CREATE TABLE IF NOT EXISTS event_chunks (
  id         BIGSERIAL PRIMARY KEY,
  event_id   BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('title', 'lineup', 'description', 'venue')),
  content    TEXT NOT NULL,
  -- Nullable on purpose. Chunks are written by the indexer in one pass and embedded in another, so
  -- a row exists before its vector does; a NULL here means "not embedded yet", which the retriever
  -- treats as absent rather than as a zero vector that would match everything equally badly.
  embedding  vector(384),
  -- What the chunk was built from. The indexer rewrites a chunk only when this changes, so a run
  -- over an unchanged catalog costs one hash comparison per event and no model calls at all.
  source_hash TEXT NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_event_chunks_event ON event_chunks(event_id);

/*
 * HNSW over cosine distance, matching the normalised vectors the embedder produces.
 *
 * Built now rather than deferred: the table is empty, so the build is instant, and an index created
 * later on a populated table locks it for the duration. `vector_cosine_ops` because embeddings are
 * L2-normalised at write time — with unit vectors cosine and inner product agree, and cosine is the
 * one that stays correct if a future model forgets to normalise.
 */
CREATE INDEX IF NOT EXISTS idx_event_chunks_embedding
  ON event_chunks USING hnsw (embedding vector_cosine_ops);

COMMIT;
