import type { Knex } from 'knex';
import { fk, softDelete, timestamps } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('areas', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 60).notNullable();
    t.integer('sort').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id', 'sort']);
  });

  await knex.schema.createTable('tables', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'area_id', 'areas.id').notNullable();
    t.string('name', 20).notNullable();
    t.tinyint('seats').unsigned().notNullable().defaultTo(4);
    t.string('shape', 20).notNullable().defaultTo('square');
    // Grid cells (FLOOR_GRID in packages/shared); rotation in degrees.
    t.smallint('x').unsigned().notNullable();
    t.smallint('y').unsigned().notNullable();
    t.smallint('w').unsigned().notNullable();
    t.smallint('h').unsigned().notNullable();
    t.smallint('rotation').unsigned().notNullable().defaultTo(0);
    // Printed on the table's QR code; rotating it invalidates old codes.
    t.string('qr_token', 32).notNullable().unique();
    t.boolean('needs_cleaning').notNullable().defaultTo(false);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id']);
    t.index(['area_id']);
  });

  await knex.schema.createTable('table_sessions', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.uuid('uuid').notNullable().unique();
    fk(t, 'location_id', 'locations.id').notNullable();
    // The table the session was opened on (or moved to); merged tables are in table_session_tables.
    fk(t, 'table_id', 'tables.id').notNullable();
    fk(t, 'waiter_id', 'users.id').notNullable();
    t.tinyint('guest_count').unsigned().notNullable().defaultTo(1);
    t.string('status', 20).notNullable().defaultTo('open');
    t.dateTime('opened_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.dateTime('closed_at', { precision: 3 }).nullable();
    fk(t, 'closed_by', 'users.id').nullable();
    // Set when this session was merged into another one.
    fk(t, 'merged_into_id', 'table_sessions.id').nullable();
    timestamps(knex, t);
    t.index(['location_id', 'status']);
  });

  // Tables currently belonging to a session. Rows are removed when the session ends, so a
  // table can be in at most one active session (enforced by the unique key).
  await knex.schema.createTable('table_session_tables', (t) => {
    fk(t, 'session_id', 'table_sessions.id').notNullable().onDelete('CASCADE');
    fk(t, 'table_id', 'tables.id').notNullable();
    t.primary(['session_id', 'table_id']);
    t.unique(['table_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['table_session_tables', 'table_sessions', 'tables', 'areas']) {
    await knex.schema.dropTableIfExists(table);
  }
}
