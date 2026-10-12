import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { SessionStatus, TableShape } from '@tavolina/shared';
import { randomToken } from '../../lib/crypto.js';

/**
 * Demo floor for Bar Restaurant Las Vegas (plan §14): Salla with 12 tables and Tarraca with 8,
 * on the 48×32 editor grid, plus a few live tables so the floor view looks like a real service.
 */
type T = [
  name: string,
  shape: TableShape,
  seats: number,
  x: number,
  y: number,
  w: number,
  h: number,
];

const SALLA: T[] = [
  ['1', 'square', 2, 3, 3, 3, 3],
  ['2', 'square', 2, 10, 3, 3, 3],
  ['3', 'round', 4, 17, 3, 4, 4],
  ['4', 'round', 4, 25, 3, 4, 4],
  ['5', 'rectangle', 6, 34, 3, 7, 3],
  ['6', 'square', 4, 3, 12, 3, 3],
  ['7', 'square', 4, 10, 12, 3, 3],
  ['8', 'round', 4, 17, 12, 4, 4],
  ['9', 'round', 4, 25, 12, 4, 4],
  ['10', 'rectangle', 6, 34, 12, 7, 3],
  ['11', 'rectangle', 8, 3, 21, 9, 3],
  ['12', 'rectangle', 8, 16, 21, 9, 3],
];

const TARRACA: T[] = [
  ['T1', 'round', 4, 4, 4, 4, 4],
  ['T2', 'round', 4, 13, 4, 4, 4],
  ['T3', 'square', 4, 22, 4, 4, 4],
  ['T4', 'square', 4, 28, 4, 4, 4],
  ['T5', 'round', 2, 4, 14, 3, 3],
  ['T6', 'round', 2, 13, 14, 3, 3],
  ['T7', 'rectangle', 6, 22, 14, 8, 3],
  ['T8', 'bar_stool', 1, 36, 14, 2, 2],
];

/** [area, tables, waiter, guests, minutes ago, status] — merged tables share one session. */
const LIVE: [string, string[], string, number, number, SessionStatus][] = [
  ['Salla', ['2'], 'Klajdi Dervishi', 2, 25, 'open'],
  ['Salla', ['5'], 'Sara Leka', 6, 50, 'bill_requested'],
  ['Salla', ['7'], 'Dritan Muça', 3, 10, 'open'],
  ['Tarraca', ['T3', 'T4'], 'Klajdi Dervishi', 6, 40, 'open'],
];

export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number }>('id');
  if (!location) throw new Error('Run 01_demo_access first');
  const locationId = location.id;

  const tableIds = new Map<string, number>();
  for (const [sort, [areaName, tables]] of (
    [
      ['Salla', SALLA],
      ['Tarraca', TARRACA],
    ] as const
  ).entries()) {
    const [areaId] = await knex('areas').insert({ location_id: locationId, name: areaName, sort });
    for (const [name, shape, seats, x, y, w, h] of tables) {
      const [id] = await knex('tables').insert({
        location_id: locationId,
        area_id: areaId,
        name,
        shape,
        seats,
        x,
        y,
        w,
        h,
        qr_token: randomToken(16),
        // Table 9 has just been left; it waits for cleaning.
        needs_cleaning: areaName === 'Salla' && name === '9',
      });
      tableIds.set(`${areaName}/${name}`, id!);
    }
  }

  for (const [areaName, names, waiterName, guests, minutesAgo, status] of LIVE) {
    const waiter = await knex('users').where({ name: waiterName }).first<{ id: number }>('id');
    const ids = names.map((n) => tableIds.get(`${areaName}/${n}`)!);
    const [sessionId] = await knex('table_sessions').insert({
      uuid: randomUUID(),
      location_id: locationId,
      table_id: ids[0],
      waiter_id: waiter!.id,
      guest_count: guests,
      status,
      opened_at: new Date(Date.now() - minutesAgo * 60_000),
    });
    await knex('table_session_tables').insert(
      ids.map((tableId) => ({ session_id: sessionId, table_id: tableId })),
    );
  }
}
