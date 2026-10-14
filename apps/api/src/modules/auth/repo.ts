import type { Knex } from 'knex';
import type { DeviceType, Lang, PinUser, RoleKey } from '@tavolina/shared';
import { db as defaultDb } from '../../db/knex.js';

export interface UserRow {
  id: number;
  account_id: number;
  name: string;
  email: string | null;
  password_hash: string | null;
  pin_hash: string | null;
  active: number | boolean;
  lang: Lang;
  pin_failed_attempts: number;
  pin_locked_until: Date | null;
}

const USER_COLUMNS = [
  'id',
  'account_id',
  'name',
  'email',
  'password_hash',
  'pin_hash',
  'active',
  'lang',
  'pin_failed_attempts',
  'pin_locked_until',
] as const;

export function findUserByEmail(email: string, db: Knex = defaultDb) {
  return db('users')
    .where({ email })
    .whereNull('deleted_at')
    .first<UserRow | undefined>(...USER_COLUMNS);
}

export function findUserById(id: number, db: Knex = defaultDb) {
  return db('users')
    .where({ id })
    .whereNull('deleted_at')
    .first<UserRow | undefined>(...USER_COLUMNS);
}

export async function touchLastLogin(userId: number, db: Knex = defaultDb) {
  await db('users')
    .where({ id: userId })
    .update({ last_login_at: db.fn.now(3) });
}

/** Increments the failure counter atomically and returns the new count. */
export async function incrementPinFailures(userId: number, db: Knex = defaultDb): Promise<number> {
  await db('users').where({ id: userId }).increment('pin_failed_attempts', 1);
  const row = await db('users')
    .where({ id: userId })
    .first<{ pin_failed_attempts: number }>('pin_failed_attempts');
  return row.pin_failed_attempts;
}

export async function lockPin(userId: number, until: Date, db: Knex = defaultDb) {
  await db('users')
    .where({ id: userId })
    .update({ pin_failed_attempts: 0, pin_locked_until: until });
}

export async function resetPinFailures(userId: number, db: Knex = defaultDb) {
  await db('users')
    .where({ id: userId })
    .update({ pin_failed_attempts: 0, pin_locked_until: null });
}

// ---- Devices -------------------------------------------------------------------------------

export async function upsertDevice(
  accountId: number,
  device: { uuid: string; name: string; type: DeviceType },
  db: Knex = defaultDb,
): Promise<number | null> {
  const existing = await db('devices')
    .where({ uuid: device.uuid })
    .first<{ id: number; account_id: number; revoked_at: Date | null } | undefined>(
      'id',
      'account_id',
      'revoked_at',
    );
  if (existing) {
    // A uuid that belongs to another account, or a revoked device, is never reused.
    if (existing.account_id !== accountId || existing.revoked_at) return null;
    await db('devices')
      .where({ id: existing.id })
      .update({ name: device.name, type: device.type, last_seen_at: db.fn.now(3) });
    return existing.id;
  }
  const [id] = await db('devices').insert({
    uuid: device.uuid,
    account_id: accountId,
    name: device.name,
    type: device.type,
    last_seen_at: db.fn.now(3),
  });
  return id ?? null;
}

export async function touchDevice(deviceId: number, db: Knex = defaultDb) {
  await db('devices')
    .where({ id: deviceId })
    .update({ last_seen_at: db.fn.now(3) });
}

// ---- Refresh tokens ------------------------------------------------------------------------

export interface RefreshTokenRow {
  id: number;
  user_id: number;
  device_id: number | null;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

export async function insertRefreshToken(
  row: {
    userId: number;
    deviceId: number | null;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
  db: Knex = defaultDb,
) {
  await db('refresh_tokens').insert({
    user_id: row.userId,
    device_id: row.deviceId,
    family_id: row.familyId,
    token_hash: row.tokenHash,
    expires_at: row.expiresAt,
    ip: row.ip,
    user_agent: row.userAgent?.slice(0, 255) ?? null,
  });
}

/** Locks the row (FOR UPDATE) so concurrent refreshes of one token serialize. */
export function findRefreshTokenForUpdate(tokenHash: string, trx: Knex.Transaction) {
  return trx('refresh_tokens')
    .where({ token_hash: tokenHash })
    .forUpdate()
    .first<RefreshTokenRow | undefined>(
      'id',
      'user_id',
      'device_id',
      'family_id',
      'expires_at',
      'revoked_at',
      'revoked_reason',
    );
}

export function findRefreshToken(tokenHash: string, db: Knex = defaultDb) {
  return db('refresh_tokens')
    .where({ token_hash: tokenHash })
    .first<RefreshTokenRow | undefined>(
      'id',
      'user_id',
      'device_id',
      'family_id',
      'expires_at',
      'revoked_at',
      'revoked_reason',
    );
}

export async function revokeRefreshToken(id: number, reason: string, db: Knex = defaultDb) {
  await db('refresh_tokens')
    .where({ id })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(3), revoked_reason: reason });
}

export async function revokeFamily(familyId: string, reason: string, db: Knex = defaultDb) {
  await db('refresh_tokens')
    .where({ family_id: familyId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(3), revoked_reason: reason });
}

export async function revokeAllForUser(userId: number, reason: string, db: Knex = defaultDb) {
  await db('refresh_tokens')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(3), revoked_reason: reason });
}

// ---- PIN switch ----------------------------------------------------------------------------

export async function listPinUsers(locationId: number, db: Knex = defaultDb): Promise<PinUser[]> {
  const rows = await db('user_locations as ul')
    .join('users as u', 'u.id', 'ul.user_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .where({ 'ul.location_id': locationId, 'u.active': true })
    .whereNull('u.deleted_at')
    .whereNotNull('u.pin_hash')
    .orderBy([
      { column: 'r.rank', order: 'desc' },
      { column: 'u.name', order: 'asc' },
    ])
    .select<{ id: number; name: string; role_key: RoleKey; pin_locked_until: Date | null }[]>(
      'u.id',
      'u.name',
      'r.key as role_key',
      'u.pin_locked_until',
    );
  const now = Date.now();
  // Who is clocked in here right now (plan §5.8), for the clock-in screen.
  const clockedIn = new Set(
    (
      await db('time_entries')
        .where({ location_id: locationId })
        .whereNull('clock_out')
        .select('user_id')
    ).map((r) => Number(r.user_id)),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    roleKey: r.role_key,
    locked: r.pin_locked_until !== null && r.pin_locked_until.getTime() > now,
    clockedIn: clockedIn.has(Number(r.id)),
  }));
}
