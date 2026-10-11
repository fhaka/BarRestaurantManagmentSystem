import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env, REPO_ROOT } from '../config/env.js';

/**
 * Where uploaded files live. Only LocalFileStorage exists today; an S3/R2 implementation can
 * replace it without touching callers (plan §2).
 */
export interface FileStorage {
  /** Stores the file and returns its public URL. */
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  /** Removes a file by its public URL. Missing files are ignored. */
  removeByUrl(url: string): Promise<void>;
}

export const UPLOADS_PUBLIC_PATH = '/uploads';

export class LocalFileStorage implements FileStorage {
  constructor(
    readonly root: string,
    private readonly publicBase = UPLOADS_PUBLIC_PATH,
  ) {}

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`Storage key escapes the uploads folder: ${key}`);
    }
    return target;
  }

  async put(key: string, data: Buffer): Promise<string> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return `${this.publicBase}/${key.split(path.sep).join('/')}`;
  }

  async removeByUrl(url: string): Promise<void> {
    if (!url.startsWith(`${this.publicBase}/`)) return;
    await rm(this.resolve(url.slice(this.publicBase.length + 1)), { force: true });
  }
}

export const uploadsDir = env.UPLOADS_DIR ?? path.join(REPO_ROOT, 'apps', 'api', 'uploads');
export const storage: FileStorage = new LocalFileStorage(uploadsDir);
