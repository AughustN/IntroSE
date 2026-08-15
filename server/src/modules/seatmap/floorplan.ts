import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { FLOORPLAN_MAX_PX } from '../../config.js';

// Floor-plan images: uploaded, re-encoded, stored on the VPS disk, served by Nginx (ADR 0004).
// A direct sibling of modules/auth/avatar.ts — the same magic-byte and re-encode guarantees, in the
// same shape, rather than a second hand-rolled validator.
//
// The plan is a BACKGROUND LAYER ONLY: it never creates a seat and never determines a seat's status
// (FR-020, Principle I). It is served under an unguessable name with no per-request access check —
// the buyer-visibility toggle governs display, not reachability (FR-026a).

export const FLOORPLAN_URL_PREFIX = '/uploads/floorplans/';
export const floorplanDir = (): string => join(process.cwd(), 'uploads', 'floorplans');

export class ImageRejected extends Error {
  constructor(public reason: 'invalid_image' | 'image_too_large') {
    super(reason);
  }
}

/** Identify a raster image by magic bytes — never Content-Type, never the extension. */
function detectImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Is this an SVG? Text, so there are no magic bytes — the root element is the marker.
 *
 * Only the first bytes are examined, and only for a `<svg` root possibly preceded by an XML
 * declaration, a BOM or a doctype. Anything cleverer would be pattern-matching a document we are
 * about to hand to a real parser anyway.
 */
function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return /^<(\?xml|!doctype\s+svg|svg)[\s>]/i.test(head);
}

/**
 * Reasons an SVG is refused before it reaches a parser.
 *
 * The stored file is a WEBP — see `processFloorPlan` — so none of this is what stops script running
 * in a browser; that is settled by never serving the SVG at all. This is about what happens on the
 * SERVER, where librsvg is being asked to render a document a stranger uploaded:
 *
 *   - external references (`http:`, `//`, `file:`) are an SSRF and a local-file read, because the
 *     renderer would fetch them from inside our network;
 *   - a DOCTYPE with an internal subset is how entity-expansion bombs are written;
 *   - `<foreignObject>` embeds arbitrary HTML in the render tree.
 *
 * Refused outright rather than stripped. Editing someone's XML into something we consider safe means
 * being confident about every construct it might contain; refusing means being confident about four.
 */
const SVG_REFUSALS: [RegExp, string][] = [
  [/<\s*script/i, 'script'],
  [/<\s*foreignObject/i, 'foreignObject'],
  [/<!DOCTYPE[^>]*\[/i, 'doctype-subset'],
  [/\b(?:xlink:href|href|src)\s*=\s*["']\s*(?:https?:)?\/\//i, 'external-reference'],
  [/\b(?:xlink:href|href|src)\s*=\s*["']\s*file:/i, 'file-reference'],
  [/<!ENTITY/i, 'entity'],
];

/** The first thing wrong with this SVG, or null if nothing on the list is. */
export function svgRefusal(buf: Buffer): string | null {
  const text = buf.toString('utf8');
  for (const [pattern, reason] of SVG_REFUSALS) if (pattern.test(text)) return reason;
  return null;
}

/**
 * Validate and re-encode an uploaded floor plan to a clean webp (strips EXIF and any embedded
 * payload, ADR 0004).
 *
 * Dimensions are read BEFORE any resize on purpose: a 2 MB PNG that decodes to 30000×30000 is a
 * decompression bomb, and checking after the decode would mean allocating it first (FR-023).
 */
export async function processFloorPlan(buffer: Buffer): Promise<Buffer> {
  const svg = looksLikeSvg(buffer);
  if (!svg && !detectImage(buffer)) throw new ImageRejected('invalid_image');

  /*
   * An SVG is RASTERISED, never stored (§24).
   *
   * The reason SVG was refused outright still stands: uploads are served from this origin under a
   * URL anyone holding it can open, and an SVG opened directly runs its script in our origin. That
   * is not fixed by sanitising the file, because the whole risk is in serving it as SVG at all.
   *
   * Rendering it to webp removes the question. The organizer gets what they actually wanted — to
   * trace over a vector export of the venue — and what lands on disk is a picture, indistinguishable
   * from an uploaded PNG, going through the very same re-encode as everything else.
   *
   * `svgRefusal` is the separate, server-side concern: librsvg is about to parse a stranger's XML,
   * and it must not be asked to fetch a URL or expand an entity bomb while doing it.
   */
  if (svg) {
    const refusal = svgRefusal(buffer);
    if (refusal) throw new ImageRejected('invalid_image');
  }

  // `density` fixes how many pixels an SVG unit becomes. Without it a document sized in millimetres
  // renders at a default 72dpi and comes out unusably small; with it, the dimension check below is
  // what keeps a deliberately huge viewBox from becoming a decompression bomb.
  const input = svg ? sharp(buffer, { density: 150 }) : sharp(buffer);

  const meta = await input.metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new ImageRejected('invalid_image');
  if (Math.max(meta.width, meta.height) > FLOORPLAN_MAX_PX) throw new ImageRejected('image_too_large');

  return (svg ? sharp(buffer, { density: 150 }) : sharp(buffer).rotate()).webp({ quality: 80 }).toBuffer();
}

/** Store the processed plan under a random name, return its public URL. */
export async function saveFloorPlan(webp: Buffer): Promise<string> {
  const name = `${randomUUID()}.webp`;
  const dir = floorplanDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), webp);
  return `${FLOORPLAN_URL_PREFIX}${name}`;
}

/** Best-effort delete of a previously-uploaded plan. Replacing or removing one makes the old file
 *  unreachable; seats keep their exact positions either way (FR-025). */
export async function deleteFloorPlan(url: string | null): Promise<void> {
  if (!url?.startsWith(FLOORPLAN_URL_PREFIX)) return;
  await unlink(join(floorplanDir(), basename(url))).catch(() => {});
}
