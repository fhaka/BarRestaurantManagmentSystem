import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  localParts,
  weekStart,
  zonedDateTime,
  type ClockResult,
  type ClockStatus,
  type HoursRow,
  type PinUser,
  type Shift,
  type TimeEntry,
} from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, PINS, resetAndSeed, type Fixture, type Session } from '../../test/fixtures.js';

const app = createApp();
const TZ = 'Europe/Tirane';
let fx: Fixture;
let managerSession: Session;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
const today = () => localParts(new Date(), TZ).date;
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedDateTime(date, h! * 60 + m!, TZ).toISOString();
};

beforeEach(async () => {
  fx = await resetAndSeed();
  managerSession = await login(app, fx.users.manager.email);
  manager = as(app, managerSession, fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
});

describe('clock in / out (plan §5.8)', () => {
  it('the signed-in person clocks in once and out again', async () => {
    let status: ClockStatus = (await waiter.get('/api/v1/me/clock')).body;
    expect(status.clockedIn).toBe(false);
    const inRes = await waiter.post('/api/v1/time-entries/clock-in');
    expect(inRes.status).toBe(201);
    expect((inRes.body as ClockResult).action).toBe('in');
    const twice = await waiter.post('/api/v1/time-entries/clock-in');
    expect(twice.body.error.code).toBe('ALREADY_CLOCKED_IN');
    status = (await waiter.get('/api/v1/me/clock')).body;
    expect(status).toMatchObject({
      clockedIn: true,
      entry: { userName: 'Test waiter', clockOut: null },
    });
    const out: ClockResult = (await waiter.post('/api/v1/time-entries/clock-out')).body;
    expect(out.action).toBe('out');
    expect(out.entry.clockOut).not.toBeNull();
    expect((await waiter.post('/api/v1/time-entries/clock-out')).body.error.code).toBe(
      'NOT_CLOCKED_IN',
    );
  });

  it('on the shared device, a PIN toggles clock in/out without changing who is signed in', async () => {
    const pinClock = (pin: string) =>
      request(app)
        .post('/api/v1/auth/pin-clock')
        .set('Cookie', managerSession.cookie)
        .send({ userId: fx.users.waiter.id, pin, locationId: fx.locationId });

    const first = await pinClock(PINS.waiter);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      action: 'in',
      userName: 'Test waiter',
      entry: { source: 'pin' },
    });
    const users: PinUser[] = (
      await request(app)
        .get(`/api/v1/auth/pin-users?locationId=${fx.locationId}`)
        .set('Cookie', managerSession.cookie)
    ).body;
    expect(users.find((u) => u.id === fx.users.waiter.id)!.clockedIn).toBe(true);
    expect(users.find((u) => u.id === fx.users.manager.id)!.clockedIn).toBe(false);

    expect((await pinClock(PINS.waiter)).body.action).toBe('out');
    const wrong = await pinClock('9999');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_PIN');
    // Without the device's sign-in cookie nobody can clock.
    const noDevice = await request(app)
      .post('/api/v1/auth/pin-clock')
      .send({ userId: fx.users.waiter.id, pin: PINS.waiter, locationId: fx.locationId });
    expect(noDevice.status).toBe(401);
    expect(
      await db('audit_logs').where({ action: 'time_entry.clock_in' }).count({ n: '*' }).first(),
    ).toMatchObject({ n: 1 });
  });
});

