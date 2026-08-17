import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export interface CloudinaryUploadOptions {
  folder: string;
  publicId: string;
  resourceType?: 'image' | 'video' | 'raw' | 'auto';
  overwrite?: boolean;
  invalidate?: boolean;
}

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  url: string;
  format?: string;
  bytes?: number;
}

export interface CloudinaryDeleteResult {
  result: 'ok' | 'not found' | string;
}

export function getCloudinaryConfig() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  };
}

export function isCloudinaryConfigured(): boolean {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  return Boolean(cloudName && apiKey && apiSecret);
}

/**
 * Generate SHA-1 signature for Cloudinary API request based on sorted parameters.
 */
function generateSignature(params: Record<string, string | number | boolean>, apiSecret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map((key) => `${key}=${params[key]}`).join('&');
  return createHash('sha1')
    .update(serialized + apiSecret)
    .digest('hex');
}

/**
 * Upload a media buffer directly to Cloudinary using HTTPS REST API.
 * In development/test with no Cloudinary credentials, returns a mock CDN URL cleanly.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  options: CloudinaryUploadOptions,
): Promise<CloudinaryUploadResult> {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const resourceType = options.resourceType || 'image';
  const folder = options.folder.replace(/^\/+|\/+$/g, '');
  const publicId = options.publicId;
  const overwrite = options.overwrite !== false;
  const invalidate = options.invalidate !== false;

  if (!isCloudinaryConfigured()) {
    // Graceful offline / test fallback
    const ext = resourceType === 'video' ? 'mp4' : 'webp';
    const mockUrl = `https://res.cloudinary.com/${cloudName || 'tixhub'}/${resourceType}/upload/v1723900000/${folder}/${publicId}.${ext}`;
    return {
      public_id: `${folder}/${publicId}`,
      secure_url: mockUrl,
      url: mockUrl,
      bytes: buffer.length,
      format: ext,
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signParams: Record<string, string | number | boolean> = {
    folder,
    invalidate: invalidate ? 1 : 0,
    overwrite: overwrite ? 1 : 0,
    public_id: publicId,
    timestamp,
  };

  const signature = generateSignature(signParams, apiSecret);

  const formData = new FormData();
  const blob = new Blob([buffer]);
  formData.append('file', blob, `${publicId}`);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);
  formData.append('folder', folder);
  formData.append('public_id', publicId);
  formData.append('overwrite', overwrite ? 'true' : 'false');
  formData.append('invalidate', invalidate ? 'true' : 'false');

  const uploadEndpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Upload failed');
    throw new Error(`Cloudinary upload failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    public_id: string;
    secure_url: string;
    url: string;
    format?: string;
    bytes?: number;
  };

  return {
    public_id: data.public_id,
    secure_url: data.secure_url,
    url: data.url,
    format: data.format,
    bytes: data.bytes,
  };
}

/**
 * Delete a media asset from Cloudinary by public ID.
 */
export async function deleteFromCloudinary(
  fullPublicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image',
): Promise<CloudinaryDeleteResult> {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();

  if (!isCloudinaryConfigured() || !fullPublicId) {
    return { result: 'ok' };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signParams: Record<string, string | number | boolean> = {
    public_id: fullPublicId,
    timestamp,
  };

  const signature = generateSignature(signParams, apiSecret);

  const formData = new FormData();
  formData.append('public_id', fullPublicId);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);

  const destroyEndpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`;

  const response = await fetch(destroyEndpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    return { result: 'not found' };
  }

  const data = (await response.json()) as CloudinaryDeleteResult;
  return data;
}
