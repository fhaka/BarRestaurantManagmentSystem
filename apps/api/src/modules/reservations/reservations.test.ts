import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  localParts,
  zonedDateTime,
  type AvailabilitySlot,
  type FloorState,
  type PublicAvailability,
  type PublicBookingInfo,
  type Reservation,
} from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
const TZ = 'Europe/Tirane';
let fx: Fixture;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let t: { two: number; four: number; six: number };
const tomorrow = () => addDays(localParts(new Date(), TZ).date, 1);
/** Tomorrow at a local time, as an ISO instant. */
const at = (hhmm: string, date = tomorrow()) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedDateTime(date, h! * 60 + m!, TZ).toISOString();
};

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  const table = async (name: string, seats: number, x: number) =>
    (await manager.post('/api/v1/tables').send({ areaId, name, seats, x, y: 0, w: 3, h: 3 })).body
      .id as number;
  t = { two: await table('1', 2, 0), four: await table('2', 4, 5), six: await table('3', 6, 10) };
});

async function setSettings(patch: Record<string, unknown>) {
  const row = await db('locations').where({ id: fx.locationId }).first('settings');
  const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
  await db('locations')
    .where({ id: fx.locationId })
    .update({ settings: JSON.stringify({ ...settings, ...patch }) });
}

const reservation = (startsAt: string, extra: Record<string, unknown> = {}) => ({
  uuid: randomUUID(),
  startsAt,
  durationMin: 90,
  partySize: 4,
  name: 'Arben Hoxha',
  phone: '+355 69 123 4567',
  tableId: t.four,
  ...extra,
});

describe('staff reservations (plan §5.10)', () => {
  it('detects table conflicts; back-to-back bookings and unassigned ones are fine', async () => {
    const first = await manager.post('/api/v1/reservations').send(reservation(at('19:00')));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      status: 'booked',
      source: 'staff',
      tableName: '2',
      partySize: 4,
    });

    const clash = await manager.post('/api/v1/reservations').send(reservation(at('20:00')));
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({
      code: 'RESERVATION_CONFLICT',
      details: { name: 'Arben Hoxha' },
    });

    await manager
      .post('/api/v1/reservations')
      .send(reservation(at('20:30')))
      .expect(201);
    await manager
      .post('/api/v1/reservations')
      .send(reservation(at('20:00'), { tableId: null }))
      .expect(201);

    // Moving the first booking within its own time does not clash with itself.
    const moved = await manager
      .patch(`/api/v1/reservations/${first.body.id}`)
      .send({ ...reservation(at('18:30')), uuid: undefined });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.startsAt).toBe(at('18:30'));

    const day: Reservation[] = (await manager.get(`/api/v1/reservations?date=${tomorrow()}`)).body;
    expect(day.map((r) => r.startsAt)).toEqual([at('18:30'), at('20:00'), at('20:30')]);
  });

  it('availability lists every slot with the tables free for the whole stay', async () => {
    await manager
      .post('/api/v1/reservations')
      .send(reservation(at('19:00')))
      .expect(201);
    const slots: AvailabilitySlot[] = (
      await manager.get(`/api/v1/reservations/availability?date=${tomorrow()}&partySize=4`)
    ).body;
    expect(slots).toHaveLength(31); // 07:00 … 22:00 every 30 min (default hours 07–23)
    const byTime = new Map(slots.map((s) => [s.time, s]));
    expect(byTime.get('17:30')!.freeTableIds).toEqual([t.two, t.four, t.six]);
    expect(byTime.get('18:00')!.freeTableIds).toEqual([t.two, t.six]); // 18:00–19:30 overlaps 19:00
    expect(byTime.get('20:30')!.freeTableIds).toEqual([t.two, t.four, t.six]);
    // Six people only fit table 3.
    const six: AvailabilitySlot[] = (
      await manager.get(`/api/v1/reservations/availability?date=${tomorrow()}&partySize=7`)
    ).body;
    expect(six.every((s) => !s.available)).toBe(true);
  });

  it('cancelling frees the table; seated cannot be set by hand; waiters can only look', async () => {
    const r = (await manager.post('/api/v1/reservations').send(reservation(at('19:00')))).body;
    expect(
      (await manager.post(`/api/v1/reservations/${r.id}/status`).send({ status: 'seated' })).body
        .error.code,
    ).toBe('RESERVATION_STATE');
    await manager
      .post(`/api/v1/reservations/${r.id}/status`)
      .send({ status: 'confirmed' })
      .expect(200);
    await manager
      .post(`/api/v1/reservations/${r.id}/status`)
      .send({ status: 'cancelled' })
      .expect(200);
    await manager
      .post('/api/v1/reservations')
      .send(reservation(at('19:30')))
      .expect(201);
    // Back on the book would now double-book the table.
    const back = await manager
      .post(`/api/v1/reservations/${r.id}/status`)
      .send({ status: 'booked' });
    expect(back.body.error.code).toBe('RESERVATION_CONFLICT');

    expect((await waiter.get(`/api/v1/reservations?date=${tomorrow()}`)).status).toBe(200);
    expect((await waiter.post('/api/v1/reservations').send(reservation(at('12:00')))).status).toBe(
      403,
    );
  });
});

