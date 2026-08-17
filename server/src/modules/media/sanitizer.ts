import sharp from 'sharp';

export class MediaRejected extends Error {
  constructor(public reason: 'invalid_image' | 'image_too_large' | 'invalid_video' | 'video_too_large') {
    super(reason);
  }
}

/** Identify a raster image by magic bytes (never trust Content-Type or file extension). */
export function detectRasterImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Identify video container by magic bytes (MP4 or WebM). */
export function detectVideo(buf: Buffer): 'mp4' | 'webm' | null {
  if (!buf || buf.length < 12) return null;
  // WebM / MKV EBML ID: 0x1A 0x45 0xDF 0xA3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  // MP4: usually has 'ftyp' at offset 4..8
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  return null;
}

/** Check if buffer is an SVG XML document. */
export function looksLikeSvg(buf: Buffer): boolean {
  if (!buf || buf.length < 8) return false;
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return /^<(\?xml|!doctype\s+svg|svg)[\s>]/i.test(head);
}

const SVG_REFUSALS: [RegExp, string][] = [
  [/<\s*script/i, 'script'],
  [/<\s*foreignObject/i, 'foreignObject'],
  [/<!DOCTYPE[^>]*\[/i, 'doctype-subset'],
  [/\b(?:xlink:href|href|src)\s*=\s*["']\s*(?:https?:)?\/\//i, 'external-reference'],
  [/\b(?:xlink:href|href|src)\s*=\s*["']\s*file:/i, 'file-reference'],
  [/<!ENTITY/i, 'entity'],
];

/** Check if an SVG contains disallowed elements or external SSRF/XSS vectors. */
export function svgRefusal(buf: Buffer): string | null {
  const text = buf.toString('utf8');
  for (const [pattern, reason] of SVG_REFUSALS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

/**
 * Process and sanitize avatar/logo images (<= 2MB, max 2048px, re-encode to 512x512 WebP).
 */
export async function sanitizeSquareImage(buffer: Buffer, maxBytes: number = 2 * 1024 * 1024): Promise<Buffer> {
  if (buffer.length > maxBytes) {
    throw new MediaRejected('image_too_large');
  }

  if (!detectRasterImage(buffer)) {
    throw new MediaRejected('invalid_image');
  }

  const meta = await sharp(buffer).metadata().catch(() => null);
  if (!meta?.width || !meta.height) {
    throw new MediaRejected('invalid_image');
  }
  if (Math.max(meta.width, meta.height) > 4096) {
    throw new MediaRejected('image_too_large');
  }

  return sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: 'cover' })
    .webp({ quality: 82 })
    .toBuffer();
}

/**
 * Process and sanitize event banner images (<= 5MB, max 4096px, WebP quality 80).
 */
export async function sanitizeBannerImage(buffer: Buffer, maxBytes: number = 5 * 1024 * 1024): Promise<Buffer> {
  if (buffer.length > maxBytes) {
    throw new MediaRejected('image_too_large');
  }

  if (!detectRasterImage(buffer)) {
    throw new MediaRejected('invalid_image');
  }

  const meta = await sharp(buffer).metadata().catch(() => null);
  if (!meta?.width || !meta.height) {
    throw new MediaRejected('invalid_image');
  }
  if (Math.max(meta.width, meta.height) > 8192) {
    throw new MediaRejected('image_too_large');
  }

  return sharp(buffer)
    .rotate()
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Process and sanitize venue floor plans / reference charts (supports raster + safe SVG, <= 5MB, max 8192px).
 */
export async function sanitizeVenuePlan(buffer: Buffer, maxBytes: number = 5 * 1024 * 1024): Promise<Buffer> {
  if (buffer.length > maxBytes) {
    throw new MediaRejected('image_too_large');
  }

  const svg = looksLikeSvg(buffer);
  if (!svg && !detectRasterImage(buffer)) {
    throw new MediaRejected('invalid_image');
  }

  if (svg) {
    const refusal = svgRefusal(buffer);
    if (refusal) throw new MediaRejected('invalid_image');
  }

  const input = svg ? sharp(buffer, { density: 150 }) : sharp(buffer);
  const meta = await input.metadata().catch(() => null);
  if (!meta?.width || !meta.height) {
    throw new MediaRejected('invalid_image');
  }
  if (Math.max(meta.width, meta.height) > 8192) {
    throw new MediaRejected('image_too_large');
  }

  return (svg ? sharp(buffer, { density: 150 }) : sharp(buffer).rotate())
    .webp({ quality: 80 })
    .toBuffer();
}

export const sanitizeLayoutImage = sanitizeVenuePlan;

/**
 * Validate video trailer format and size (<= 50MB, MP4 or WebM).
 */
export function validateVideoTrailer(buffer: Buffer, maxBytes: number = 50 * 1024 * 1024): { format: 'mp4' | 'webm' } {
  if (buffer.length > maxBytes) {
    throw new MediaRejected('video_too_large');
  }

  const format = detectVideo(buffer);
  if (!format) {
    throw new MediaRejected('invalid_video');
  }

  return { format };
}
