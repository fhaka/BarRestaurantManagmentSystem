import type { Knex } from 'knex';
import { fk, timestamps } from '../migration-helpers.js';

const at = (knex: Knex, t: Knex.CreateTableBuilder, name = 'created_at') =>
  t.dateTime(name, { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
const maybe = (t: Knex.CreateTableBuilder, name: string) =>
  t.dateTime(name, { precision: 3 }).nullable();

export async function up(knex: Knex): Promise<void> {
  // Business rule 1: the VAT rate is copied onto the line when it is added.
  await knex.schema.alterTable('order_items', (t) => {
    t.integer('tax_rate_bp').unsigned().nullable();
  });

  await knex.schema.createTable('discounts', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'order_id', 'orders.id').notNullable();
    // Null = a discount on the whole bill.
    fk(t, 'order_item_id', 'order_items.id').nullable();
    t.string('type', 10).notNullable();
    t.integer('value').unsigned().notNullable();
    t.bigInteger('amount_minor').notNullable().defaultTo(0);
    t.string('reason', 200).notNullable();
    fk(t, 'created_by', 'users.id').notNullable();
    fk(t, 'approved_by', 'users.id').nullable();
    at(knex, t);
    t.index(['order_id']);
  });

  await knex.schema.createTable('bills', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'order_id', 'orders.id').notNullable();
    t.string('split_type', 10).notNullable();
    t.string('label', 60).notNullable();
    t.smallint('sort').unsigned().notNullable().defaultTo(0);
    t.bigInteger('total_minor').notNullable();
    t.string('status', 10).notNullable().defaultTo('open');
    t.json('tax').notNullable();
    // Opens the digital receipt (QR on the paper receipt).
    t.string('receipt_token', 40).notNullable().unique();
    at(knex, t);
    maybe(t, 'paid_at');
    t.index(['order_id']);
  });
  await knex.schema.createTable('bill_items', (t) => {
    fk(t, 'bill_id', 'bills.id').notNullable().onDelete('CASCADE');
    fk(t, 'order_item_id', 'order_items.id').notNullable();
    t.primary(['bill_id', 'order_item_id']);
  });

  await knex.schema.createTable('cash_drawers', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.date('business_date').notNullable();
    fk(t, 'opened_by', 'users.id').notNullable();
    t.bigInteger('opening_float_minor').notNullable();
    at(knex, t, 'opened_at');
    fk(t, 'closed_by', 'users.id').nullable();
    fk(t, 'approved_by', 'users.id').nullable();
    t.bigInteger('expected_minor').nullable();
    t.bigInteger('counted_minor').nullable();
    t.bigInteger('difference_minor').nullable();
    t.json('counts').nullable();
    t.string('note', 500).nullable();
    maybe(t, 'closed_at');
    t.index(['location_id', 'closed_at']);
  });

  await knex.schema.createTable('payments', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.uuid('uuid').notNullable().unique();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'order_id', 'orders.id').notNullable();
    fk(t, 'bill_id', 'bills.id').notNullable();
    t.string('method', 10).notNullable();
    t.bigInteger('amount_minor').notNullable();
    t.bigInteger('tip_minor').notNullable().defaultTo(0);
    t.bigInteger('tendered_minor').nullable();
    t.bigInteger('change_minor').notNullable().defaultTo(0);
    t.string('reference', 100).nullable();
    // Tips belong to the table's waiter (plan §5.7).
    fk(t, 'tip_user_id', 'users.id').nullable();
    fk(t, 'taken_by', 'users.id').notNullable();
    fk(t, 'drawer_id', 'cash_drawers.id').nullable();
    t.date('business_date').notNullable();
    at(knex, t);
    t.index(['location_id', 'business_date']);
    t.index(['bill_id']);
  });

  await knex.schema.createTable('refunds', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'payment_id', 'payments.id').notNullable();
    t.bigInteger('amount_minor').notNullable();
    t.string('reason', 200).notNullable();
    fk(t, 'created_by', 'users.id').notNullable();
    fk(t, 'approved_by', 'users.id').notNullable();
    fk(t, 'drawer_id', 'cash_drawers.id').nullable();
    t.date('business_date').notNullable();
    at(knex, t);
    t.index(['payment_id']);
  });

  await knex.schema.createTable('cash_movements', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'drawer_id', 'cash_drawers.id').notNullable();
    t.string('type', 10).notNullable();
    // Positive amounts; the type says which way the money went.
    t.bigInteger('amount_minor').notNullable();
    t.string('reason', 200).nullable();
    fk(t, 'user_id', 'users.id').notNullable();
    fk(t, 'payment_id', 'payments.id').nullable();
    fk(t, 'refund_id', 'refunds.id').nullable();
    at(knex, t);
    t.index(['drawer_id']);
  });

  await knex.schema.createTable('business_days', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.date('business_date').notNullable();
    t.string('status', 10).notNullable().defaultTo('closed');
    t.json('z_report').notNullable();
    fk(t, 'closed_by', 'users.id').notNullable();
    at(knex, t, 'closed_at');
    t.unique(['location_id', 'business_date']);
  });

  // Plan §5.11: everything the real DPT integration will need, filled by the mock for now.
  await knex.schema.createTable('fiscal_invoices', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('kind', 20).notNullable(); // invoice | corrective | cash_deposit | withdrawal
    fk(t, 'bill_id', 'bills.id').nullable();
    fk(t, 'refund_id', 'refunds.id').nullable();
    fk(t, 'drawer_id', 'cash_drawers.id').nullable();
    t.string('business_unit_code', 20).notNullable();
    t.string('tcr_code', 20).notNullable();
    t.string('software_code', 20).notNullable();
    t.string('operator_code', 20).notNullable();
    t.integer('invoice_number').unsigned().nullable();
    t.smallint('year').unsigned().notNullable();
    t.dateTime('issued_at', { precision: 3 }).notNullable();
    t.bigInteger('total_minor').notNullable();
    t.json('payload').notNullable();
    t.json('response').nullable();
    t.string('nslf', 64).nullable();
    t.string('nivf', 64).nullable();
    t.string('qr_url', 500).nullable();
    t.string('status', 12).notNullable().defaultTo('pending');
    t.integer('attempts').unsigned().notNullable().defaultTo(0);
    t.string('last_error', 500).nullable();
    at(knex, t, 'next_attempt_at');
    timestamps(knex, t);
    t.index(['status', 'next_attempt_at']);
    t.index(['bill_id']);
  });

  await knex.schema.createTable('printers', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 80).notNullable();
    t.string('connection', 10).notNullable();
    t.string('host', 120).nullable();
    t.integer('port').unsigned().notNullable().defaultTo(9100);
    t.string('device_path', 200).nullable();
    t.tinyint('width_chars').unsigned().notNullable().defaultTo(42);
    t.boolean('active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.index(['location_id']);
  });

  // The print bridge PC signs in with a key (shown once when created).
  await knex.schema.createTable('print_bridges', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    t.string('name', 80).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    maybe(t, 'last_seen_at');
    maybe(t, 'revoked_at');
    at(knex, t);
  });

  await knex.schema.createTable('print_jobs', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'printer_id', 'printers.id').notNullable();
    t.string('kind', 20).notNullable(); // ticket | receipt | z_report | drawer_kick
    t.json('document').notNullable();
    t.string('status', 10).notNullable().defaultTo('queued');
    t.integer('attempts').unsigned().notNullable().defaultTo(0);
    t.string('error', 500).nullable();
    at(knex, t);
    maybe(t, 'printed_at');
    t.index(['location_id', 'status']);
  });

  // A phone's new visit remembers its previous one, so the guests who just paid can still review.
  await knex.schema.alterTable('guest_sessions', (t) => {
    fk(t, 'previous_id', 'guest_sessions.id').nullable();
  });

  await knex.schema.createTable('reviews', (t) => {
    t.bigIncrements('id').unsigned().primary();
    fk(t, 'location_id', 'locations.id').notNullable();
    fk(t, 'table_session_id', 'table_sessions.id').notNullable();
    fk(t, 'guest_session_id', 'guest_sessions.id').notNullable().unique();
    t.tinyint('rating').unsigned().notNullable();
    t.string('comment', 1000).nullable();
    at(knex, t);
    t.index(['location_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'reviews',
    'print_jobs',
    'print_bridges',
    'printers',
    'fiscal_invoices',
    'business_days',
    'cash_movements',
    'refunds',
    'payments',
    'cash_drawers',
    'bill_items',
    'bills',
    'discounts',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.schema.alterTable('order_items', (t) => t.dropColumn('tax_rate_bp'));
  await knex.schema.alterTable('guest_sessions', (t) => {
    t.dropForeign(['previous_id']);
    t.dropColumn('previous_id');
  });
}
