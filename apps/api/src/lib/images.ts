import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from './errors.js';
import { storage } from './storage.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'gif']);

const invalidImage = () =>
  new AppError(400, 'INVALID_IMAGE', 'Upload a JPEG, PNG or WebP photo up to 5 MB.');

/** Large image and its card thumbnail share a name: x.webp and x-thumb.webp. */
export function thumbUrlFor(imageUrl: string | null): string | null {
  return imageUrl ? imageUrl.replace(/\.webp$/, '-thumb.webp') : null;
}

/**
 * Checks the real file type (not the name or MIME header), fixes orientation, strips metadata
 * (EXIF/GPS) and re-encodes to WebP: up to 1200 px, plus a 480×360 cover thumbnail.
 * Returns the public URL of the large image.
 */
export async function storeMenuImage(input: Buffer, folder: string): Promise<string> {
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw invalidImage();
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw invalidImage();

  let full: Buffer;
  let thumb: Buffer;
  try {
    const base = sharp(input, { failOn: 'error', animated: false }).rotate();
    [full, thumb] = await Promise.all([
      base
        .clone()
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
      base
        .clone()
        .resize({ width: 480, height: 360, fit: 'cover', position: 'attention' })
        .webp({ quality: 78 })
        .toBuffer(),
    ]);
  } catch {
    throw invalidImage();
  }

  const name = randomUUID();
  const url = await storage.put(`${folder}/${name}.webp`, full, 'image/webp');
  await storage.put(`${folder}/${name}-thumb.webp`, thumb, 'image/webp');
  return url;
}

export async function removeMenuImage(imageUrl: string | null): Promise<void> {
  if (!imageUrl) return;
  await Promise.all([
    storage.removeByUrl(imageUrl),
    storage.removeByUrl(thumbUrlFor(imageUrl)!),
  ]).catch(() => undefined);
}
