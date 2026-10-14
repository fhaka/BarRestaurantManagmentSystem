import { randomInt } from 'node:crypto';
import type { Knex } from 'knex';
import {
  ACTIVE_RESERVATION_STATUSES,
  RESERVED_GRACE_MINUTES,
  RESERVED_LEAD_MINUTES,
  addDays,
  availabilityQuerySchema,
  bookingDates,
  bookingSlots,
  canTransitionReservation,
  freeTableIds,
  isReservedSoon,
  localParts,
  localTime,
  pickTable,
  publicBookingSchema,
  reservationCreateSchema,
  reservationStatusSchema,
  reservationUpdateSchema,
  timeToMinutes,
  zonedDateTime,
  type AvailabilitySlot,
  type BookableTable,
  type FloorReservation,
  type Location,
  type Permission,
  type PublicAvailability,
  type PublicBookingInfo,
  type PublicBookingResult,
  type Reservation,
  type ReservationStatus,
  type TableBooking,
  type TimeRange,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emit, emitTableUpdated } from '../../realtime/server.js';
import * as locationRepo from '../locations/repo.js';

export interface ReservationActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Tx = Knex | Knex.Transaction;
const num = (v: unknown) => Number(v);
const iso = (v: unknown) => (v as Date).toISOString();
const DAY_START_MIN = 4 * 60; // the day view runs 04:00 → 04:00, like the business day

async function location(id: number, trx: Tx = db): Promise<Location> {
  const loc = await locationRepo.findLocation(id, trx as Knex);
  if (!loc) throw AppError.notFound('Location not found');
  return loc;
}

function toReservation(r: Record<string, unknown>): Reservation {
  return {
    id: num(r.id),
    uuid: String(r.uuid),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    durationMin: num(r.duration_min),
    partySize: num(r.party_size),
    name: String(r.name),
    phone: String(r.phone),
    notes: (r.notes as string | null) ?? null,
    status: r.status as ReservationStatus,
    source: r.source as Reservation['source'],
    tableId: r.table_id === null ? null : num(r.table_id),
    tableName: (r.table_name as string | null) ?? null,
    areaName: (r.area_name as string | null) ?? null,
    tableSessionId: r.table_session_id === null ? null : num(r.table_session_id),
    createdAt: iso(r.created_at),
    createdByName: (r.created_by_name as string | null) ?? null,
  };
}

const reservationQuery = (trx: Tx, locationId: number) =>
  trx('reservations as r')
    .leftJoin('tables as t', 't.id', 'r.table_id')
    .leftJoin('areas as a', 'a.id', 't.area_id')
    .leftJoin('users as u', 'u.id', 'r.created_by')
    .where('r.location_id', locationId)
    .select('r.*', 't.name as table_name', 'a.name as area_name', 'u.name as created_by_name');

async function loadReservation(trx: Tx, locationId: number, id: number): Promise<Reservation> {
  const row = await reservationQuery(trx, locationId).where('r.id', id).first();
  if (!row) throw AppError.notFound('Reservation not found');
  return toReservation(row);
}

function dayRange(date: string, timeZone: string): TimeRange {
  return {
    start: zonedDateTime(date, DAY_START_MIN, timeZone),
    end: zonedDateTime(addDays(date, 1), DAY_START_MIN, timeZone),
  };
}

export async function listReservations(
  actor: ReservationActor,
  date: string,
): Promise<Reservation[]> {
  const loc = await location(actor.locationId);
  const range = dayRange(date, loc.timezone);
  const rows = await reservationQuery(db, actor.locationId)
    .where('r.starts_at', '>=', range.start)
    .where('r.starts_at', '<', range.end)
    .orderBy([{ column: 'r.starts_at' }, { column: 'r.id' }]);
  return rows.map(toReservation);
}

export const getReservation = (actor: ReservationActor, id: number) =>
  loadReservation(db, actor.locationId, id);

// ---- Tables and conflicts ----------------------------------------------------------------------

async function bookableTables(trx: Tx, locationId: number): Promise<BookableTable[]> {
  return (
    await trx('tables')
      .where({ location_id: locationId, active: true })
      .whereNull('deleted_at')
      .orderBy('id')
      .select('id', 'seats')
  ).map((t) => ({ id: num(t.id), seats: num(t.seats) }));
}

