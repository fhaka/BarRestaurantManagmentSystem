import { describe, expect, it } from 'vitest';
import {
  bookingSlots,
  canTransitionReservation,
  freeTableIds,
  isReservedSoon,
  openRanges,
  pickTable,
  type TableBooking,
} from './reservations.js';
import { decimalHours, formatDuration, minutesBetween } from './staff-time.js';
import { addDays, localTime, weekStart, weekdayOf, zonedDateTime } from './time.js';

const TZ = 'Europe/Tirane';
const at = (iso: string) => new Date(iso);
const everyDay = (open: string, close: string) =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, open, close }));

describe('local dates and times in Tirana', () => {
  it('converts a local time to the right instant, summer and winter', () => {
    expect(zonedDateTime('2026-10-14', 19 * 60, TZ).toISOString()).toBe('2026-10-14T17:00:00.000Z');
    expect(zonedDateTime('2026-12-01', 19 * 60, TZ).toISOString()).toBe('2026-12-01T18:00:00.000Z');
    // Clocks go forward on 29 March 2026 at 02:00; 03:30 is CEST.
    expect(zonedDateTime('2026-03-29', 3 * 60 + 30, TZ).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    // "26:00" is 02:00 the next night.
    expect(zonedDateTime('2026-10-14', 26 * 60, TZ).toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(localTime(at('2026-10-14T17:30:00Z'), TZ)).toBe('19:30');
  });

  it('does calendar arithmetic on dates', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(weekdayOf('2026-10-14')).toBe(2); // Wednesday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday → Monday
  });
});

describe('booking availability (plan §5.10)', () => {
  it('opening hours become ranges, also past midnight', () => {
    expect(openRanges('2026-10-14', everyDay('07:00', '23:00'), TZ)).toEqual([
      { start: at('2026-10-14T05:00:00Z'), end: at('2026-10-14T21:00:00Z') },
    ]);
    expect(openRanges('2026-10-14', everyDay('18:00', '02:00'), TZ)[0]!.end).toEqual(
      at('2026-10-15T00:00:00Z'),
    );
    expect(openRanges('2026-10-14', [{ weekday: 0, open: '08:00', close: '16:00' }], TZ)).toEqual(
      [],
    );
  });

  it('slots run every N minutes until the last seating', () => {
    const slots = bookingSlots(
      '2026-10-14',
      everyDay('07:00', '23:00'),
      { bookingSlotMinutes: 30, bookingLastSeatingMin: 60 },
      TZ,
    );
    expect(slots).toHaveLength(31); // 07:00 … 22:00
    expect(localTime(slots[0]!, TZ)).toBe('07:00');
    expect(localTime(slots.at(-1)!, TZ)).toBe('22:00');
  });

  const tables = [
    { id: 1, seats: 2 },
    { id: 2, seats: 4 },
    { id: 3, seats: 6 },
  ];
  const booking = (
    reservationId: number,
    tableId: number,
    from: string,
    to: string,
  ): TableBooking => ({
    reservationId,
    tableId,
    start: at(from),
    end: at(to),
  });
  const bookings = [booking(10, 2, '2026-10-14T17:00:00Z', '2026-10-14T18:30:00Z')];
  const range = (from: string, to: string) => ({ start: at(from), end: at(to) });

  it('a table is busy only while bookings overlap; back-to-back is fine', () => {
    expect(
      freeTableIds(tables, bookings, range('2026-10-14T18:00:00Z', '2026-10-14T19:30:00Z')),
    ).toEqual([1, 3]);
    expect(
      freeTableIds(tables, bookings, range('2026-10-14T18:30:00Z', '2026-10-14T20:00:00Z')),
    ).toEqual([1, 2, 3]);
    // Moving reservation 10 itself does not conflict with its old time.
    expect(
      freeTableIds(tables, bookings, range('2026-10-14T17:30:00Z', '2026-10-14T19:00:00Z'), 10),
    ).toEqual([1, 2, 3]);
  });

  it('online bookings get the smallest free table that fits', () => {
    const r = range('2026-10-14T17:30:00Z', '2026-10-14T19:00:00Z');
    expect(pickTable(tables, [], r, 3)).toBe(2);
    expect(pickTable(tables, bookings, r, 3)).toBe(3);
    expect(pickTable(tables, bookings, r, 7)).toBeNull();
  });

  it('a reserved table shows from 60 minutes before until 30 minutes after the time', () => {
    const starts = at('2026-10-14T17:00:00Z');
    expect(isReservedSoon(starts, at('2026-10-14T15:59:00Z'))).toBe(false);
    expect(isReservedSoon(starts, at('2026-10-14T16:00:00Z'))).toBe(true);
    expect(isReservedSoon(starts, at('2026-10-14T17:30:00Z'))).toBe(true);
    expect(isReservedSoon(starts, at('2026-10-14T17:31:00Z'))).toBe(false);
  });

  it('status moves booked → confirmed → seated → completed; seated cannot be cancelled', () => {
    expect(canTransitionReservation('booked', 'confirmed')).toBe(true);
    expect(canTransitionReservation('confirmed', 'seated')).toBe(true);
    expect(canTransitionReservation('seated', 'completed')).toBe(true);
    expect(canTransitionReservation('seated', 'cancelled')).toBe(false);
    expect(canTransitionReservation('completed', 'booked')).toBe(false);
    expect(canTransitionReservation('no_show', 'booked')).toBe(true);
  });
});

describe('hours', () => {
  it('counts whole minutes and formats them for people and payroll', () => {
    expect(minutesBetween(at('2026-10-14T06:58:00Z'), at('2026-10-14T15:03:30Z'))).toBe(485);
    expect(minutesBetween(at('2026-10-14T06:00:00Z'), null, at('2026-10-14T07:30:00Z'))).toBe(90);
    expect(formatDuration(485)).toBe('8:05');
    expect(decimalHours(485)).toBe('8.08');
  });
});
