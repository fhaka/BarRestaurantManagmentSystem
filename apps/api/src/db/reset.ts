import type { Knex } from 'knex';

/** Reference tables that are synced from code and must survive a data reset. */
const KEEP = new Set([
  'knex_migrations',
  'knex_migrations_lock',
  'roles',
  'permissions',
  'role_permissions',
  'allergens',
  'dietary_tags',
]);

/**
 * Empties every application table. Development seeds and tests only — refuses in production.
 * `mode: 'delete'` is much faster on small tables but keeps auto-increment counters (fine for tests).
 */
export async function truncateAppTables(
  knex: Knex,
  { mode = 'truncate' }: { mode?: 'truncate' | 'delete' } = {},
): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to truncate tables in production');
  }
  const [rows] = (await knex.raw(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = ?',
    ['BASE TABLE'],
  )) as [{ name: string }[]];
  const tables = rows.map((r) => r.name).filter((name) => !KEEP.has(name));

  // FOREIGN_KEY_CHECKS is per connection, so run everything on one connection.
  await knex.transaction(async (trx) => {
    await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await trx.raw(mode === 'truncate' ? 'TRUNCATE TABLE ??' : 'DELETE FROM ??', [table]);
    }
    await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
  });
}
