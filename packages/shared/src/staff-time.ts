import { z } from 'zod';
import type { RoleKey } from './permissions.js';

/** A shift or a clock-in longer than this is almost certainly a mistake. */
export const MAX_SHIFT_HOURS = 16;

const instant = z.iso.datetime({ offset: true });
const note = z.string().trim().max(300).nullish();

const longest = (start: string, end: string) =>
  new Date(end).getTime() - new Date(start).getTime() <= MAX_SHIFT_HOURS * 3_600_000;

export const shiftInputSchema = z
  .object({ userId: z.number().int().positive(), startsAt: instant, endsAt: instant, note })
  .refine((s) => new Date(s.endsAt) > new Date(s.startsAt), {
    message: 'timeRange',
    path: ['endsAt'],
  })
  .refine((s) => longest(s.startsAt, s.endsAt), { message: 'shiftTooLong', path: ['endsAt'] });

/** A manager corrects or adds a clock entry (forgotten clock-out, wrong time). */
export const timeEntryInputSchema = z
  .object({
    userId: z.number().int().positive(),
    clockIn: instant,
    clockOut: instant.nullable(),
    note,
  })
  .refine((e) => e.clockOut === null || new Date(e.clockOut) > new Date(e.clockIn), {
    message: 'timeRange',
    path: ['clockOut'],
  })
  .refine((e) => e.clockOut === null || longest(e.clockIn, e.clockOut), {
    message: 'shiftTooLong',
    path: ['clockOut'],
  });

/** Clocking in or out on a shared device with one's PIN (plan §5.8). */
export const pinClockSchema = z.object({
  userId: z.number().int().positive(),
  pin: z.string().regex(/^\d{4,6}$/, { message: 'pin' }),
  locationId: z.number().int().positive(),
});

export const dateRangeQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    userId: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'dateRange', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 92, {
    message: 'dateRange',
    path: ['to'],
  });

// ---- Arithmetic --------------------------------------------------------------------------------

/** Whole minutes between two instants; an open entry runs until `now`. */
export function minutesBetween(start: Date, end: Date | null, now: Date = new Date()): number {
  return Math.max(0, Math.floor(((end ?? now).getTime() - start.getTime()) / 60_000));
}

/** 450 → "7:30". */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 450 → "7.50" (decimal hours, as payroll spreadsheets expect). */
export function decimalHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}

// ---- Response types ----------------------------------------------------------------------------

export interface Shift {
  id: number;
  userId: number;
  userName: string;
  roleKey: RoleKey | null;
  startsAt: string;
  endsAt: string;
  note: string | null;
}

export type TimeEntrySource = 'pin' | 'app' | 'manager';

export interface TimeEntry {
  id: number;
  userId: number;
  userName: string;
  clockIn: string;
  clockOut: string | null;
  /** Worked minutes; for an open entry, up to now. */
  minutes: number;
  note: string | null;
  source: TimeEntrySource;
  editedByName: string | null;
}

export interface ClockStatus {
  clockedIn: boolean;
  entry: TimeEntry | null;
  /** Today's shift, if one is scheduled. */
  shift: Shift | null;
}

export interface ClockResult {
  action: 'in' | 'out';
  userName: string;
  entry: TimeEntry;
}

/** Hours report row: one person over the chosen dates (plan §5.8, payroll export). */
export interface HoursRow {
  userId: number;
  name: string;
  roleKey: RoleKey | null;
  workedMinutes: number;
  scheduledMinutes: number;
  entries: number;
  /** Clocked in and not out (yet, or forgotten). */
  openEntries: number;
}