/** Active reservations with a table that overlap `range`. */
async function tableBookings(
  trx: Tx,
  locationId: number,
  range: TimeRange,
): Promise<TableBooking[]> {
  const rows = await trx('reservations')
    .where({ location_id: locationId })
    .whereIn('status', ACTIVE_RESERVATION_STATUSES)
    .whereNotNull('table_id')
    .where('starts_at', '<', range.end)
    .where('ends_at', '>', range.start)
    .select('id', 'table_id', 'starts_at', 'ends_at');
  return rows.map((r) => ({
    reservationId: num(r.id),
    tableId: num(r.table_id),
    start: r.starts_at as Date,
    end: r.ends_at as Date,
  }));
}

/**
 * Conflict detection (plan §5.10): a table holds one active reservation at a time. The table row
 * is locked first, so two people booking the same table at once cannot both succeed.
 */
async function assertTableFree(
  trx: Knex.Transaction,
  locationId: number,
  tableId: number,
  range: TimeRange,
  excludeId: number | null,
) {
  const table = await trx('tables')
    .where({ id: tableId, location_id: locationId })
    .whereNull('deleted_at')
    .forUpdate()
    .first('id', 'active');
  if (!table || !table.active) {
    throw new AppError(400, 'INVALID_REFERENCE', 'Choose a table at this location.', {
      field: 'tableId',
    });
  }
  const clash = (await tableBookings(trx, locationId, range)).find(
    (b) => b.tableId === tableId && b.reservationId !== excludeId,
  );
  if (clash) {
    const other = await trx('reservations')
      .where({ id: clash.reservationId })
      .first('name', 'starts_at');
    throw AppError.conflict(
      'RESERVATION_CONFLICT',
      'This table is already reserved at that time.',
      {
        reservationId: clash.reservationId,
        name: other?.name,
        startsAt: iso(other?.starts_at),
      },
    );
  }
}

// ---- Availability ------------------------------------------------------------------------------

async function slotsFor(
  loc: Location,
  date: string,
  partySize: number,
  durationMin: number,
  excludeId: number | null,
  earliest: Date | null,
): Promise<AvailabilitySlot[]> {
  const starts = bookingSlots(date, loc.settings.openingHours, loc.settings, loc.timezone);
  if (!starts.length) return [];
  const tables = await bookableTables(db, loc.id);
  const bookings = await tableBookings(db, loc.id, {
    start: starts[0]!,
    end: new Date(starts.at(-1)!.getTime() + durationMin * 60_000),
  });
  const seats = new Map(tables.map((t) => [t.id, t.seats]));
  return starts.map((start) => {
    const range = { start, end: new Date(start.getTime() + durationMin * 60_000) };
    const free = freeTableIds(tables, bookings, range, excludeId);
    return {
      time: localTime(start, loc.timezone),
      startsAt: start.toISOString(),
      freeTableIds: free,
      available:
        (earliest === null || start >= earliest) &&
        free.some((id) => (seats.get(id) ?? 0) >= partySize),
    };
  });
}

/** Staff view: every slot of the day with the tables free for the whole stay. */
export async function availability(
  actor: ReservationActor,
  raw: unknown,
): Promise<AvailabilitySlot[]> {
  const q = availabilityQuerySchema.parse(raw);
  const loc = await location(actor.locationId);
  return slotsFor(
    loc,
    q.date,
    q.partySize,
    q.durationMin ?? loc.settings.bookingDurationMin,
    q.excludeId ?? null,
    null,
  );
}

// ---- Staff changes -----------------------------------------------------------------------------

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newReference = () =>
  Array.from({ length: 6 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join(
    '',
  );

function changed(locationId: number, reservationIds: number[], tableIds: (number | null)[]) {
  emit('reservation.updated', locationId, { reservationIds });
  const tables = tableIds.filter((t): t is number => t !== null);
  if (tables.length) emitTableUpdated(locationId, tables);
}

async function insertReservation(
  trx: Knex.Transaction,
  locationId: number,
  row: {
    uuid: string;
    tableId: number | null;
    name: string;
    phone: string;
    partySize: number;
    start: Date;
    durationMin: number;
    notes: string | null;
    source: 'staff' | 'widget';
    createdBy: number | null;
  },
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      const [id] = await trx('reservations').insert({
        uuid: row.uuid,
        location_id: locationId,
        table_id: row.tableId,
        name: row.name,
        phone: row.phone,
        party_size: row.partySize,
        starts_at: row.start,
        duration_min: row.durationMin,
        ends_at: new Date(row.start.getTime() + row.durationMin * 60_000),
        notes: row.notes,
        source: row.source,
        reference: newReference(),
        created_by: row.createdBy,
      });
      return num(id);
    } catch (err) {
      // A reference collision (1 in a billion per day) just picks another one.
      if (
        (err as { code?: string }).code === 'ER_DUP_ENTRY' &&
        attempt < 3 &&
        String(err).includes('reference')
      )
        continue;
      throw err;
    }
  }
}

