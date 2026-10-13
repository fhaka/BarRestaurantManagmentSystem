import type { Knex } from 'knex';
import { businessDate } from '@tavolina/shared';

/**
 * The till at the start of service: Anisa (cashier) opened the cash drawer with a 5 000 L float
 * an hour ago, registered with the (mock) fiscal service. Bills are paid from the cashier screen.
 */
export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number; timezone: string }>(
    'id',
    'timezone',
  );
  const cashier = await knex('users')
    .where({ email: 'arka@lasvegas.test' })
    .first<{ id: number }>('id');
  if (!location || !cashier) throw new Error('Run 01_demo_access first');
  const openedAt = new Date(Date.now() - 60 * 60_000);
  const [drawerId] = await knex('cash_drawers').insert({
    location_id: location.id,
    business_date: businessDate(openedAt, location.timezone),
    opened_by: cashier.id,
    opening_float_minor: 500_000,
    opened_at: openedAt,
  });
  await knex('fiscal_invoices').insert({
    location_id: location.id,
    kind: 'cash_deposit',
    drawer_id: drawerId,
    business_unit_code: 'ab123cd456',
    tcr_code: 'ef789gh012',
    software_code: 'tv000tv000',
    operator_code: `op${String(cashier.id).padStart(8, '0')}`,
    year: openedAt.getUTCFullYear(),
    issued_at: openedAt,
    total_minor: 500_000,
    payload: JSON.stringify({ amountMinor: 500_000, at: openedAt.toISOString() }),
    status: 'registered',
    attempts: 1,
    nivf: '00000000-0000-4000-8000-000000000001',
  });
}
