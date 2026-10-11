import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/** URL-safe random token, e.g. for refresh and approval tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored as SHA-256 hashes; they are high-entropy so no salt is needed. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** bcrypt for passwords and PINs (plan §11: cost 12). */
export function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, env.BCRYPT_COST);
}

export function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

// Compared against when a user does not exist, so response time does not reveal valid emails.
let dummyHash: Promise<string> | undefined;
export function verifyAgainstDummy(secret: string): Promise<boolean> {
  dummyHash ??= bcrypt.hash('tavolina-dummy-password', env.BCRYPT_COST);
  return dummyHash.then((h) => bcrypt.compare(secret, h)).then(() => false);
}
