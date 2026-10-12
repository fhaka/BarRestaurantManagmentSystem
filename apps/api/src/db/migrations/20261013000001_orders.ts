import type { Knex } from 'knex';
import { fk, softDelete, timestamps } from '../migration-helpers.js';

const ts = (knex: Knex, t: Knex.CreateTableBuilder, name: string) =>
  t.dateTime(name, { precision: 3 }).nullable();

export async function up(knex: Knex): Promise<void> {
  // Business rule 10: order and ticket numbers restart every business day per location.
  await knex.schema.createTable('daily_counters', (t) => {
    fk(t, 'location_id', 'locations.id').notNullable();
    t.date('business_date').notNullable();
    t.string('kind', 20).notNullable();
    t.integer('value').unsigned().notNullable().defaultTo(0);
    t.primary(['location_id', 'business_date', 'kind']);
  });

  await knex.schema.createTable('combos', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'category_id', 'menu_categories.id').notNullable();
    t.string('name', 120).notNullable();
    t.string('description', 1000).notNullable().defaultTo('');
    t.bigInteger('price_minor').notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('guest_visible').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id']);
  });
  await knex.schema.createTable('combo_slots', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'combo_id', 'combos.id').notNullable().onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
  });
  await knex.schema.createTable('combo_slot_items', (t) => {
    fk(t, 'slot_id', 'combo_slots.id').notNullable().onDelete('CASCADE');
    fk(t, 'menu_item_id', 'menu_items.id').notNullable();
    t.bigInteger('price_delta_minor').notNullable().defaultTo(0);
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
    t.primary(['slot_id', 'menu_item_id']);
  });

  await knex.schema.createTable('orders', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.uuid('uuid').notNullable().unique();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'table_session_id', 'table_sessions.id').nullable();
    t.string('type', 20).notNullable();
    t.integer('number').unsigned().notNullable();
    t.date('business_date').notNullable();
    t.string('status', 20).notNullable().defaultTo('open');
    t.string('customer_name', 100).nullable();
    t.string('customer_phone', 30).nullable();
    t.string('delivery_address', 255).nullable();
    ts(knex, t, 'pickup_at');
    // Kept in sync by the server on every change; the client never sends totals.
    t.bigInteger('subtotal_minor').notNullable().defaultTo(0);
    t.bigInteger('discount_minor').notNullable().defaultTo(0);
    t.bigInteger('service_minor').notNullable().defaultTo(0);
    t.bigInteger('tax_minor').notNullable().defaultTo(0);
    t.bigInteger('total_minor').notNullable().defaultTo(0);
    fk(t, 'opened_by', 'users.id').notNullable();
    ts(knex, t, 'closed_at');
    timestamps(knex, t);
    t.unique(['location_id', 'business_date', 'number']);
    t.index(['table_session_id']);
    t.index(['location_id', 'status']);
  });

  await knex.schema.createTable('order_items', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.uuid('uuid').notNullable().unique();
    fk(t, 'order_id', 'orders.id').notNullable();
    // Dishes chosen inside a combo point at the combo line.
    fk(t, 'parent_item_id', 'order_items.id').nullable();
    fk(t, 'menu_item_id', 'menu_items.id').nullable();
    fk(t, 'combo_id', 'combos.id').nullable();
    fk(t, 'variant_id', 'menu_item_variants.id').nullable().onDelete('SET NULL');
    // Business rule 1: names and prices are copied at the moment the item is added.
    t.string('name_snapshot', 160).notNullable();
    t.string('variant_name_snapshot', 160).nullable();
    t.bigInteger('unit_price_minor').notNullable();
    fk(t, 'price_rule_id', 'price_rules.id').nullable();
    t.smallint('qty').unsigned().notNullable().defaultTo(1);
    t.tinyint('seat').unsigned().nullable();
    t.tinyint('course').unsigned().nullable();
    t.boolean('held').notNullable().defaultTo(false);
    t.string('notes', 200).nullable();
    t.string('status', 30).notNullable();
    fk(t, 'station_id', 'stations.id').nullable();
    t.string('source', 10).notNullable().defaultTo('staff');
    fk(t, 'added_by', 'users.id').nullable();
    t.dateTime('added_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    ts(knex, t, 'sent_at');
    ts(knex, t, 'started_at');
    ts(knex, t, 'ready_at');
    ts(knex, t, 'served_at');
    ts(knex, t, 'voided_at');
    t.string('void_reason', 200).nullable();
    fk(t, 'voided_by', 'users.id').nullable();
    fk(t, 'void_approved_by', 'users.id').nullable();
    timestamps(knex, t);
    t.index(['order_id', 'status']);
    t.index(['station_id', 'status']);
  });

  await knex.schema.createTable('order_item_modifiers', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'order_item_id', 'order_items.id').notNullable().onDelete('CASCADE');
    fk(t, 'modifier_id', 'modifiers.id').nullable().onDelete('SET NULL');
    t.string('name_snapshot', 160).notNullable();
    t.bigInteger('price_delta_minor').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('kds_tickets', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'order_id', 'orders.id').notNullable();
    fk(t, 'station_id', 'stations.id').notNullable();
    t.integer('number').unsigned().notNullable();
    t.date('business_date').notNullable();
    t.string('status', 20).notNullable().defaultTo('new');
    t.dateTime('created_at', { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    ts(knex, t, 'started_at');
    ts(knex, t, 'bumped_at');
    ts(knex, t, 'done_at');
    t.index(['station_id', 'status']);
    t.index(['order_id']);
  });
  await knex.schema.createTable('kds_ticket_items', (t) => {
    fk(t, 'ticket_id', 'kds_tickets.id').notNullable().onDelete('CASCADE');
    fk(t, 'order_item_id', 'order_items.id').notNullable();
    t.primary(['ticket_id', 'order_item_id']);
    t.index(['order_item_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'kds_ticket_items',
    'kds_tickets',
    'order_item_modifiers',
    'order_items',
    'orders',
    'combo_slot_items',
    'combo_slots',
    'combos',
    'daily_counters',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