export async function createReservation(
  actor: ReservationActor,
  raw: unknown,
): Promise<Reservation> {
  const input = reservationCreateSchema.parse(raw);
  const existing = await db('reservations').where({ uuid: input.uuid }).first('id', 'location_id');
  if (existing) {
    if (num(existing.location_id) !== actor.locationId)
      throw AppError.conflict('CONFLICT', 'This id is already used.');
    return loadReservation(db, actor.locationId, num(existing.id));
  }
  const start = new Date(input.startsAt);
  const range = { start, end: new Date(start.getTime() + input.durationMin * 60_000) };
  const id = await transactionWithRetry(async (trx) => {
    if (input.tableId) await assertTableFree(trx, actor.locationId, input.tableId, range, null);
    const newId = await insertReservation(trx, actor.locationId, {
      uuid: input.uuid,
      tableId: input.tableId,
      name: input.name,
      phone: input.phone,
      partySize: input.partySize,
      start,
      durationMin: input.durationMin,
      notes: input.notes ?? null,
      source: 'staff',
      createdBy: actor.userId,
    });
    await writeAudit(
      actor,
      { action: 'reservation.created', entityType: 'reservation', entityId: newId },
      trx,
    );
    return newId;
  });
  changed(actor.locationId, [id], [input.tableId]);
  return loadReservation(db, actor.locationId, id);
}

export async function updateReservation(
  actor: ReservationActor,
  id: number,
  raw: unknown,
): Promise<Reservation> {
  const input = reservationUpdateSchema.parse(raw);
  const start = new Date(input.startsAt);
  const range = { start, end: new Date(start.getTime() + input.durationMin * 60_000) };
  let oldTable: number | null = null;
  await transactionWithRetry(async (trx) => {
    const before = await trx('reservations')
      .where({ id, location_id: actor.locationId })
      .forUpdate()
      .first();
    if (!before) throw AppError.notFound('Reservation not found');
    if (!['booked', 'confirmed'].includes(before.status)) {
      throw AppError.conflict('RESERVATION_STATE', 'Only upcoming reservations can be changed.');
    }
    oldTable = before.table_id === null ? null : num(before.table_id);
    if (input.tableId) await assertTableFree(trx, actor.locationId, input.tableId, range, id);
    await trx('reservations')
      .where({ id })
      .update({
        table_id: input.tableId,
        name: input.name,
        phone: input.phone,
        party_size: input.partySize,
        starts_at: start,
        duration_min: input.durationMin,
        ends_at: range.end,
        notes: input.notes ?? null,
      });
    await writeAudit(
      actor,
      {
        action: 'reservation.updated',
        entityType: 'reservation',
        entityId: id,
        before: {
          startsAt: iso(before.starts_at),
          tableId: oldTable,
          partySize: num(before.party_size),
        },
        after: { startsAt: input.startsAt, tableId: input.tableId, partySize: input.partySize },
      },
      trx,
    );
  });
  changed(actor.locationId, [id], [oldTable, input.tableId]);
  return loadReservation(db, actor.locationId, id);
}

/**
 * Confirm, cancel, no-show, complete or put back on the book. "Seated" happens by opening the
 * table for the reservation (the floor), so the reservation is linked to the table session.
 */
