import type { Knex } from 'knex';
import { normalizeLocationSettings, type Location, type LocationSettings } from '@tavolina/shared';
import { db as defaultDb } from '../../db/knex.js';

interface LocationRow {
  id: number;
  account_id: number;
  name: string;
  address: string;
  nipt: string | null;
  timezone: string;
  currency: string;
  settings: unknown;
}

function toLocation(row: LocationRow): Location {
  // mysql2 returns JSON columns parsed; be tolerant of strings too.
  const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    address: row.address,
    nipt: row.nipt,
    timezone: row.timezone,
    currency: row.currency,
    settings: normalizeLocationSettings(settings),
  };
}

export async function findLocation(
  id: number,
  db: Knex = defaultDb,
): Promise<Location | undefined> {
  const row = await db('locations')
    .where({ id })
    .whereNull('deleted_at')
    .first<LocationRow | undefined>();
  return row ? toLocation(row) : undefined;
}

export async function insertLocation(
  row: {
    accountId: number;
    name: string;
    address: string;
    nipt: string | null;
    settings: LocationSettings;
  },
  db: Knex = defaultDb,
): Promise<number> {
  const [id] = await db('locations').insert({
    account_id: row.accountId,
    name: row.name,
    address: row.address,
    nipt: row.nipt,
    settings: JSON.stringify(row.settings),
  });
  if (!id) throw new Error('Location insert returned no id');
  return id;
}

export async function updateLocation(
  id: number,
  patch: Partial<{
    name: string;
    address: string;
    nipt: string | null;
    settings: LocationSettings;
  }>,
  db: Knex = defaultDb,
) {
  const { settings, ...rest } = patch;
  await db('locations')
    .where({ id })
    .update({ ...rest, ...(settings ? { settings: JSON.stringify(settings) } : {}) });
}

/** Users who are owner at any location of the account; they get access to new locations. */
export async function listAccountOwnerIds(accountId: number, db: Knex = defaultDb) {
  const rows = await db('user_locations as ul')
    .join('locations as l', 'l.id', 'ul.location_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .join('users as u', 'u.id', 'ul.user_id')
    .where({ 'l.account_id': accountId, 'r.key': 'owner' })
    .whereNull('u.deleted_at')
    .distinct<{ user_id: number }[]>('ul.user_id');
  return rows.map((r) => r.user_id);
}

export async function grantAccess(
  userIds: number[],
  locationId: number,
  roleId: number,
  db: Knex = defaultDb,
) {
  if (!userIds.length) return;
  await db('user_locations')
    .insert(
      userIds.map((userId) => ({ user_id: userId, location_id: locationId, role_id: roleId })),
    )
    .onConflict(['user_id', 'location_id'])
    .ignore();
}
