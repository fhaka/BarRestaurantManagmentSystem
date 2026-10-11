import type { Knex } from 'knex';

/** created_at / updated_at as UTC DATETIME(3); updated_at maintained by MySQL. */
function timestamps(knex: Knex, t: Knex.CreateTableBuilder) {
  t.dateTime('created_at', { precision: 3 })
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
  t.dateTime('updated_at', { precision: 3 })
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'));
}

function createdAt(knex: Knex, t: Knex.CreateTableBuilder) {
  t.dateTime('created_at', { precision: 3 })
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('owners_accounts', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.string('company_name', 160).notNullable();
    t.string('nipt', 10).nullable();
    t.string('plan', 30).notNullable().defaultTo('trial');
    t.string('status', 20).notNullable().defaultTo('active');
    timestamps(knex, t);
  });

  await knex.schema.createTable('locations', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.bigInteger('account_id').unsigned().notNullable().references('owners_accounts.id');
    t.string('name', 120).notNullable();
    t.string('address', 255).notNullable().defaultTo('');
    t.string('nipt', 10).nullable();
    t.string('timezone', 40).notNullable().defaultTo('Europe/Tirane');
    t.string('currency', 3).notNullable().defaultTo('ALL');
    t.json('settings').notNullable();
    timestamps(knex, t);
    t.dateTime('deleted_at', { precision: 3 }).nullable();
    t.index(['account_id']);
  });

  await knex.schema.createTable('users', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.bigInteger('account_id').unsigned().notNullable().references('owners_accounts.id');
    t.string('name', 100).notNullable();
    // Optional: waiters may only ever use a PIN.
    t.string('email', 190).nullable().unique();
    t.string('password_hash', 100).nullable();
    t.string('pin_hash', 100).nullable();
    t.string('phone', 30).nullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.string('lang', 5).notNullable().defaultTo('sq');
    t.tinyint('pin_failed_attempts').unsigned().notNullable().defaultTo(0);
    t.dateTime('pin_locked_until', { precision: 3 }).nullable();
    t.dateTime('last_login_at', { precision: 3 }).nullable();
    timestamps(knex, t);
    t.dateTime('deleted_at', { precision: 3 }).nullable();
    t.index(['account_id']);
  });

  await knex.schema.createTable('roles', (t) => {
    t.increments('id').unsigned().primary();
    t.string('key', 30).notNullable().unique();
    t.string('name', 60).notNullable();
    t.tinyint('rank').unsigned().notNullable().defaultTo(0);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id').unsigned().primary();
    t.string('key', 60).notNullable().unique();
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').unsigned().notNullable().references('roles.id').onDelete('CASCADE');
    t.integer('permission_id')
      .unsigned()
      .notNullable()
      .references('permissions.id')
      .onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('user_locations', (t) => {
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.bigInteger('location_id')
      .unsigned()
      .notNullable()
      .references('locations.id')
      .onDelete('CASCADE');
    t.integer('role_id').unsigned().notNullable().references('roles.id');
    createdAt(knex, t);
    t.primary(['user_id', 'location_id']);
    t.index(['location_id']);
  });

  await knex.schema.createTable('devices', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.uuid('uuid').notNullable().unique();
    t.bigInteger('account_id').unsigned().notNullable().references('owners_accounts.id');
    t.bigInteger('location_id').unsigned().nullable().references('locations.id');
    t.string('name', 100).notNullable();
    t.string('type', 20).notNullable().defaultTo('pos');
    // FK to stations is added with the menu module (Phase 2).
    t.bigInteger('station_id').unsigned().nullable();
    t.dateTime('last_seen_at', { precision: 3 }).nullable();
    t.dateTime('revoked_at', { precision: 3 }).nullable();
    timestamps(knex, t);
    t.index(['account_id']);
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.bigInteger('device_id').unsigned().nullable().references('devices.id').onDelete('SET NULL');
    // All rotations of one sign-in share a family; reuse of a rotated token revokes the family.
    t.uuid('family_id').notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.dateTime('expires_at', { precision: 3 }).notNullable();
    t.dateTime('revoked_at', { precision: 3 }).nullable();
    t.string('revoked_reason', 30).nullable();
    t.string('ip', 45).nullable();
    t.string('user_agent', 255).nullable();
    createdAt(knex, t);
    t.index(['user_id']);
    t.index(['family_id']);
  });

  await knex.schema.createTable('approvals', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.string('token_hash', 64).notNullable().unique();
    t.bigInteger('location_id').unsigned().notNullable().references('locations.id');
    t.string('action', 50).notNullable();
    t.string('entity_type', 50).notNullable();
    t.string('entity_id', 64).notNullable();
    t.bigInteger('requested_by').unsigned().notNullable().references('users.id');
    t.bigInteger('approved_by').unsigned().notNullable().references('users.id');
    t.dateTime('expires_at', { precision: 3 }).notNullable();
    t.dateTime('used_at', { precision: 3 }).nullable();
    createdAt(knex, t);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.bigInteger('account_id').unsigned().notNullable().references('owners_accounts.id');
    t.bigInteger('location_id').unsigned().nullable().references('locations.id');
    t.bigInteger('user_id').unsigned().nullable().references('users.id');
    t.string('action', 80).notNullable();
    t.string('entity_type', 50).notNullable();
    t.string('entity_id', 64).nullable();
    t.json('before').nullable();
    t.json('after').nullable();
    t.bigInteger('approved_by').unsigned().nullable().references('users.id');
    t.bigInteger('device_id').unsigned().nullable();
    t.string('ip', 45).nullable();
    t.string('request_id', 64).nullable();
    createdAt(knex, t);
    t.index(['location_id', 'created_at']);
    t.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('idempotency_keys', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.string('scope', 80).notNullable();
    t.string('idem_key', 100).notNullable();
    t.string('method', 10).notNullable();
    t.string('path', 255).notNullable();
    t.string('request_hash', 64).notNullable();
    t.smallint('status_code').unsigned().nullable();
    t.json('response_body').nullable();
    createdAt(knex, t);
    t.unique(['scope', 'idem_key']);
    t.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'idempotency_keys',
    'audit_logs',
    'approvals',
    'refresh_tokens',
    'devices',
    'user_locations',
    'role_permissions',
    'permissions',
    'roles',
    'users',
    'locations',
    'owners_accounts',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
