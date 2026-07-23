import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';

export const AVATAR_URL_PREFIX = '/uploads/avatars/';
export const avatarDir = (): string => join(process.cwd(), 'uploads', 'avatars');

/** Identify a raster image by magic bytes (never trust Content-Type/extension).
 *  SVG and everything else → null (rejected). */
function detectImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Validate + re-encode an uploaded avatar to a clean webp (strips EXIF/payloads,
 *  ADR 0004). Throws on a non-raster / disallowed image. */
export async function processAvatar(buffer: Buffer): Promise<Buffer> {
  if (!detectImage(buffer)) throw new Error('invalid_image');
  return sharp(buffer).rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
}

/** Store the processed avatar under a random name, return its public URL. */
export async function saveAvatar(webp: Buffer): Promise<string> {
  const name = `${randomUUID()}.webp`;
  const dir = avatarDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), webp);
  return `${AVATAR_URL_PREFIX}${name}`;
}

/** Best-effort delete of a previously-uploaded avatar file. */
export async function deleteAvatar(url: string | null): Promise<void> {
  if (!url?.startsWith(AVATAR_URL_PREFIX)) return;
  await unlink(join(avatarDir(), basename(url))).catch(() => {});
}
