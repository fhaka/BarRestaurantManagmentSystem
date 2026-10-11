import type { Knex } from 'knex';
import {
  ALLERGENS,
  DIETARY_TAGS,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ROLE_RANK,
} from '@tavolina/shared';

const ROLE_NAMES: Record<(typeof ROLE_KEYS)[number], string> = {
  owner: 'Owner',
  manager: 'Manager',
  waiter: 'Waiter',
  cashier: 'Cashier',
  kitchen: 'Kitchen / Bar',
};

/**
 * Makes the roles, permissions and role_permissions tables match the defaults in
 * @tavolina/shared. Idempotent; runs after migrations and at API start-up (D-016).
 */
export async function syncRolesAndPermissions(db: Knex): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('roles')
      .insert(ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key], rank: ROLE_RANK[key] })))
      .onConflict('key')
      .merge(['name', 'rank']);
    await trx('permissions')
      .insert(PERMISSIONS.map((key) => ({ key })))
      .onConflict('key')
      .ignore();
    await trx('permissions')
      .whereNotIn('key', [...PERMISSIONS])
      .delete();

    const roles = await trx('roles').select<{ id: number; key: string }[]>('id', 'key');
    const perms = await trx('permissions').select<{ id: number; key: string }[]>('id', 'key');
    const permId = new Map(perms.map((p) => [p.key, p.id]));

    const rows = roles.flatMap((role) =>
      (ROLE_PERMISSIONS[role.key as (typeof ROLE_KEYS)[number]] ?? []).map((key) => ({
        role_id: role.id,
        permission_id: permId.get(key)!,
      })),
    );
    await trx('role_permissions').delete();
    if (rows.length) await trx('role_permissions').insert(rows);
  });
}

/** Allergen and dietary-tag reference lists (keys only; labels are translated in the apps). */
export async function syncMenuReference(db: Knex): Promise<void> {
  await db('allergens')
    .insert(ALLERGENS.map((key, sort) => ({ key, sort })))
    .onConflict('key')
    .merge(['sort']);
  await db('dietary_tags')
    .insert(DIETARY_TAGS.map((key, sort) => ({ key, sort })))
    .onConflict('key')
    .merge(['sort']);
}

/** Everything that is defined in code and mirrored in the database. */
export async function syncReferenceData(db: Knex): Promise<void> {
  await syncRolesAndPermissions(db);
  await syncMenuReference(db);
}