export async function setStatus(
  actor: ReservationActor,
  id: number,
  raw: unknown,
): Promise<Reservation> {
  const { status } = reservationStatusSchema.parse(raw);
  if (status === 'seated') {
    throw AppError.conflict('RESERVATION_STATE', 'Seat a reservation by opening its table.');
  }
  let tableId: number | null = null;
  await transactionWithRetry(async (trx) => {
    const r = await trx('reservations')
      .where({ id, location_id: actor.locationId })
      .forUpdate()
      .first();
    if (!r) throw AppError.notFound('Reservation not found');
    if (!canTransitionReservation(r.status, status)) {
      throw AppError.conflict(
        'RESERVATION_STATE',
        `A ${r.status} reservation cannot become ${status}.`,
      );
    }
    tableId = r.table_id === null ? null : num(r.table_id);
    // Back on the book: the table must still be free at that time.
    if (status === 'booked' && tableId && !ACTIVE_RESERVATION_STATUSES.includes(r.status)) {
      await assertTableFree(
        trx,
        actor.locationId,
        tableId,
        { start: r.starts_at, end: r.ends_at },
        id,
      );
    }
    await trx('reservations').where({ id }).update({ status });
    await writeAudit(
      actor,
      {
        action: `reservation.${status}`,
        entityType: 'reservation',
        entityId: id,
        before: { status: r.status },
      },
      trx,
    );
  });
  changed(actor.locationId, [id], [tableId]);
  return loadReservation(db, actor.locationId, id);
}

// ---- Floor integration (called by table sessions) ----------------------------------------------

/** Reservations to show on tables now: booked/confirmed, from 60 minutes before arrival. */
export async function floorReservations(
  locationId: number,
  now = new Date(),
): Promise<Map<number, FloorReservation>> {
  const rows = await db('reservations')
    .where({ location_id: locationId })
    .whereIn('status', ['booked', 'confirmed'])
    .whereNotNull('table_id')
    .where('starts_at', '<=', new Date(now.getTime() + RESERVED_LEAD_MINUTES * 60_000))
    .where('starts_at', '>=', new Date(now.getTime() - RESERVED_GRACE_MINUTES * 60_000))
    .orderBy('starts_at')
    .select('id', 'table_id', 'name', 'party_size', 'starts_at', 'status');
  const out = new Map<number, FloorReservation>();
  for (const r of rows) {
    const tableId = num(r.table_id);
    if (out.has(tableId) || !isReservedSoon(r.starts_at, now)) continue;
    out.set(tableId, {
      id: num(r.id),
      name: String(r.name),
      partySize: num(r.party_size),
      startsAt: iso(r.starts_at),
      status: r.status,
    });
  }
  return out;
}

/** Opening a table for a reservation: it becomes seated, at that table, linked to the session. */
export async function seatInSession(
  trx: Knex.Transaction,
  locationId: number,
  reservationId: number,
  tableId: number,
  sessionId: number,
) {
  const r = await trx('reservations')
    .where({ id: reservationId, location_id: locationId })
    .forUpdate()
    .first();
  if (!r)
    throw new AppError(400, 'INVALID_REFERENCE', 'Reservation not found.', {
      field: 'reservationId',
    });
  if (!canTransitionReservation(r.status, 'seated')) {
    throw AppError.conflict('RESERVATION_STATE', `A ${r.status} reservation cannot be seated.`);
  }
  if (r.table_id !== null && num(r.table_id) !== tableId) {
    // Seated somewhere else than planned: the planned table must not be double-booked.
    await assertTableFree(
      trx,
      locationId,
      tableId,
      { start: new Date(), end: r.ends_at },
      reservationId,
    );
  }
  await trx('reservations')
    .where({ id: reservationId })
    .update({ status: 'seated', table_id: tableId, table_session_id: sessionId });
}

/** The table session closed: its seated reservation is completed. */
export async function completeForSession(
  trx: Knex.Transaction,
  sessionId: number,
): Promise<number[]> {
  const ids = (
    await trx('reservations').where({ table_session_id: sessionId, status: 'seated' }).select('id')
  ).map((r) => num(r.id));
  if (ids.length) await trx('reservations').whereIn('id', ids).update({ status: 'completed' });
  return ids;
}

export const reservationsChanged = changed;

// ---- Public booking page -----------------------------------------------------------------------

async function publicLocation(locationId: number): Promise<Location> {
  const loc = await locationRepo.findLocation(locationId);
  if (!loc) throw AppError.notFound('Location not found');
  return loc;
}

const today = (loc: Location, now: Date) => localParts(now, loc.timezone).date;

