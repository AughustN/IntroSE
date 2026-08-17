import { uploadToCloudinary } from '../../services/cloudinary.js';
import { sanitizeSquareImage } from '../media/sanitizer.js';

/** Validate + re-encode an uploaded avatar to a clean webp (strips EXIF/payloads,
 *  ADR 0004). Throws on a non-raster / disallowed image. */
export async function processAvatar(buffer: Buffer): Promise<Buffer> {
  return sanitizeSquareImage(buffer, 2 * 1024 * 1024);
}

/** Store the processed avatar directly in Cloudinary under deterministic user path. */
export async function saveAvatar(userId: number | string, webp: Buffer): Promise<string> {
  const result = await uploadToCloudinary(webp, {
    folder: `tixhub/users/${userId}/avatar`,
    publicId: String(userId),
    resourceType: 'image',
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

/** Best-effort cleanup (deterministic overwrite makes this optional/no-op). */
export async function deleteAvatar(_url: string | null): Promise<void> {
  // Deterministic in-place overwrite in Cloudinary avoids orphan accumulation.
}