describe('floor integration', () => {
  it('a table shows reserved from 60 minutes before; seating links the session; closing completes it', async () => {
    const soon = new Date(Date.now() + 40 * 60_000).toISOString();
    const later = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const r = (await manager.post('/api/v1/reservations').send(reservation(soon)))
      .body as Reservation;
    await manager
      .post('/api/v1/reservations')
      .send(reservation(later, { tableId: t.six }))
      .expect(201);

    let floor: FloorState = (await waiter.get('/api/v1/floor')).body;
    const four = floor.tables.find((x) => x.id === t.four)!;
    expect(four.status).toBe('reserved');
    expect(four.reservation).toMatchObject({ id: r.id, name: 'Arben Hoxha', partySize: 4 });
    expect(floor.tables.find((x) => x.id === t.six)!.status).toBe('free');

    // The guests arrive and are seated at the reserved table.
    floor = (
      await waiter
        .post('/api/v1/table-sessions')
        .send({ uuid: randomUUID(), tableId: t.four, guestCount: 4, reservationId: r.id })
    ).body;
    const session = floor.tables.find((x) => x.id === t.four)!.session!;
    expect(floor.tables.find((x) => x.id === t.four)!.reservation).toBeNull();
    let seated: Reservation = (await manager.get(`/api/v1/reservations/${r.id}`)).body;
    expect(seated).toMatchObject({ status: 'seated', tableSessionId: session.id });

    await waiter.post(`/api/v1/table-sessions/${session.id}/close`).expect(200);
    seated = (await manager.get(`/api/v1/reservations/${r.id}`)).body;
    expect(seated.status).toBe('completed');
  });

  it('seating at another table than planned moves the reservation there', async () => {
    const r = (
      await manager
        .post('/api/v1/reservations')
        .send(reservation(new Date(Date.now() + 20 * 60_000).toISOString()))
    ).body as Reservation;
    await waiter
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId: t.six, guestCount: 4, reservationId: r.id })
      .expect(201);
    expect((await manager.get(`/api/v1/reservations/${r.id}`)).body).toMatchObject({
      status: 'seated',
      tableId: t.six,
    });
  });
});

describe('public booking page', () => {
  const pub = (path: string) => `/api/v1/public/locations/${fx.locationId}${path}`;
  const booking = (time: string, partySize = 2, date = tomorrow()) => ({
    uuid: randomUUID(),
    date,
    time,
    partySize,
    name: 'Elona Kola',
    phone: '0691234567',
  });

  it('books the smallest table that fits and runs out when every table is taken', async () => {
    const info: PublicBookingInfo = (await request(app).get(pub('/booking'))).body;
    expect(info).toMatchObject({ enabled: true, maxPartySize: 8 });
    expect(info.dates[1]).toBe(tomorrow());

    const res = await request(app).post(pub('/reservations')).send(booking('19:00', 3));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      time: '19:00',
      partySize: 3,
      reference: expect.stringMatching(/^[A-Z2-9]{6}$/),
    });
    const saved = await db('reservations').where({ reference: res.body.reference }).first();
    expect(saved).toMatchObject({ table_id: t.four, source: 'widget', status: 'booked' });

    // The same request again (double tap) does not book twice.
    const body = booking('19:00', 2);
    await request(app).post(pub('/reservations')).send(body).expect(201);
    await request(app).post(pub('/reservations')).send(body).expect(201);
    expect(await db('reservations').count({ n: '*' }).first()).toMatchObject({ n: 2 });

    await request(app).post(pub('/reservations')).send(booking('19:00', 2)).expect(201); // table 3
    const full = await request(app).post(pub('/reservations')).send(booking('19:30', 2));
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('NO_AVAILABILITY');

    const avail: PublicAvailability = (
      await request(app).get(pub(`/availability?date=${tomorrow()}&partySize=2`))
    ).body;
    const slot = (time: string) => avail.slots.find((s) => s.time === time)!;
    expect(slot('19:00').available).toBe(false);
    expect(slot('20:30').available).toBe(true);
    // Guests never see which tables are free.
    expect(Object.keys(slot('20:30'))).toEqual(['time', 'available']);
  });

  it('refuses times outside the slots, in the past or too soon, and parties above the limit', async () => {
    const today = localParts(new Date(), TZ).date;
    expect(
      (await request(app).post(pub('/reservations')).send(booking('19:10'))).body.error.code,
    ).toBe('NO_AVAILABILITY');
    expect(
      (
        await request(app)
          .post(pub('/reservations'))
          .send(booking('19:00', 2, addDays(today, -1)))
      ).status,
    ).toBe(409);
    expect((await request(app).post(pub('/reservations')).send(booking('19:00', 9))).status).toBe(
      409,
    );
    const tooFar = await request(app)
      .post(pub('/reservations'))
      .send(booking('19:00', 2, addDays(today, 61)));
    expect(tooFar.status).toBe(409);
    const big: PublicAvailability = (
      await request(app).get(pub(`/availability?date=${tomorrow()}&partySize=9`))
    ).body;
    expect(big.slots).toEqual([]);
  });

  it('the manager can turn online booking off', async () => {
    await setSettings({ bookingEnabled: false });
    expect((await request(app).get(pub('/booking'))).body).toMatchObject({
      enabled: false,
      dates: [],
    });
    const res = await request(app).post(pub('/reservations')).send(booking('19:00'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BOOKING_DISABLED');
  });
});
