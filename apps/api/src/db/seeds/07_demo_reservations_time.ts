import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { addDays, localParts, weekStart, zonedDateTime } from '@tavolina/shared';

/**
 * Reservations and staff time for Bar Restaurant Las Vegas: bookings around "now" (two tables show
 * as reserved on the floor), this week's and next week's schedule, and two weeks of clock-ins that
 * roughly follow the schedule, so the hours report has something to show.
 */

const TZ = 'Europe/Tirane';
const MIN = 60_000;

// [minutes from now, table, name, phone, party, status, source, notes]
type R = [number, string | null, string, string, number, string, 'staff' | 'widget', string | null];
const roundTo15 = (d: Date) => new Date(Math.ceil(d.getTime() / (15 * MIN)) * 15 * MIN);

const RESERVATIONS: R[] = [
  [-180, '4', 'Gentiana Prifti', '+355 69 410 2233', 4, 'completed', 'staff', null],
  [30, '9', 'Erion Dedja', '+355 68 222 1100', 4, 'confirmed', 'staff', null],
  [
    45,
    '11',
    'Familja Basha',
    '+355 69 700 4455',
    7,
    'booked',
    'staff',
    'Ditëlindje, sjellin tortën vetë',
  ],
  [150, '3', 'Marco Rossi', '+39 333 123 4567', 3, 'booked', 'widget', 'Turistë nga Italia'],
  [210, 'T1', 'Ilda Hoxha', '+355 67 555 8899', 4, 'confirmed', 'widget', 'Karrige për fëmijë'],
  [
    240,
    null,
    'Blerim Kola',
    '+355 69 300 1212',
    2,
    'booked',
    'staff',
    'Do të vendosë tavolinën kur të vijë',
  ],
  [-1440 + 60, '6', 'Arta Mema', '+355 69 111 2299', 2, 'no_show', 'staff', null],
  [
    1440 + 120,
    '10',
    'Kompania Alba Tech',
    '+355 4 222 3344',
    6,
    'confirmed',
    'staff',
    'Darkë pune, faturë me NIPT',
  ],
  [1440 + 180, '1', 'Eni Duka', '+355 69 808 7070', 2, 'booked', 'widget', null],
  [1440 + 200, 'T7', 'Luan Gjoka', '+355 68 909 1234', 5, 'booked', 'staff', null],
  [
    1440 + 240,
    '12',
    'Martesa Krasniqi',
    '+355 69 444 5566',
    8,
    'cancelled',
    'staff',
    'Anuluan me telefon',
  ],
  [2 * 1440 + 90, '8', 'Sokol Rama', '+355 69 121 3434', 4, 'booked', 'widget', null],
];

// Weekly pattern: [person, weekday 0=Mon…6=Sun, from, to].
const SHIFTS: [string, number[], string, string][] = [
  ['Elira Shehu', [0, 1, 2, 3, 4], '10:00', '18:00'],
  ['Klajdi Dervishi', [0, 1, 2, 4, 5], '07:00', '15:00'],
  ['Sara Leka', [0, 2, 3, 5, 6], '15:00', '23:00'],
  ['Dritan Muça', [1, 3, 4, 5, 6], '15:00', '23:00'],
  ['Anisa Gjoni', [0, 1, 2, 3, 4, 5], '08:00', '16:00'],
];

const REF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let refSeed = 7;
const reference = () =>
  Array.from({ length: 6 }, () => {
    refSeed = (refSeed * 48271) % 2147483647;
    return REF[refSeed % REF.length];
  }).join('');
// Small, repeatable "people are a few minutes early or late".
let jitterSeed = 11;
const jitter = (max: number) => {
  jitterSeed = (jitterSeed * 16807) % 2147483647;
  return (jitterSeed % (2 * max + 1)) - max;
};

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedDateTime(date, h! * 60 + m!, TZ);
};

export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number }>('id');
  const manager = await knex('users')
    .where({ email: 'menaxher@lasvegas.test' })
    .first<{ id: number }>('id');
  if (!location || !manager) throw new Error('Run 01_demo_access first');
  const locationId = location.id;
  const now = new Date();

  const tables = new Map(
    (await knex('tables').where({ location_id: locationId }).select('id', 'name')).map((t) => [
      t.name as string,
      Number(t.id),
    ]),
  );
  const base = roundTo15(now);
  for (const [minutes, table, name, phone, party, status, source, notes] of RESERVATIONS) {
    const start = new Date(base.getTime() + minutes * MIN);
    await knex('reservations').insert({
      uuid: randomUUID(),
      location_id: locationId,
      table_id: table ? tables.get(table)! : null,
      name,
      phone,
      party_size: party,
      starts_at: start,
      duration_min: 90,
      ends_at: new Date(start.getTime() + 90 * MIN),
      notes,
      status,
      source,
      reference: reference(),
      created_by: source === 'staff' ? manager.id : null,
      created_at: new Date(start.getTime() - 2 * 1440 * MIN),
    });
  }

  const users = new Map(
    (await knex('users').select('id', 'name')).map((u) => [u.name as string, Number(u.id)]),
  );
  const today = localParts(now, TZ).date;
  const monday = weekStart(today);
  // Two past weeks (for clock-ins) plus this week and next week (the schedule).
  for (let day = -14; day < 14; day++) {
    const date = addDays(monday, day);
    const weekday = day >= 0 ? day % 7 : ((day % 7) + 7) % 7;
    for (const [person, days, from, to] of SHIFTS) {
      if (!days.includes(weekday)) continue;
      const userId = users.get(person)!;
      const start = at(date, from);
      const end = at(date, to);
      if (day >= 0) {
        await knex('shifts').insert({
          location_id: locationId,
          user_id: userId,
          starts_at: start,
          ends_at: end,
          created_by: manager.id,
        });
      }
      if (start > now) continue;
      const clockIn = new Date(start.getTime() + jitter(8) * MIN);
      const clockOut = new Date(end.getTime() + jitter(12) * MIN);
      await knex('time_entries').insert({
        location_id: locationId,
        user_id: userId,
        clock_in: clockIn,
        // On shift right now: still clocked in.
        clock_out: clockOut > now ? null : clockOut,
        source: 'pin',
      });
    }
  }
}
