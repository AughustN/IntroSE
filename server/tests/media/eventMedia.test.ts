import { describe, it, expect } from 'vitest';
import { uploadEventBanner, uploadEventTrailer, deleteEventTrailer } from '../../src/modules/media/eventMedia.js';
import { sanitizeBannerImage, validateVideoTrailer, MediaRejected } from '../../src/modules/media/sanitizer.js';

describe('Event Media Processing & Cloudinary Upload Pipeline', () => {
  // Minimal valid 1x1 WebP buffer
  const validWebpBuffer = Buffer.from(
    'UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v5wAAD+/nAAD+/nAAD+/nAAD+/nAAD+/nAAD+/nAAA=',
    'base64',
  );

  // Minimal valid 1x1 PNG buffer
  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  // Minimal valid MP4 header buffer
  const validMp4Buffer = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypmp42', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('mp42isom', 'ascii'),
  ]);

  it('sanitizes valid PNG banner and re-encodes to WebP', async () => {
    const processed = await sanitizeBannerImage(validPngBuffer);
    expect(processed).toBeInstanceOf(Buffer);
    expect(processed.toString('ascii', 0, 4)).toBe('RIFF');
    expect(processed.toString('ascii', 8, 12)).toBe('WEBP');
  });

  it('rejects invalid image payload for event banner', async () => {
    const invalidBuffer = Buffer.from('NOT_AN_IMAGE_CONTENT_HERE');
    await expect(sanitizeBannerImage(invalidBuffer)).rejects.toThrow();
  });

  it('rejects oversized banner image (> 5MB)', async () => {
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
    await expect(sanitizeBannerImage(largeBuffer)).rejects.toThrow();
  });

  it('validates video container format for trailer', () => {
    const result = validateVideoTrailer(validMp4Buffer);
    expect(result.format).toBe('mp4');
  });

  it('rejects invalid video format', () => {
    const invalidVideo = Buffer.from('NOT_A_VIDEO_STREAM');
    expect(() => validateVideoTrailer(invalidVideo)).toThrow(MediaRejected);
  });

  it('uploads event banner and generates deterministic Cloudinary URL', async () => {
    const bannerUrl = await uploadEventBanner(12345, validPngBuffer);
    expect(bannerUrl).toContain('tixhub/events/12345/banner');
  });

  it('uploads event trailer and generates deterministic Cloudinary URL', async () => {
    const trailerUrl = await uploadEventTrailer(12345, validMp4Buffer);
    expect(trailerUrl).toContain('tixhub/events/12345/trailer');
  });

  it('deletes event trailer cleanly without throwing', async () => {
    await expect(deleteEventTrailer(12345)).resolves.not.toThrow();
  });
});
