import { describe, it, expect } from 'vitest';
import { sanitizeSquareImage, MediaRejected } from '../../src/modules/media/sanitizer.js';
import { uploadToCloudinary } from '../../src/services/cloudinary.js';

describe('Organizer Logo Upload & Sanitization Pipeline', () => {
  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('sanitizes square logo image into WebP format', async () => {
    const processed = await sanitizeSquareImage(validPngBuffer, 2 * 1024 * 1024);
    expect(processed).toBeInstanceOf(Buffer);
    expect(processed.toString('ascii', 0, 4)).toBe('RIFF');
    expect(processed.toString('ascii', 8, 12)).toBe('WEBP');
  });

  it('rejects oversized logo image (> 2MB)', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024);
    await expect(sanitizeSquareImage(big, 2 * 1024 * 1024)).rejects.toThrow(MediaRejected);
  });

  it('uploads logo buffer to deterministic Cloudinary organizer folder', async () => {
    const result = await uploadToCloudinary(validPngBuffer, {
      folder: 'tixhub/organizers/999/logo',
      publicId: '999',
      resourceType: 'image',
    });
    expect(result.secure_url).toContain('tixhub/organizers/999/logo');
  });
});
