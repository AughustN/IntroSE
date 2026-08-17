import { uploadToCloudinary, deleteFromCloudinary } from '../../services/cloudinary.js';
import { sanitizeVenuePlan } from './sanitizer.js';

export async function uploadFloorPlan(layoutId: number, buffer: Buffer): Promise<string> {
  const sanitized = await sanitizeVenuePlan(buffer);
  const result = await uploadToCloudinary(sanitized, {
    folder: `tixhub/layouts/${layoutId}/floorplan`,
    publicId: String(layoutId),
    resourceType: 'image',
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

export async function uploadReferenceChart(layoutId: number, buffer: Buffer): Promise<string> {
  const sanitized = await sanitizeVenuePlan(buffer);
  const result = await uploadToCloudinary(sanitized, {
    folder: `tixhub/layouts/${layoutId}/reference`,
    publicId: String(layoutId),
    resourceType: 'image',
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

export async function deleteLayoutMedia(url: string | null): Promise<void> {
  if (!url) return;
  if (url.includes('cloudinary.com')) {
    await deleteFromCloudinary(url, 'image').catch(() => {});
  }
}
