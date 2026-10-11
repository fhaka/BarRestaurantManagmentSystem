import type { Knex } from 'knex';
import type { Lang, RoleKey, StaffMember } from '@tavolina/shared';
import { db as defaultDb } from '../../db/knex.js';

interface StaffRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role_key: RoleKey;
  lang: Lang;
  active: number | boolean;
  has_password: number;
  has_pin: number;
  pin_locked_until: Date | null;
  last_login_at: Date | null;
}

function toStaffMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    roleKey: row.role_key,
    lang: row.lang,
    active: Boolean(row.active),
    hasPassword: Boolean(row.has_password),
    hasPin: Boolean(row.has_pin),
    pinLocked: row.pin_locked_until !== null && row.pin_locked_until.getTime() > Date.now(),
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  };
}

function staffQuery(db: Knex, locationId: number) {
  return db('user_locations as ul')
    .join('users as u', 'u.id', 'ul.user_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .where('ul.location_id', locationId)
    .whereNull('u.deleted_at')
    .select(
      'u.id',
      'u.name',
      'u.email',
      'u.phone',
      'r.key as role_key',
      'u.lang',
      'u.active',
      db.raw('u.password_hash IS NOT NULL as has_password'),
      db.raw('u.pin_hash IS NOT NULL as has_pin'),
      'u.pin_locked_until',
      'u.last_login_at',
    );
}

export async function listStaff(locationId: number, db: Knex = defaultDb): Promise<StaffMember[]> {
  const rows = (await staffQuery(db, locationId).orderBy([
    { column: 'u.active', order: 'desc' },
    { column: 'r.rank', order: 'desc' },
    { column: 'u.name', order: 'asc' },
  ])) as StaffRow[];
  return rows.map(toStaffMember);
}

export async function findStaffMember(
  locationId: number,
  userId: number,
  db: Knex = defaultDb,
): Promise<StaffMember | undefined> {
  const row = (await staffQuery(db, locationId).where('u.id', userId).first()) as
    StaffRow | undefined;
  return row ? toStaffMember(row) : undefined;
}

export async function emailTaken(email: string, exceptUserId?: number, db: Knex = defaultDb) {
  const query = db('users').where({ email });
  if (exceptUserId) query.whereNot({ id: exceptUserId });
  return Boolean(await query.first('id'));
}

export async function insertUser(
  row: {
    accountId: number;
    name: string;
    email: string | null;
    phone: string | null;
    lang: Lang;
    passwordHash: string | null;
    pinHash: string | null;
  },
  db: Knex = defaultDb,
): Promise<number> {
  const [id] = await db('users').insert({
    account_id: row.accountId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    lang: row.lang,
    password_hash: row.passwordHash,
    pin_hash: row.pinHash,
  });
  if (!id) throw new Error('User insert returned no id');
  return id;
}

export async function updateUser(
  userId: number,
  patch: Record<string, unknown>,
  db: Knex = defaultDb,
) {
  if (Object.keys(patch).length) await db('users').where({ id: userId }).update(patch);
}

export async function setLocationRole(
  userId: number,
  locationId: number,
  roleId: number,
  db: Knex = defaultDb,
) {
  await db('user_locations')
    .insert({ user_id: userId, location_id: locationId, role_id: roleId })
    .onConflict(['user_id', 'location_id'])
    .merge(['role_id']);
}
