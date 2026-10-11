import type { Knex } from 'knex';

/** created_at / updated_at as UTC DATETIME(3); updated_at maintained by MySQL. */
export function timestamps(knex: Knex, t: Knex.CreateTableBuilder): void {
  t.dateTime('created_at', { precision: 3 })
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
  t.dateTime('updated_at', { precision: 3 })
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'));
}

export function softDelete(t: Knex.CreateTableBuilder): void {
  t.dateTime('deleted_at', { precision: 3 }).nullable();
}

/** BIGINT UNSIGNED FK column. */
export function fk(t: Knex.CreateTableBuilder, column: string, references: string) {
  return t.bigInteger(column).unsigned().references(references);
}