describe('shifts', () => {
  it('managers schedule the week; a person cannot be on two shifts at once', async () => {
    const monday = weekStart(today());
    const shift = (date: string, from: string, to: string, userId = fx.users.waiter.id) => ({
      userId,
      startsAt: at(date, from),
      endsAt: at(date, to),
    });
    const created = await manager.post('/api/v1/shifts').send(shift(monday, '08:00', '16:00'));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ userName: 'Test waiter', roleKey: 'waiter' });
    const clash = await manager.post('/api/v1/shifts').send(shift(monday, '15:00', '23:00'));
    expect(clash.body.error.code).toBe('SHIFT_OVERLAP');
    await manager
      .post('/api/v1/shifts')
      .send(shift(monday, '16:00', '23:00'))
      .expect(201);
    await manager
      .post('/api/v1/shifts')
      .send(shift(addDays(monday, 2), '16:00', '23:00', fx.users.cashier.id))
      .expect(201);
    const tooLong = await manager
      .post('/api/v1/shifts')
      .send(shift(addDays(monday, 3), '06:00', '23:30'));
    expect(tooLong.status).toBe(400);

    const week: Shift[] = (
      await manager.get(`/api/v1/shifts?from=${monday}&to=${addDays(monday, 6)}`)
    ).body;
    expect(week.map((s) => [s.userName, s.startsAt])).toEqual([
      ['Test waiter', at(monday, '08:00')],
      ['Test waiter', at(monday, '16:00')],
      ['Test cashier', at(addDays(monday, 2), '16:00')],
    ]);
    // Staff see their own schedule only; they cannot change it.
    const mine: Shift[] = (
      await waiter.get(`/api/v1/me/shifts?from=${monday}&to=${addDays(monday, 6)}`)
    ).body;
    expect(mine).toHaveLength(2);
    expect((await waiter.get(`/api/v1/shifts?from=${monday}&to=${monday}`)).status).toBe(403);
    expect((await waiter.post('/api/v1/shifts').send(shift(monday, '23:00', '23:30'))).status).toBe(
      403,
    );
  });
});

describe('hours report and payroll export', () => {
  it('sums worked and scheduled time per person; corrections are audited; CSV has decimal hours', async () => {
    const day = addDays(today(), -2);
    const entry = (from: string, to: string | null, userId = fx.users.waiter.id) => ({
      userId,
      clockIn: at(day, from),
      clockOut: to ? at(day, to) : null,
    });
    await manager
      .post('/api/v1/shifts')
      .send({ userId: fx.users.waiter.id, startsAt: at(day, '08:00'), endsAt: at(day, '16:00') })
      .expect(201);
    const e1: TimeEntry = (await manager.post('/api/v1/time-entries').send(entry('07:55', '12:00')))
      .body;
    expect(e1).toMatchObject({ minutes: 245, source: 'manager', editedByName: 'Test manager' });
    await manager.post('/api/v1/time-entries').send(entry('12:30', '16:10')).expect(201);
    const overlap = await manager.post('/api/v1/time-entries').send(entry('11:00', '13:00'));
    expect(overlap.body.error.code).toBe('SHIFT_OVERLAP');
    // Forgot to clock out at the other end: the manager fixes it.
    await manager
      .patch(`/api/v1/time-entries/${e1.id}`)
      .send({ ...entry('07:55', '12:15'), note: 'Doli 12:15' })
      .expect(200);
    expect(
      await db('audit_logs')
        .where({ action: 'time_entry.updated', entity_id: String(e1.id) })
        .first(),
    ).toBeTruthy();

    const range = `from=${day}&to=${today()}`;
    const rows: HoursRow[] = (await manager.get(`/api/v1/time-entries/hours?${range}`)).body;
    expect(rows.find((r) => r.userId === fx.users.waiter.id)).toMatchObject({
      workedMinutes: 260 + 220, // 07:55–12:15 + 12:30–16:10
      scheduledMinutes: 480,
      entries: 2,
      openEntries: 0,
    });

    const csv = await manager.get(`/api/v1/time-entries/hours.csv?${range}`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/);
    expect(lines[0]).toBe('Data,Punonjësi,Roli,Hyrja,Dalja,Orë,Shënim');
    expect(lines.slice(1)).toEqual([
      `${day},Test waiter,waiter,07:55,12:15,4.33,Doli 12:15`,
      `${day},Test waiter,waiter,12:30,16:10,3.67,`,
    ]);
  });
});
