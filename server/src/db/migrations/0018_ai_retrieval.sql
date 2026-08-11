-- 0018_ai_retrieval.sql -- Query-aware retrieval for the assistant (008).
--
-- Until now the assistant's candidate set ignored the question entirely: it was always "the twenty
-- soonest events on sale". That is invisible while the catalog holds twenty sellable events and
-- becomes a lie the moment it holds a hundred — a Hanoi play sitting fortieth by start date would
-- never reach the model, and the assistant would confidently answer that there is none.
--
-- Retrieval here is lexical, not semantic: Postgres full-text search over the event's own words,
-- plus trigram similarity for near-misses and typos. The dense half of a hybrid — an embedding
-- column and a vector index — is deliberately absent, see the note at the foot of this file.

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

/*
 * `unaccent(text)` is STABLE, not IMMUTABLE, because which dictionary it resolves depends on the
 * search path — so Postgres refuses it in a generated column or an index. Naming the dictionary
 * explicitly removes that dependency, which is what makes this wrapper safe to declare immutable.
 * It is also what lets Vietnamese be searched without diacritics: "ha noi" finds "Hà Nội".
 */
CREATE OR REPLACE FUNCTION immutable_unaccent(input TEXT)
  RETURNS TEXT
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
-- Schema-qualified, and the dictionary cast written out: inside a function body the bare literal
-- stays `unknown` and Postgres will not guess `regdictionary` for it, so the two-argument form goes
-- unresolved until the column is first computed — long after the migration appears to have parsed.
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, input) $$;

/*
 * `array_to_string(anyarray, text)` is STABLE, not IMMUTABLE, because for an arbitrary element type
 * it has to call that type's output function and Postgres cannot promise those are immutable.
 * Narrowing the signature to TEXT[] removes the doubt — text's output function is the identity — so
 * this wrapper is not a promise the planner cannot keep, which is what a blanket cast would be.
 */
CREATE OR REPLACE FUNCTION immutable_join(parts TEXT[])
  RETURNS TEXT
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$ SELECT array_to_string(parts, ' ') $$;

/*
 * One searchable document per event, maintained by the database.
 *
 * `simple` rather than a language configuration: Postgres ships no Vietnamese stemmer, and running
 * the English one over Vietnamese mangles words that merely look like English inflections. Vietnamese
 * is analytic — words do not inflect — so plain tokenisation loses very little.
 *
 * Weighted so a match in the title outranks a match buried in a description: A for the title, B for
 * the line-up and genre (an attendee searching an artist's name means it), C for the blurb.
 */
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS search_doc tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', immutable_unaccent(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce(original_title, ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce(immutable_join(lineup), ''))), 'B') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce(immutable_join(genre), ''))), 'B') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce(description, ''))), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_events_search_doc ON events USING GIN (search_doc);

-- Trigram over the title, for the half-remembered and the mistyped: "trinh cong son" still finds
-- "Trịnh Công Sơn" when full-text search finds nothing because no whole token matched.
CREATE INDEX IF NOT EXISTS idx_events_title_trgm
  ON events USING GIN (immutable_unaccent(title) gin_trgm_ops);

-- Venue city, same treatment: "ha noi" has to reach "Hà Nội" without the reader typing the tones.
CREATE INDEX IF NOT EXISTS idx_venues_city_trgm
  ON venues USING GIN (immutable_unaccent(city) gin_trgm_ops);

/*
 * The dense half is not here on purpose.
 *
 * `vector` is available on this Postgres and an `events.embedding vector(N)` column plus an HNSW
 * index would slot in beside the two indexes above without changing a line of the service — the
 * retrieval function already returns a ranked list and the caller never sees how it was ranked.
 * What is missing is a way to fill it: the configured AI gateway rejects every embedding model on
 * this API key ("Please subscribe to model in the API Key"), so there is nothing to compute vectors
 * with. Add the column when an embedding model exists, not before: an empty vector index retrieves
 * nothing and costs writes on every event edit.
 */

COMMIT;
