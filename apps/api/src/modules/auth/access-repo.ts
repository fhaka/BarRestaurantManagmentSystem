import type { Knex } from 'knex';
import type { LocationAccess, Permission, RoleKey } from '@tavolina/shared';
import { db as defaultDb } from '../../db/knex.js';

export interface ActiveUser {
  id: number;
  accountId: number;
  name: string;
}

export async function findActiveUser(
  userId: number,
  db: Knex = defaultDb,
): Promise<ActiveUser | undefined> {
  const row = await db('users')
    .where({ id: userId, active: true })
    .whereNull('deleted_at')
    .first<{ id: number; account_id: number; name: string } | undefined>(
      'id',
      'account_id',
      'name',
    );
  return row ? { id: row.id, accountId: row.account_id, name: row.name } : undefined;
}

export interface LocationAccessRow {
  accountId: number;
  locationName: string;
  roleId: number;
  roleKey: RoleKey;
}

export async function findLocationAccess(
  userId: number,
  locationId: number,
  db: Knex = defaultDb,
): Promise<LocationAccessRow | undefined> {
  const row = await db('user_locations as ul')
    .join('locations as l', 'l.id', 'ul.location_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .where({ 'ul.user_id': userId, 'ul.location_id': locationId })
    .whereNull('l.deleted_at')
    .first<{ account_id: number; name: string; role_id: number; role_key: RoleKey } | undefined>(
      'l.account_id',
      'l.name',
      'r.id as role_id',
      'r.key as role_key',
    );
  return row
    ? {
        accountId: row.account_id,
        locationName: row.name,
        roleId: row.role_id,
        roleKey: row.role_key,
      }
    : undefined;
}

export async function listLocationsForUser(
  userId: number,
  db: Knex = defaultDb,
): Promise<LocationAccess[]> {
  const rows = await db('user_locations as ul')
    .join('locations as l', 'l.id', 'ul.location_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .where('ul.user_id', userId)
    .whereNull('l.deleted_at')
    .orderBy('l.name')
    .select<{ id: number; name: string; role_key: RoleKey }[]>(
      'l.id',
      'l.name',
      'r.key as role_key',
    );
  return rows.map((r) => ({ id: r.id, name: r.name, roleKey: r.role_key }));
}

// Role permissions change only when the API is redeployed (D-016), so a short cache is safe.
const CACHE_TTL_MS = 60_000;
const permissionCache = new Map<number, { at: number; permissions: Set<Permission> }>();

export async function getRolePermissions(
  roleId: number,
  db: Knex = defaultDb,
): Promise<ReadonlySet<Permission>> {
  const cached = permissionCache.get(roleId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.permissions;
  const rows = await db('role_permissions as rp')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('rp.role_id', roleId)
    .select<{ key: Permission }[]>('p.key');
  const permissions = new Set(rows.map((r) => r.key));
  permissionCache.set(roleId, { at: Date.now(), permissions });
  return permissions;
}

export function clearPermissionCache(): void {
  permissionCache.clear();
}

export async function findRoleId(roleKey: RoleKey, db: Knex = defaultDb): Promise<number> {
  const row = await db('roles').where({ key: roleKey }).first<{ id: number } | undefined>('id');
  if (!row) throw new Error(`Role "${roleKey}" is missing; run npm run db:migrate`);
  return row.id;
}
