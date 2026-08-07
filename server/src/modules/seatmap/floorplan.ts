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

/** Identify a raster image by magic bytes — never Content-Type, never the extension.
 *  SVG and everything else → null (rejected: embedded script is same-origin XSS). */
function detectImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
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
  if (!detectImage(buffer)) throw new ImageRejected('invalid_image');

  const meta = await sharp(buffer).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new ImageRejected('invalid_image');
  if (Math.max(meta.width, meta.height) > FLOORPLAN_MAX_PX) throw new ImageRejected('image_too_large');

  return sharp(buffer).rotate().webp({ quality: 80 }).toBuffer();
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
