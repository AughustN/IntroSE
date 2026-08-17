import { uploadToCloudinary, deleteFromCloudinary } from '../../services/cloudinary.js';
import { sanitizeVenuePlan, MediaRejected } from '../media/sanitizer.js';

export class ImageRejected extends Error {
  constructor(public reason: 'invalid_image' | 'image_too_large') {
    super(reason);
  }
}

/**
 * Validate and re-encode an uploaded floor plan to a clean webp (strips EXIF and any embedded
 * payload, ADR 0004).
 */
export async function processFloorPlan(buffer: Buffer): Promise<Buffer> {
  try {
    return await sanitizeVenuePlan(buffer);
  } catch (e) {
    if (e instanceof MediaRejected) {
      throw new ImageRejected(e.reason === 'image_too_large' ? 'image_too_large' : 'invalid_image');
    }
    throw e;
  }
}

/** Store the processed plan directly in Cloudinary under deterministic layout folder. */
export async function saveFloorPlan(layoutId: number, webp: Buffer, type: 'floorplan' | 'reference' = 'floorplan'): Promise<string> {
  const result = await uploadToCloudinary(webp, {
    folder: `tixhub/layouts/${layoutId}/${type}`,
    publicId: String(layoutId),
    resourceType: 'image',
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

/** Best-effort delete of a previously-uploaded plan from Cloudinary. */
export async function deleteFloorPlan(url: string | null): Promise<void> {
  if (!url) return;
  if (url.includes('cloudinary.com')) {
    await deleteFromCloudinary(url, 'image').catch(() => {});
  }
}
