import { createHash } from 'node:crypto';

export type ChunkKind = 'title' | 'lineup' | 'description' | 'venue';

export interface EventChunk {
  ordinal: number;
  kind: ChunkKind;
  content: string;
}

export interface ChunkableEvent {
  title: string;
  originalTitle: string | null;
  description: string | null;
  lineup: string[];
  genre: string[];
  venues: string[];
}

/**
 * Roughly how much text goes in one chunk, and how much of the previous one comes with it.
 *
 * 400 characters is a few Vietnamese sentences — long enough to carry a thought, short enough that
 * one embedding is about one thing. The 80-character overlap exists so a sentence split across a
 * boundary is still findable whole from one side or the other.
 */
const MAX_CHARS = 400;
const OVERLAP = 80;

/**
 * Split on the largest natural boundary that fits, and only fall back to cutting mid-text when
 * there is no boundary to use. Paragraphs first, then sentences, then words — the order a reader
 * would choose if asked to divide the same passage.
 */
function splitLong(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_CHARS) return clean ? [clean] : [];

  const pieces: string[] = [];
  let rest = clean;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    const boundary =
      Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? ')) + 1 ||
      window.lastIndexOf(' ');
    const cut = boundary > MAX_CHARS * 0.5 ? boundary : MAX_CHARS;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(Math.max(0, cut - OVERLAP)).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/**
 * Turn one event into the pieces retrieval works over.
 *
 * The title, the people, the venue and the blurb are separate chunks rather than one document
 * because they answer different questions and compete on different words. Embedded together, a
 * six-word title is averaged into a thousand-word description and stops being findable on its own
 * terms — which is precisely the query a reader is most likely to type.
 */
export function chunkEvent(event: ChunkableEvent): EventChunk[] {
  const chunks: EventChunk[] = [];
  const push = (kind: ChunkKind, text: string) => {
    for (const content of splitLong(text)) {
      chunks.push({ ordinal: chunks.length, kind, content });
    }
  };

  const titles = [event.title, event.originalTitle].filter(Boolean).join(' — ');
  push('title', titles);

  const people = [...event.lineup, ...event.genre].filter(Boolean).join(', ');
  if (people) push('lineup', people);

  if (event.venues.length) push('venue', event.venues.join(', '));
  if (event.description) push('description', event.description);

  return chunks;
}

/**
 * What the chunks were built from.
 *
 * Stored per chunk so the indexer can skip an event whose text has not moved. Without it every run
 * re-embeds the whole catalog, which is minutes of CPU to produce identical vectors.
 */
export const sourceHash = (event: ChunkableEvent): string =>
  createHash('sha256').update(JSON.stringify(event)).digest('hex');