export async function publicInfo(locationId: number, now = new Date()): Promise<PublicBookingInfo> {
  const loc = await publicLocation(locationId);
  return {
    locationId: loc.id,
    name: loc.name,
    address: loc.address,
    enabled: loc.settings.bookingEnabled,
    maxPartySize: loc.settings.bookingMaxPartySize,
    dates: loc.settings.bookingEnabled
      ? bookingDates(today(loc, now), loc.settings.bookingMaxDaysAhead)
      : [],
  };
}

function assertBookable(loc: Location) {
  if (!loc.settings.bookingEnabled) {
    throw new AppError(403, 'BOOKING_DISABLED', 'Online booking is turned off. Please call us.');
  }
}

function inWindow(loc: Location, date: string, now: Date) {
  const dates = bookingDates(today(loc, now), loc.settings.bookingMaxDaysAhead);
  return dates.includes(date);
}

export async function publicAvailability(
  locationId: number,
  raw: unknown,
  now = new Date(),
): Promise<PublicAvailability> {
  const q = availabilityQuerySchema.parse(raw);
  const loc = await publicLocation(locationId);
  assertBookable(loc);
  if (!inWindow(loc, q.date, now) || q.partySize > loc.settings.bookingMaxPartySize) {
    return { date: q.date, slots: [] };
  }
  const earliest = new Date(now.getTime() + loc.settings.bookingMinNoticeMin * 60_000);
  const slots = await slotsFor(
    loc,
    q.date,
    q.partySize,
    loc.settings.bookingDurationMin,
    null,
    earliest,
  );
  // Guests only learn whether a time works, not which tables are free.
  return { date: q.date, slots: slots.map((s) => ({ time: s.time, available: s.available })) };
}

/** A guest books online: the smallest free table that fits is held for them. */
export async function publicBook(
  locationId: number,
  raw: unknown,
  now = new Date(),
): Promise<PublicBookingResult> {
  const input = publicBookingSchema.parse(raw);
  const loc = await publicLocation(locationId);
  assertBookable(loc);
  const result = (id: number, ref: string, start: Date): PublicBookingResult => ({
    reference: ref,
    locationName: loc.name,
    startsAt: start.toISOString(),
    date: input.date,
    time: localTime(start, loc.timezone),
    partySize: input.partySize,
    name: input.name,
  });

  const existing = await db('reservations')
    .where({ uuid: input.uuid })
    .first('id', 'location_id', 'reference', 'starts_at');
  if (existing && num(existing.location_id) === loc.id) {
    return result(num(existing.id), String(existing.reference), existing.starts_at);
  }
  if (existing) throw AppError.conflict('CONFLICT', 'This id is already used.');

  const unavailable = () =>
    AppError.conflict(
      'NO_AVAILABILITY',
      'That time is no longer available. Please choose another.',
    );
  const start = zonedDateTime(input.date, timeToMinutes(input.time), loc.timezone);
  const slot = bookingSlots(input.date, loc.settings.openingHours, loc.settings, loc.timezone).some(
    (s) => s.getTime() === start.getTime(),
  );
  const earliest = new Date(now.getTime() + loc.settings.bookingMinNoticeMin * 60_000);
  if (
    !slot ||
    !inWindow(loc, input.date, now) ||
    start < earliest ||
    input.partySize > loc.settings.bookingMaxPartySize
  ) {
    throw unavailable();
  }
  const durationMin = loc.settings.bookingDurationMin;
  const range = { start, end: new Date(start.getTime() + durationMin * 60_000) };

  const id = await transactionWithRetry(async (trx) => {
    // Lock the location's tables in id order so concurrent online bookings queue up.
    const tables = await trx('tables')
      .where({ location_id: loc.id, active: true })
      .whereNull('deleted_at')
      .orderBy('id')
      .forUpdate()
      .select('id', 'seats');
    const tableId = pickTable(
      tables.map((t) => ({ id: num(t.id), seats: num(t.seats) })),
      await tableBookings(trx, loc.id, range),
      range,
      input.partySize,
    );
    if (tableId === null) throw unavailable();
    return insertReservation(trx, loc.id, {
      uuid: input.uuid,
      tableId,
      name: input.name,
      phone: input.phone,
      partySize: input.partySize,
      start,
      durationMin,
      notes: input.notes ?? null,
      source: 'widget',
      createdBy: null,
    });
  });
  const row = await db('reservations').where({ id }).first('reference', 'table_id');
  changed(loc.id, [id], [num(row.table_id)]);
  return result(id, String(row.reference), start);
}
