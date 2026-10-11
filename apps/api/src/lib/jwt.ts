import { SignJWT, jwtVerify, errors } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from '@tavolina/shared';
import { env } from '../config/env.js';

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = 'tavolina';
const AUDIENCE = 'tavolina-staff';

export interface AccessClaims {
  userId: number;
  accountId: number;
  deviceId: number | null;
}

export async function signAccessToken(
  claims: AccessClaims,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({ acc: claims.accountId, dev: claims.deviceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(claims.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
  return { token, expiresAt };
}

export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; expired: boolean };

export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const userId = Number(payload.sub);
    const accountId = Number(payload.acc);
    if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(accountId)) {
      return { ok: false, expired: false };
    }
    const deviceId = typeof payload.dev === 'number' ? payload.dev : null;
    return { ok: true, claims: { userId, accountId, deviceId } };
  } catch (err) {
    return { ok: false, expired: err instanceof errors.JWTExpired };
  }
}
