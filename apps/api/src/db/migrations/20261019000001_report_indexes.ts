import type { Knex } from 'knex';

/**
 * Phase 10 performance pass: indexes for the queries the dashboard, reports and audit viewer run
 * that had to scan a location's rows (found with scripts/query-profile.ts and EXPLAIN).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('table_sessions', (t) => {
    t.index(['location_id', 'opened_at']); // today's covers
  });
  await knex.schema.alterTable('refunds', (t) => {
    t.index(['business_date']); // refunds in a report range
  });
  await knex.schema.alterTable('audit_logs', (t) => {
    t.index(['account_id', 'action']); // audit viewer: filter by action
    t.index(['user_id', 'created_at']); // audit viewer: filter by person
  });
}

export async function down(knex: Knex): Promise<void> {
  // The foreign keys may now rely on the composite indexes; give them their own first.
  const [existing] = (await knex.raw('SHOW INDEX FROM audit_logs')) as [{ Key_name: string }[]];
  const has = (name: string) => existing.some((i) => i.Key_name === name);
  await knex.schema.alterTable('audit_logs', (t) => {
    if (!has('audit_logs_user_id_fk_index')) t.index(['user_id'], 'audit_logs_user_id_fk_index');
    if (!has('audit_logs_account_id_fk_index')) {
      t.index(['account_id'], 'audit_logs_account_id_fk_index');
    }
  });
  await knex.schema.alterTable('audit_logs', (t) => {
    t.dropIndex(['user_id', 'created_at']);
    t.dropIndex(['account_id', 'action']);
  });
  await knex.schema.alterTable('refunds', (t) => {
    t.dropIndex(['business_date']);
  });
  await knex.schema.alterTable('table_sessions', (t) => {
    t.dropIndex(['location_id', 'opened_at']);
  });
}
