import { uploadToCloudinary, deleteFromCloudinary } from '../../services/cloudinary.js';
import { sanitizeBannerImage, validateVideoTrailer } from './sanitizer.js';

export async function uploadEventBanner(eventId: string | number, buffer: Buffer): Promise<string> {
  const sanitized = await sanitizeBannerImage(buffer);
  const result = await uploadToCloudinary(sanitized, {
    folder: `tixhub/events/${eventId}/banner`,
    publicId: String(eventId),
    resourceType: 'image',
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

export async function uploadEventTrailer(eventId: string | number, buffer: Buffer): Promise<string> {
  validateVideoTrailer(buffer);
  const result = await uploadToCloudinary(buffer, {
    folder: `tixhub/events/${eventId}/trailer`,
    publicId: String(eventId),
    resourceType: 'video',
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

export async function deleteEventTrailer(eventId: string | number): Promise<void> {
  await deleteFromCloudinary(`tixhub/events/${eventId}/trailer/${eventId}`, 'video');
}
