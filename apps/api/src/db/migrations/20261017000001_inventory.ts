import type { Knex } from 'knex';
import { fk, softDelete, timestamps } from '../migration-helpers.js';

const qty = (t: Knex.CreateTableBuilder, name: string) =>
  t.decimal(name, 14, 3).notNullable().defaultTo(0);
const at = (knex: Knex, t: Knex.CreateTableBuilder, name = 'created_at') =>
  t.dateTime(name, { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('suppliers', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 120).notNullable();
    t.string('contact', 120).nullable();
    t.string('phone', 40).nullable();
    t.string('email', 190).nullable();
    t.string('notes', 500).nullable();
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id']);
  });

  await knex.schema.createTable('ingredients', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 120).notNullable();
    t.string('unit', 10).notNullable();
    t.string('category', 60).notNullable().defaultTo('');
    // Always moved together with a stock_movements row (the ledger is the truth).
    qty(t, 'stock_qty');
    qty(t, 'min_qty');
    // Per whole unit (kg, l, piece), weighted average of what was received.
    t.bigInteger('cost_per_unit_minor').notNullable().defaultTo(0);
    fk(t, 'supplier_id', 'suppliers.id').nullable();
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id', 'category']);
  });

  // Plan §5.9: a menu item (optionally one size of it) or a modifier uses ingredient quantities.
  await knex.schema.createTable('recipe_lines', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'menu_item_id', 'menu_items.id').nullable().onDelete('CASCADE');
    fk(t, 'variant_id', 'menu_item_variants.id').nullable().onDelete('CASCADE');
    fk(t, 'modifier_id', 'modifiers.id').nullable().onDelete('CASCADE');
    fk(t, 'ingredient_id', 'ingredients.id').notNullable();
    qty(t, 'qty');
    t.index(['menu_item_id']);
    t.index(['modifier_id']);
  });

  await knex.schema.createTable('stock_movements', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'ingredient_id', 'ingredients.id').notNullable();
    t.string('type', 20).notNullable();
    // Signed: negative for sales and waste, positive for purchases.
    qty(t, 'qty');
    t.bigInteger('unit_cost_minor').notNullable().defaultTo(0);
    t.string('ref_type', 30).nullable();
    t.bigInteger('ref_id').unsigned().nullable();
    t.string('reason', 200).nullable();
    fk(t, 'user_id', 'users.id').nullable();
    at(knex, t);
    t.index(['location_id', 'created_at']);
    t.index(['ingredient_id', 'created_at']);
    t.index(['ref_type', 'ref_id']);
  });

  // Business rule 7: so a dish is booked out once, whether on send or on payment.
  await knex.schema.alterTable('order_items', (t) => {
    t.boolean('stock_deducted').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('purchase_orders', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'supplier_id', 'suppliers.id').notNullable();
    t.integer('number').unsigned().notNullable();
    t.string('status', 20).notNullable().defaultTo('draft');
    t.string('notes', 500).nullable();
    t.date('expected_at').nullable();
    fk(t, 'created_by', 'users.id').notNullable();
    t.dateTime('sent_at', { precision: 3 }).nullable();
    t.dateTime('received_at', { precision: 3 }).nullable();
    timestamps(knex, t);
    t.unique(['location_id', 'number']);
  });
  await knex.schema.createTable('purchase_order_lines', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'purchase_order_id', 'purchase_orders.id').notNullable().onDelete('CASCADE');
    fk(t, 'ingredient_id', 'ingredients.id').notNullable();
    qty(t, 'qty_ordered');
    qty(t, 'qty_received');
    t.bigInteger('unit_cost_minor').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('stock_counts', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('category', 60).nullable();
    t.string('status', 10).notNullable().defaultTo('open');
    t.string('note', 500).nullable();
    fk(t, 'created_by', 'users.id').notNullable();
    fk(t, 'applied_by', 'users.id').nullable();
    at(knex, t);
    t.dateTime('applied_at', { precision: 3 }).nullable();
  });
  await knex.schema.createTable('stock_count_lines', (t) => {
    fk(t, 'stock_count_id', 'stock_counts.id').notNullable().onDelete('CASCADE');
    fk(t, 'ingredient_id', 'ingredients.id').notNullable();
    // Stock when the count started; sales during the count are kept when it is applied.
    qty(t, 'expected_qty');
    t.decimal('counted_qty', 14, 3).nullable();
    t.bigInteger('unit_cost_minor').notNullable().defaultTo(0);
    t.primary(['stock_count_id', 'ingredient_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'stock_count_lines',
    'stock_counts',
    'purchase_order_lines',
    'purchase_orders',
    'stock_movements',
    'recipe_lines',
    'ingredients',
    'suppliers',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.schema.alterTable('order_items', (t) => t.dropColumn('stock_deducted'));
}
