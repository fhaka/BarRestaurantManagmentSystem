import { describe, expect, it } from 'vitest';
import { inTimeWindow, localParts, nextLocalTime, weekdayInMask } from './time.js';

const TZ = 'Europe/Tirane';

describe('localParts (Europe/Tirane)', () => {
  it('converts UTC to local time in summer (UTC+2)', () => {
    // Wednesday 2026-07-15 15:30 UTC = 17:30 in Tirana
    expect(localParts(new Date('2026-07-15T15:30:00Z'), TZ)).toEqual({
      weekday: 2,
      minutes: 17 * 60 + 30,
      date: '2026-07-15',
    });
  });

  it('converts UTC to local time in winter (UTC+1)', () => {
    // Sunday 2026-01-04 23:30 UTC = Monday 00:30 in Tirana
    expect(localParts(new Date('2026-01-04T23:30:00Z'), TZ)).toEqual({
      weekday: 0,
      minutes: 30,
      date: '2026-01-05',
    });
  });
});

describe('inTimeWindow', () => {
  it('handles normal windows (end exclusive)', () => {
    expect(inTimeWindow(7 * 60, '07:00', '11:30')).toBe(true);
    expect(inTimeWindow(11 * 60 + 29, '07:00', '11:30')).toBe(true);
    expect(inTimeWindow(11 * 60 + 30, '07:00', '11:30')).toBe(false);
    expect(inTimeWindow(6 * 60 + 59, '07:00', '11:30')).toBe(false);
  });

  it('handles windows that cross midnight', () => {
    expect(inTimeWindow(23 * 60, '22:00', '02:00')).toBe(true);
    expect(inTimeWindow(60, '22:00', '02:00')).toBe(true);
    expect(inTimeWindow(3 * 60, '22:00', '02:00')).toBe(false);
  });

  it('treats a missing window as all day', () => {
    expect(inTimeWindow(5, null, null)).toBe(true);
    expect(inTimeWindow(5, '07:00', null)).toBe(true);
  });
});

describe('weekdayInMask', () => {
  it('reads Monday as bit 0 and Sunday as bit 6', () => {
    const weekdays = 0b0011111; // Mon–Fri
    expect(weekdayInMask(0, weekdays)).toBe(true);
    expect(weekdayInMask(4, weekdays)).toBe(true);
    expect(weekdayInMask(5, weekdays)).toBe(false);
    expect(weekdayInMask(6, weekdays)).toBe(false);
  });
});

describe('nextLocalTime', () => {
  it('returns the next 04:00 local, tomorrow when already past', () => {
    const at = new Date('2026-07-15T20:00:00Z'); // 22:00 local
    expect(nextLocalTime(at, '04:00', TZ).toISOString()).toBe('2026-07-16T02:00:00.000Z');
  });

  it('returns later today when the time has not come yet', () => {
    const at = new Date('2026-07-15T00:30:00Z'); // 02:30 local
    expect(nextLocalTime(at, '04:00', TZ).toISOString()).toBe('2026-07-15T02:00:00.000Z');
  });

  it('is correct across the spring DST change', () => {
    // 2026-03-29: clocks go 02:00 → 03:00 in Tirana. 2026-03-28 22:00 local = 21:00 UTC.
    const at = new Date('2026-03-28T21:00:00Z');
    expect(nextLocalTime(at, '04:00', TZ).toISOString()).toBe('2026-03-29T02:00:00.000Z');
  });
});
