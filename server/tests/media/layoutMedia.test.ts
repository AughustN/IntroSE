import { describe, it, expect } from 'vitest';
import { sanitizeVenuePlan, MediaRejected } from '../../src/modules/media/sanitizer.js';
import { uploadToCloudinary } from '../../src/services/cloudinary.js';

describe('Layout Media Pipeline (Floor Plan & Reference Chart)', () => {
  const validPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('sanitizes raster floor plan to WebP', async () => {
    const webp = await sanitizeVenuePlan(validPng);
    expect(webp).toBeInstanceOf(Buffer);
    expect(webp.toString('ascii', 0, 4)).toBe('RIFF');
    expect(webp.toString('ascii', 8, 12)).toBe('WEBP');
  });

  it('rejects malicious SVG with external script references', async () => {
    const maliciousSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(sanitizeVenuePlan(maliciousSvg)).rejects.toThrow(MediaRejected);
  });

  it('rejects SVG with XXE entity injection', async () => {
    const xxeSvg = Buffer.from('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>');
    await expect(sanitizeVenuePlan(xxeSvg)).rejects.toThrow(MediaRejected);
  });

  it('uploads floorplan to deterministic Cloudinary layout folder', async () => {
    const result = await uploadToCloudinary(validPng, {
      folder: 'tixhub/layouts/42/floorplan',
      publicId: '42',
      resourceType: 'image',
    });
    expect(result.secure_url).toContain('tixhub/layouts/42/floorplan');
  });

  it('uploads reference chart to deterministic Cloudinary layout folder', async () => {
    const result = await uploadToCloudinary(validPng, {
      folder: 'tixhub/layouts/42/reference',
      publicId: '42',
      resourceType: 'image',
    });
    expect(result.secure_url).toContain('tixhub/layouts/42/reference');
  });
});
