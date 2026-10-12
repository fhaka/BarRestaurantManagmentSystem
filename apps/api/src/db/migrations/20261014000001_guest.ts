import type { Knex } from 'knex';
import { fk } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  // Guests can open a free table by ordering from the QR menu; nobody has taken it yet.
  await knex.schema.alterTable('table_sessions', (t) => {
    t.bigInteger('waiter_id').unsigned().nullable().alter();
  });
  await knex.schema.alterTable('orders', (t) => {
    t.bigInteger('opened_by').unsigned().nullable().alter();
  });

  // One per phone per table visit. The phone holds a random token in a cookie; we keep its hash.
  await knex.schema.createTable('guest_sessions', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'table_id', 'tables.id').notNullable();
    // Set once the table has a session; a phone from a previous party never joins the next one.
    fk(t, 'table_session_id', 'table_sessions.id').nullable();
    t.string('token_hash', 64).notNullable().unique();
    t.string('lang', 5).nullable();
    t.boolean('blocked').notNullable().defaultTo(false);
    fk(t, 'blocked_by', 'users.id').nullable();
    t.dateTime('created_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.dateTime('last_seen_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['table_session_id']);
  });

  // Business rule 8: one row per order a phone places, for the per-minute limit.
  await knex.schema.createTable('guest_order_submissions', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'guest_session_id', 'guest_sessions.id').notNullable().onDelete('CASCADE');
    t.dateTime('created_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['guest_session_id', 'created_at']);
  });

  await knex.schema.alterTable('order_items', (t) => {
    fk(t, 'guest_session_id', 'guest_sessions.id').nullable();
  });

  await knex.schema.createTable('service_requests', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'table_id', 'tables.id').notNullable();
    fk(t, 'table_session_id', 'table_sessions.id').nullable();
    fk(t, 'guest_session_id', 'guest_sessions.id').nullable();
    t.string('type', 20).notNullable();
    t.string('status', 20).notNullable().defaultTo('open');
    t.dateTime('created_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    fk(t, 'handled_by', 'users.id').nullable();
    t.dateTime('handled_at', { precision: 3 }).nullable();
    t.index(['location_id', 'status']);
    t.index(['table_id', 'status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('service_requests');
  await knex.schema.alterTable('order_items', (t) => {
    t.dropForeign(['guest_session_id']);
    t.dropColumn('guest_session_id');
  });
  await knex.schema.dropTableIfExists('guest_order_submissions');
  await knex.schema.dropTableIfExists('guest_sessions');
}
