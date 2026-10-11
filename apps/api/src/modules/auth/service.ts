import { randomUUID } from 'node:crypto';
import {
  REFRESH_TOKEN_TTL_DAYS,
  type AuthResponse,
  type LoginRequest,
  type MeResponse,
  type PinLoginRequest,
  type PinUser,
  type SessionUser,
  loginRequestSchema,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { randomToken, sha256, verifyAgainstDummy, verifySecret } from '../../lib/crypto.js';
import { signAccessToken } from '../../lib/jwt.js';
import { writeAudit } from '../../lib/audit.js';
import * as accessRepo from './access-repo.js';
import * as repo from './repo.js';
import { verifyUserPin } from './pin.js';
import type { UserRow } from './repo.js';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/** An auth result plus the raw refresh token, which the controller puts in the cookie. */
export interface SessionResult {
  body: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Rotations within this window are treated as a benign race between tabs, not token theft. */
const ROTATION_GRACE_MS = 20_000;

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
const sessionExpired = (details: Record<string, unknown> = {}) =>
  new AppError(401, 'SESSION_EXPIRED', 'Your session has ended. Sign in again.', details);

async function buildSessionUser(user: UserRow): Promise<SessionUser> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    lang: user.lang,
    locations: await accessRepo.listLocationsForUser(user.id),
  };
}

async function issueSession(
  user: UserRow,
  deviceId: number | null,
  familyId: string,
  meta: RequestMeta,
): Promise<SessionResult> {
  const sessionUser = await buildSessionUser(user);
  if (sessionUser.locations.length === 0) {
    throw new AppError(403, 'LOCATION_FORBIDDEN', 'Your account is not linked to any location.');
  }
  const refreshToken = randomToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await repo.insertRefreshToken({
    userId: user.id,
    deviceId,
    familyId,
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const access = await signAccessToken({ userId: user.id, accountId: user.account_id, deviceId });
  return {
    body: {
      accessToken: access.token,
      expiresAt: access.expiresAt.toISOString(),
      user: sessionUser,
    },
    refreshToken,
    refreshExpiresAt,
  };
}

function isUsable(user: UserRow | undefined): user is UserRow {
  return Boolean(user && user.active);
}

export async function login(raw: LoginRequest, meta: RequestMeta): Promise<SessionResult> {
  const input = loginRequestSchema.parse(raw);
  const user = await repo.findUserByEmail(input.email);

  if (!isUsable(user) || !user.password_hash) {
    await verifyAgainstDummy(input.password);
    throw invalidCredentials();
  }
  if (!(await verifySecret(input.password, user.password_hash))) throw invalidCredentials();

  const deviceId = input.device ? await repo.upsertDevice(user.account_id, input.device) : null;
  const session = await issueSession(user, deviceId, randomUUID(), meta);
  await repo.touchLastLogin(user.id);
  return session;
}

/** Rotates the refresh token. Reusing an already-rotated token revokes the whole family. */
export async function refresh(rawToken: string | undefined, meta: RequestMeta) {
  if (!rawToken) throw sessionExpired();
  const tokenHash = sha256(rawToken);

  const outcome = await db.transaction(async (trx) => {
    const token = await repo.findRefreshTokenForUpdate(tokenHash, trx);
    if (!token) return { error: sessionExpired() };

    if (token.revoked_at) {
      const recentRotation =
        token.revoked_reason === 'rotated' &&
        Date.now() - token.revoked_at.getTime() < ROTATION_GRACE_MS;
      if (recentRotation) {
        // Another tab rotated this token a moment ago; its cookie is already updated.
        return { error: sessionExpired({ retry: true }) };
      }
      if (token.revoked_reason === 'rotated') {
        await repo.revokeFamily(token.family_id, 'reuse_detected', trx);
      }
      return { error: sessionExpired() };
    }
    if (token.expires_at.getTime() <= Date.now()) return { error: sessionExpired() };

    const user = await repo.findUserById(token.user_id, trx);
    if (!isUsable(user)) {
      await repo.revokeFamily(token.family_id, 'user_inactive', trx);
      return { error: sessionExpired() };
    }
    await repo.revokeRefreshToken(token.id, 'rotated', trx);
    return { token, user };
  });

  if ('error' in outcome) throw outcome.error;
  if (outcome.token.device_id) await repo.touchDevice(outcome.token.device_id);
  return issueSession(outcome.user, outcome.token.device_id, outcome.token.family_id, meta);
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const token = await repo.findRefreshToken(sha256(rawToken));
  if (token) await repo.revokeFamily(token.family_id, 'logout');
}

/** Finds the device session behind the refresh cookie, without rotating it. */
async function requireDeviceSession(rawToken: string | undefined) {
  if (!rawToken) throw sessionExpired();
  const token = await repo.findRefreshToken(sha256(rawToken));
  if (!token || token.revoked_at || token.expires_at.getTime() <= Date.now()) {
    throw sessionExpired();
  }
  const sessionUser = await repo.findUserById(token.user_id);
  if (!sessionUser) throw sessionExpired();
  return { token, accountId: sessionUser.account_id };
}

async function requireLocationInAccount(locationId: number, accountId: number) {
  const location = await db('locations')
    .where({ id: locationId, account_id: accountId })
    .whereNull('deleted_at')
    .first<{ id: number } | undefined>('id');
  if (!location) {
    throw new AppError(403, 'LOCATION_FORBIDDEN', 'This device cannot use that location.');
  }
}

/** Staff who can take over this device at a location (for the PIN switch screen). */
export async function listPinUsers(
  rawToken: string | undefined,
  locationId: number,
): Promise<PinUser[]> {
  const session = await requireDeviceSession(rawToken);
  await requireLocationInAccount(locationId, session.accountId);
  return repo.listPinUsers(locationId);
}

/** Switches the device session to another staff member after checking their PIN. */
export async function pinLogin(
  rawToken: string | undefined,
  input: PinLoginRequest,
  meta: RequestMeta,
): Promise<SessionResult> {
  const session = await requireDeviceSession(rawToken);
  await requireLocationInAccount(input.locationId, session.accountId);

  const target = await repo.findUserById(input.userId);
  const access = target ? await accessRepo.findLocationAccess(target.id, input.locationId) : null;
  if (!isUsable(target) || target.account_id !== session.accountId || !access) {
    throw new AppError(403, 'LOCATION_FORBIDDEN', 'This person does not work at this location.');
  }

  await verifyUserPin(target, input.pin);

  await repo.revokeRefreshToken(session.token.id, 'switched');
  const result = await issueSession(target, session.token.device_id, randomUUID(), meta);
  await repo.touchLastLogin(target.id);
  await writeAudit(
    {
      userId: target.id,
      accountId: target.account_id,
      locationId: input.locationId,
      deviceId: session.token.device_id,
      ip: meta.ip,
      requestId: meta.requestId,
    },
    { action: 'auth.pin_switch', entityType: 'user', entityId: target.id },
  );
  return result;
}

export async function me(
  userId: number,
  location: Express.Request['location'],
): Promise<MeResponse> {
  const user = await repo.findUserById(userId);
  if (!user) throw AppError.unauthenticated();
  return {
    user: await buildSessionUser(user),
    location: location
      ? {
          id: location.id,
          name: location.name,
          roleKey: location.roleKey,
          permissions: [...location.permissions].sort(),
        }
      : null,
  };
}
