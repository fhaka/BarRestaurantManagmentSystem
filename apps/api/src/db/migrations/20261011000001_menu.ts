import type { Knex } from 'knex';
import { fk, softDelete, timestamps } from '../migration-helpers.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('stations', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 120).notNullable();
    t.string('type', 20).notNullable().defaultTo('kitchen');
    // Printer routing arrives with the print bridge (Phase 6).
    t.bigInteger('printer_id').unsigned().nullable();
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.index(['location_id']);
  });

  await knex.schema.alterTable('devices', (t) => {
    t.foreign('station_id').references('stations.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('tax_rates', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 120).notNullable();
    t.integer('rate_bp').unsigned().notNullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    timestamps(knex, t);
    t.index(['location_id']);
  });

  await knex.schema.createTable('menu_categories', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'parent_id', 'menu_categories.id').nullable();
    t.string('name', 120).notNullable();
    t.string('description', 1000).notNullable().defaultTo('');
    t.string('icon', 30).nullable();
    t.string('image_url', 255).nullable();
    t.string('available_from', 5).nullable();
    t.string('available_to', 5).nullable();
    t.tinyint('weekday_mask').unsigned().notNullable().defaultTo(127);
    t.integer('sort').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id', 'sort']);
  });

  await knex.schema.createTable('menu_items', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'category_id', 'menu_categories.id').notNullable();
    fk(t, 'station_id', 'stations.id').nullable();
    fk(t, 'tax_rate_id', 'tax_rates.id').nullable();
    t.string('name', 120).notNullable();
    t.string('description', 1000).notNullable().defaultTo('');
    t.bigInteger('price_minor').notNullable();
    t.bigInteger('cost_minor').nullable();
    t.smallint('prep_minutes').unsigned().nullable();
    t.string('image_url', 255).nullable();
    t.boolean('is_popular').notNullable().defaultTo(false);
    t.boolean('is_new').notNullable().defaultTo(false);
    t.boolean('guest_visible').notNullable().defaultTo(true);
    t.boolean('active').notNullable().defaultTo(true);
    t.dateTime('out_of_stock_until', { precision: 3 }).nullable();
    t.integer('sort').notNullable().defaultTo(0);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id', 'category_id', 'sort']);
  });

  await knex.schema.createTable('menu_item_variants', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'item_id', 'menu_items.id').notNullable().onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.bigInteger('price_minor').notNullable();
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
    t.index(['item_id']);
  });

  await knex.schema.createTable('modifier_groups', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 120).notNullable();
    t.tinyint('min_select').unsigned().notNullable().defaultTo(0);
    t.tinyint('max_select').unsigned().notNullable().defaultTo(1);
    t.boolean('required').notNullable().defaultTo(false);
    t.integer('sort').notNullable().defaultTo(0);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id']);
  });

  await knex.schema.createTable('modifiers', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'group_id', 'modifier_groups.id').notNullable().onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.bigInteger('price_delta_minor').notNullable().defaultTo(0);
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    t.index(['group_id']);
  });

  await knex.schema.createTable('menu_item_modifier_groups', (t) => {
    fk(t, 'item_id', 'menu_items.id').notNullable().onDelete('CASCADE');
    fk(t, 'group_id', 'modifier_groups.id').notNullable().onDelete('CASCADE');
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
    t.primary(['item_id', 'group_id']);
  });

  // One row per (entity, field, language). The entity's own columns hold the main language.
  await knex.schema.createTable('translations', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.string('entity_type', 30).notNullable();
    t.bigInteger('entity_id').unsigned().notNullable();
    t.string('field', 30).notNullable();
    t.string('lang', 5).notNullable();
    t.text('value').notNullable();
    t.unique(['entity_type', 'entity_id', 'field', 'lang']);
  });

  // Reference lists, synced from code (packages/shared/src/menu.ts).
  await knex.schema.createTable('allergens', (t) => {
    t.string('key', 30).primary();
    t.tinyint('sort').unsigned().notNullable();
  });
  await knex.schema.createTable('menu_item_allergens', (t) => {
    fk(t, 'item_id', 'menu_items.id').notNullable().onDelete('CASCADE');
    t.string('allergen_key', 30).notNullable().references('allergens.key');
    t.primary(['item_id', 'allergen_key']);
  });
  await knex.schema.createTable('dietary_tags', (t) => {
    t.string('key', 30).primary();
    t.tinyint('sort').unsigned().notNullable();
  });
  await knex.schema.createTable('menu_item_tags', (t) => {
    fk(t, 'item_id', 'menu_items.id').notNullable().onDelete('CASCADE');
    t.string('tag_key', 30).notNullable().references('dietary_tags.key');
    t.primary(['item_id', 'tag_key']);
  });

  await knex.schema.createTable('price_rules', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 120).notNullable();
    t.string('scope', 10).notNullable();
    t.bigInteger('scope_id').unsigned().notNullable();
    t.string('type', 10).notNullable();
    t.bigInteger('value').notNullable();
    t.tinyint('weekday_mask').unsigned().notNullable().defaultTo(127);
    t.string('time_from', 5).nullable();
    t.string('time_to', 5).nullable();
    t.date('date_from').nullable();
    t.date('date_to').nullable();
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    softDelete(t);
    t.index(['location_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => t.dropForeign(['station_id']));
  for (const table of [
    'price_rules',
    'menu_item_tags',
    'dietary_tags',
    'menu_item_allergens',
    'allergens',
    'translations',
    'menu_item_modifier_groups',
    'modifiers',
    'modifier_groups',
    'menu_item_variants',
    'menu_items',
    'menu_categories',
    'tax_rates',
    'stations',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
