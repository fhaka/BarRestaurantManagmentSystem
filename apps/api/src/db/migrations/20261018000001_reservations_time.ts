import type { Knex } from 'knex';
import { fk, timestamps } from '../migration-helpers.js';

const instant = (t: Knex.CreateTableBuilder, name: string) => t.dateTime(name, { precision: 3 });

export async function up(knex: Knex): Promise<void> {
  // Plan §5.10 / §8: one table per reservation (or none yet); status machine in shared.
  await knex.schema.createTable('reservations', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.uuid('uuid').notNullable().unique();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'table_id', 'tables.id').nullable();
    t.string('name', 120).notNullable();
    t.string('phone', 30).notNullable();
    t.integer('party_size').unsigned().notNullable();
    instant(t, 'starts_at').notNullable();
    t.integer('duration_min').unsigned().notNullable();
    // Kept with starts_at so overlap checks are a plain range query.
    instant(t, 'ends_at').notNullable();
    t.string('notes', 500).nullable();
    t.string('status', 12).notNullable().defaultTo('booked');
    t.string('source', 10).notNullable().defaultTo('staff');
    // Short code the guest can quote on the phone.
    t.string('reference', 8).notNullable();
    fk(t, 'table_session_id', 'table_sessions.id').nullable();
    fk(t, 'created_by', 'users.id').nullable();
    timestamps(knex, t);
    t.index(['location_id', 'starts_at']);
    t.index(['table_id', 'starts_at']);
    t.unique(['location_id', 'reference']);
  });

  // Plan §8: the weekly schedule.
  await knex.schema.createTable('shifts', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'user_id', 'users.id').notNullable();
    instant(t, 'starts_at').notNullable();
    instant(t, 'ends_at').notNullable();
    t.string('note', 300).nullable();
    fk(t, 'created_by', 'users.id').nullable();
    timestamps(knex, t);
    t.index(['location_id', 'starts_at']);
    t.index(['user_id', 'starts_at']);
  });

  // Plan §5.8: clock in/out; edits by a manager are audited.
  await knex.schema.createTable('time_entries', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'user_id', 'users.id').notNullable();
    instant(t, 'clock_in').notNullable();
    instant(t, 'clock_out').nullable();
    t.string('note', 300).nullable();
    t.string('source', 10).notNullable().defaultTo('app');
    fk(t, 'edited_by', 'users.id').nullable();
    timestamps(knex, t);
    t.index(['location_id', 'clock_in']);
    t.index(['user_id', 'clock_in']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['time_entries', 'shifts', 'reservations']) {
    await knex.schema.dropTableIfExists(table);
  }
}
