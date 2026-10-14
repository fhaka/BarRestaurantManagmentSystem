import { z } from 'zod';
import type { LocationSettings } from './locations.js';
import { addDays, timeToMinutes, weekdayOf, zonedDateTime } from './time.js';

// ---- Status (plan §5.10) -----------------------------------------------------------------------

export const RESERVATION_STATUSES = [
  'booked',
  'confirmed',
  'seated',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that hold a table. */
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'booked',
  'confirmed',
  'seated',
];

const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  booked: ['confirmed', 'seated', 'no_show', 'cancelled'],
  confirmed: ['booked', 'seated', 'no_show', 'cancelled'],
  seated: ['completed'],
  completed: [],
  // A no-show who turns up after all, or a cancellation taken back, goes back on the book.
  no_show: ['booked'],
  cancelled: ['booked'],
};

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

export const RESERVATION_SOURCES = ['staff', 'widget'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

/** Plan §5.10: a reserved table shows on the floor from 60 minutes before arrival… */
export const RESERVED_LEAD_MINUTES = 60;
/** …until 30 minutes after the booked time, when the guests are probably not coming. */
export const RESERVED_GRACE_MINUTES = 30;

export function isReservedSoon(startsAt: Date, now: Date): boolean {
  const diff = (startsAt.getTime() - now.getTime()) / 60_000;
  return diff <= RESERVED_LEAD_MINUTES && diff >= -RESERVED_GRACE_MINUTES;
}

// ---- Availability ------------------------------------------------------------------------------

export interface TimeRange {
  start: Date;
  end: Date;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

type OpeningHours = LocationSettings['openingHours'];
type BookingRules = Pick<LocationSettings, 'bookingSlotMinutes' | 'bookingLastSeatingMin'>;

/**
 * When the location is open on a local date: one range per opening-hours row for that weekday.
 * A closing time at or before the opening time means after midnight.
 */
export function openRanges(date: string, hours: OpeningHours, timeZone: string): TimeRange[] {
  const weekday = weekdayOf(date);
  return hours
    .filter((h) => h.weekday === weekday)
    .map((h) => {
      const open = timeToMinutes(h.open);
      let close = timeToMinutes(h.close);
      if (close <= open) close += 24 * 60;
      return {
        start: zonedDateTime(date, open, timeZone),
        end: zonedDateTime(date, close, timeZone),
      };
    });
}

/** Start times guests can book on a date: every slot from opening until the last seating. */
export function bookingSlots(
  date: string,
  hours: OpeningHours,
  rules: BookingRules,
  timeZone: string,
): Date[] {
  const out: Date[] = [];
  for (const range of openRanges(date, hours, timeZone)) {
    const last = range.end.getTime() - rules.bookingLastSeatingMin * 60_000;
    for (let t = range.start.getTime(); t <= last; t += rules.bookingSlotMinutes * 60_000) {
      out.push(new Date(t));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export interface BookableTable {
  id: number;
  seats: number;
}

export interface TableBooking extends TimeRange {
  reservationId: number;
  tableId: number;
}

/** Tables with no active reservation overlapping `range` (optionally ignoring one reservation). */
export function freeTableIds(
  tables: readonly BookableTable[],
  bookings: readonly TableBooking[],
  range: TimeRange,
  excludeReservationId?: number | null,
): number[] {
  const busy = new Set(
    bookings
      .filter((b) => b.reservationId !== excludeReservationId && rangesOverlap(b, range))
      .map((b) => b.tableId),
  );
  return tables.filter((t) => !busy.has(t.id)).map((t) => t.id);
}

/**
 * The table an online booking gets: the smallest free table that seats the party (fewest empty
 * chairs), then the lowest id. Null when nothing fits.
 */
export function pickTable(
  tables: readonly BookableTable[],
  bookings: readonly TableBooking[],
  range: TimeRange,
  partySize: number,
): number | null {
  const free = new Set(freeTableIds(tables, bookings, range));
  const fits = tables
    .filter((t) => free.has(t.id) && t.seats >= partySize)
    .sort((a, b) => a.seats - b.seats || a.id - b.id);
  return fits[0]?.id ?? null;
}

/** The dates the public page offers: today up to `maxDaysAhead` days later. */
export function bookingDates(today: string, maxDaysAhead: number): string[] {
  return Array.from({ length: maxDaysAhead + 1 }, (_, i) => addDays(today, i));
}

// ---- Schemas -----------------------------------------------------------------------------------

const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{6,20}$/, { message: 'phone' });
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time' });

const reservationFields = {
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(15).max(480),
  partySize: z.number().int().min(1).max(99),
  name: z.string().trim().min(2).max(120),
  phone,
  notes: z.string().trim().max(500).nullish(),
  /** Null = not given a table yet. */
  tableId: z.number().int().positive().nullable().default(null),
};

export const reservationCreateSchema = z.object({ uuid: z.uuid(), ...reservationFields });
export const reservationUpdateSchema = z.object(reservationFields);
export const reservationStatusSchema = z.object({ status: z.enum(RESERVATION_STATUSES) });

export const availabilityQuerySchema = z.object({
  date,
  partySize: z.coerce.number().int().min(1).max(99).default(2),
  durationMin: z.coerce.number().int().min(15).max(480).optional(),
  excludeId: z.coerce.number().int().positive().optional(),
});

/** The public booking page (no account). */
export const publicBookingSchema = z.object({
  uuid: z.uuid(),
  date,
  time,
  partySize: z.number().int().min(1).max(50),
  name: z.string().trim().min(2).max(120),
  phone,
  notes: z.string().trim().max(500).nullish(),
});

// ---- Response types ----------------------------------------------------------------------------

export interface Reservation {
  id: number;
  uuid: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  partySize: number;
  name: string;
  phone: string;
  notes: string | null;
  status: ReservationStatus;
  source: ReservationSource;
  tableId: number | null;
  tableName: string | null;
  areaName: string | null;
  tableSessionId: number | null;
  createdAt: string;
  createdByName: string | null;
}

export interface AvailabilitySlot {
  /** Local "19:30". */
  time: string;
  startsAt: string;
  /** Free tables for the whole duration (staff view). */
  freeTableIds: number[];
  /** Some free table seats the party, and the slot is not in the past. */
  available: boolean;
}

export interface PublicBookingInfo {
  locationId: number;
  name: string;
  address: string;
  enabled: boolean;
  maxPartySize: number;
  dates: string[];
}

export interface PublicAvailability {
  date: string;
  slots: { time: string; available: boolean }[];
}

export interface PublicBookingResult {
  reference: string;
  locationName: string;
  startsAt: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
}

/** On the floor plan: the reservation a table is held for (plan §5.10). */
export interface FloorReservation {
  id: number;
  name: string;
  partySize: number;
  startsAt: string;
  status: ReservationStatus;
}

export interface ReservationUpdatedData {
  reservationIds: number[];
}
