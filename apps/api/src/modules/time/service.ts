import type { Knex } from 'knex';
import Papa from 'papaparse';
import {
  addDays,
  dateRangeQuerySchema,
  decimalHours,
  localParts,
  localTime,
  minutesBetween,
  shiftInputSchema,
  timeEntryInputSchema,
  zonedDateTime,
  type ClockResult,
  type ClockStatus,
  type HoursRow,
  type Lang,
  type Permission,
  type RoleKey,
  type Shift,
  type TimeEntry,
  type TimeEntrySource,
  type TimeRange,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emit } from '../../realtime/server.js';
import * as locationRepo from '../locations/repo.js';

export interface TimeActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Tx = Knex | Knex.Transaction;
const num = (v: unknown) => Number(v);
const iso = (v: unknown) => (v ? (v as Date).toISOString() : null);

async function timezoneOf(locationId: number): Promise<string> {
  return (await locationRepo.findLocation(locationId))?.timezone ?? 'Europe/Tirane';
}

/** Local dates `from`…`to` (inclusive) as an instant range. */
async function dateRange(locationId: number, from: string, to: string): Promise<TimeRange> {
  const tz = await timezoneOf(locationId);
  return { start: zonedDateTime(from, 0, tz), end: zonedDateTime(addDays(to, 1), 0, tz) };
}

/** People who work at the location, with their role there. */
async function staffAt(trx: Tx, locationId: number) {
  return trx('user_locations as ul')
    .join('users as u', 'u.id', 'ul.user_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .where('ul.location_id', locationId)
    .whereNull('u.deleted_at')
    .orderBy([{ column: 'r.rank', order: 'desc' }, { column: 'u.name' }])
    .select<{ id: number; name: string; role_key: RoleKey; active: number }[]>(
      'u.id',
      'u.name',
      'r.key as role_key',
      'u.active',
    );
}

async function requireStaff(trx: Tx, locationId: number, userId: number) {
  const row = await trx('user_locations')
    .where({ location_id: locationId, user_id: userId })
    .first('user_id');
  if (!row)
    throw new AppError(400, 'INVALID_REFERENCE', 'This person does not work here.', {
      field: 'userId',
    });
}

// ---- Shifts (the weekly schedule) --------------------------------------------------------------

const shiftQuery = (trx: Tx, locationId: number) =>
  trx('shifts as s')
    .join('users as u', 'u.id', 's.user_id')
    .leftJoin('user_locations as ul', function () {
      this.on('ul.user_id', 's.user_id').andOn('ul.location_id', 's.location_id');
    })
    .leftJoin('roles as r', 'r.id', 'ul.role_id')
    .where('s.location_id', locationId)
    .select('s.*', 'u.name as user_name', 'r.key as role_key');

const toShift = (r: Record<string, unknown>): Shift => ({
  id: num(r.id),
  userId: num(r.user_id),
  userName: String(r.user_name),
  roleKey: (r.role_key as RoleKey | null) ?? null,
  startsAt: iso(r.starts_at)!,
  endsAt: iso(r.ends_at)!,
  note: (r.note as string | null) ?? null,
});

export async function listShifts(
  actor: TimeActor,
  raw: unknown,
  onlyMine = false,
): Promise<Shift[]> {
  const q = dateRangeQuerySchema.parse(raw);
  const range = await dateRange(actor.locationId, q.from, q.to);
  const query = shiftQuery(db, actor.locationId)
    .where('s.starts_at', '>=', range.start)
    .where('s.starts_at', '<', range.end)
    .orderBy([{ column: 's.starts_at' }, { column: 'u.name' }]);
  if (onlyMine) query.where('s.user_id', actor.userId);
  else if (q.userId) query.where('s.user_id', q.userId);
  return (await query).map(toShift);
}

/** One person cannot be scheduled twice at the same time (at any location). */
async function assertNoShiftOverlap(
  trx: Tx,
  userId: number,
  start: Date,
  end: Date,
  excludeId: number | null,
) {
  const q = trx('shifts')
    .where({ user_id: userId })
    .where('starts_at', '<', end)
    .where('ends_at', '>', start);
  if (excludeId) q.whereNot('id', excludeId);
  const clash = await q.first('id', 'starts_at', 'ends_at');
  if (clash) {
    throw AppError.conflict('SHIFT_OVERLAP', 'This person already has a shift at that time.', {
      shiftId: num(clash.id),
      startsAt: iso(clash.starts_at),
      endsAt: iso(clash.ends_at),
    });
  }
}

export async function saveShift(actor: TimeActor, id: number | null, raw: unknown): Promise<Shift> {
  const input = shiftInputSchema.parse(raw);
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  const shiftId = await transactionWithRetry(async (trx) => {
    await requireStaff(trx, actor.locationId, input.userId);
    if (id !== null) {
      const existing = await trx('shifts')
        .where({ id, location_id: actor.locationId })
        .forUpdate()
        .first('id');
      if (!existing) throw AppError.notFound('Shift not found');
    }
    // Lock this person's shifts so two managers cannot double-book them at once.
    await trx('users').where({ id: input.userId }).forUpdate().first('id');
    await assertNoShiftOverlap(trx, input.userId, start, end, id);
    const row = { user_id: input.userId, starts_at: start, ends_at: end, note: input.note ?? null };
    if (id === null) {
      const [newId] = await trx('shifts').insert({
        ...row,
        location_id: actor.locationId,
        created_by: actor.userId,
      });
      return num(newId);
    }
    await trx('shifts').where({ id }).update(row);
    return id;
  });
  return toShift(await shiftQuery(db, actor.locationId).where('s.id', shiftId).first());
}

export async function deleteShift(actor: TimeActor, id: number) {
  const deleted = await db('shifts').where({ id, location_id: actor.locationId }).delete();
  if (!deleted) throw AppError.notFound('Shift not found');
}

// ---- Clock in / out ----------------------------------------------------------------------------

const entryQuery = (trx: Tx, locationId: number) =>
  trx('time_entries as e')
    .join('users as u', 'u.id', 'e.user_id')
    .leftJoin('users as ed', 'ed.id', 'e.edited_by')
    .where('e.location_id', locationId)
    .select('e.*', 'u.name as user_name', 'ed.name as edited_by_name');

function toEntry(r: Record<string, unknown>, now = new Date()): TimeEntry {
  const clockIn = r.clock_in as Date;
  const clockOut = (r.clock_out as Date | null) ?? null;
  return {
    id: num(r.id),
    userId: num(r.user_id),
    userName: String(r.user_name),
    clockIn: clockIn.toISOString(),
    clockOut: clockOut?.toISOString() ?? null,
    minutes: minutesBetween(clockIn, clockOut, now),
    note: (r.note as string | null) ?? null,
    source: r.source as TimeEntrySource,
    editedByName: (r.edited_by_name as string | null) ?? null,
  };
}

const loadEntry = async (trx: Tx, locationId: number, id: number) =>
  toEntry(await entryQuery(trx, locationId).where('e.id', id).first());

function entryChanged(locationId: number, userId: number) {
  emit('time_entry.updated', locationId, { userId });
}

/**
 * Clocks a person in or out at a location. An open entry anywhere blocks a second clock-in; a
 * clock-out closes the open entry here.
 */
async function clock(
  locationId: number,
  userId: number,
  action: 'in' | 'out' | 'toggle',
  source: TimeEntrySource,
): Promise<ClockResult> {
  const result = await transactionWithRetry(async (trx) => {
    // Serialises double taps on the clock button.
    await trx('users').where({ id: userId }).forUpdate().first('id');
    const open = await trx('time_entries')
      .where({ user_id: userId })
      .whereNull('clock_out')
      .first('id', 'location_id');
    const wanted =
      action === 'toggle' ? (open && num(open.location_id) === locationId ? 'out' : 'in') : action;
    if (wanted === 'in') {
      if (open) {
        throw AppError.conflict('ALREADY_CLOCKED_IN', 'You are already clocked in.', {
          locationId: num(open.location_id),
        });
      }
      const [id] = await trx('time_entries').insert({
        location_id: locationId,
        user_id: userId,
        clock_in: new Date(),
        source,
      });
      return { action: 'in' as const, id: num(id) };
    }
    if (!open || num(open.location_id) !== locationId) {
      throw AppError.conflict('NOT_CLOCKED_IN', 'You are not clocked in here.');
    }
    await trx('time_entries').where({ id: open.id }).update({ clock_out: new Date() });
    return { action: 'out' as const, id: num(open.id) };
  });
  const entry = await loadEntry(db, locationId, result.id);
  entryChanged(locationId, userId);
  return { action: result.action, userName: entry.userName, entry };
}

/** Signed in on one's own device or session. */
export const clockSelf = (actor: TimeActor, action: 'in' | 'out') =>
  clock(actor.locationId, actor.userId, action, 'app');

/** On the shared device's clock screen, after the PIN was checked. */
export const clockWithPin = (locationId: number, userId: number) =>
  clock(locationId, userId, 'toggle', 'pin');

export async function myStatus(actor: TimeActor): Promise<ClockStatus> {
  const open = await entryQuery(db, actor.locationId)
    .where('e.user_id', actor.userId)
    .whereNull('e.clock_out')
    .first();
  const tz = await timezoneOf(actor.locationId);
  const today = localParts(new Date(), tz).date;
  const range = {
    start: zonedDateTime(today, 0, tz),
    end: zonedDateTime(addDays(today, 1), 0, tz),
  };
  const shift = await shiftQuery(db, actor.locationId)
    .where('s.user_id', actor.userId)
    .where('s.ends_at', '>', new Date())
    .where('s.starts_at', '<', range.end)
    .orderBy('s.starts_at')
    .first();
  return {
    clockedIn: Boolean(open),
    entry: open ? toEntry(open) : null,
    shift: shift ? toShift(shift) : null,
  };
}

// ---- Manager: entries and hours ----------------------------------------------------------------

export async function listEntries(actor: TimeActor, raw: unknown): Promise<TimeEntry[]> {
  const q = dateRangeQuerySchema.parse(raw);
  const range = await dateRange(actor.locationId, q.from, q.to);
  const query = entryQuery(db, actor.locationId)
    .where('e.clock_in', '>=', range.start)
    .where('e.clock_in', '<', range.end)
    .orderBy([{ column: 'e.clock_in', order: 'desc' }]);
  if (q.userId) query.where('e.user_id', q.userId);
  const now = new Date();
  return (await query).map((r) => toEntry(r, now));
}

/** Manager adds a missing entry or corrects one; every change is audited (plan §5.8). */
export async function saveEntry(
  actor: TimeActor,
  id: number | null,
  raw: unknown,
): Promise<TimeEntry> {
  const input = timeEntryInputSchema.parse(raw);
  const clockIn = new Date(input.clockIn);
  const clockOut = input.clockOut ? new Date(input.clockOut) : null;
  if (clockIn > new Date() || (clockOut && clockOut > new Date())) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Times cannot be in the future.', {
      issues: [
        {
          code: 'custom',
          message: 'future',
          path: [clockOut && clockOut > new Date() ? 'clockOut' : 'clockIn'],
        },
      ],
    });
  }
  const entryId = await transactionWithRetry(async (trx) => {
    await requireStaff(trx, actor.locationId, input.userId);
    const before =
      id === null
        ? null
        : await trx('time_entries')
            .where({ id, location_id: actor.locationId })
            .forUpdate()
            .first();
    if (id !== null && !before) throw AppError.notFound('Entry not found');
    // An entry may not overlap another of the same person.
    const clash = trx('time_entries')
      .where({ user_id: input.userId })
      .where('clock_in', '<', clockOut ?? new Date(8.64e15))
      .where((q) => q.whereNull('clock_out').orWhere('clock_out', '>', clockIn));
    if (id !== null) clash.whereNot('id', id);
    if (await clash.first('id')) {
      throw AppError.conflict('SHIFT_OVERLAP', 'This overlaps another clock entry of this person.');
    }
    const row = {
      user_id: input.userId,
      clock_in: clockIn,
      clock_out: clockOut,
      note: input.note ?? null,
      edited_by: actor.userId,
    };
    let newId = id;
    if (id === null) {
      const [inserted] = await trx('time_entries').insert({
        ...row,
        location_id: actor.locationId,
        source: 'manager',
      });
      newId = num(inserted);
    } else {
      await trx('time_entries').where({ id }).update(row);
    }
    await writeAudit(
      actor,
      {
        action: id === null ? 'time_entry.created' : 'time_entry.updated',
        entityType: 'time_entry',
        entityId: newId,
        before: before ? { clockIn: iso(before.clock_in), clockOut: iso(before.clock_out) } : null,
        after: { clockIn: input.clockIn, clockOut: input.clockOut, note: input.note ?? null },
      },
      trx,
    );
    return newId!;
  });
  entryChanged(actor.locationId, input.userId);
  return loadEntry(db, actor.locationId, entryId);
}

export async function deleteEntry(actor: TimeActor, id: number) {
  const userId = await db.transaction(async (trx) => {
    const before = await trx('time_entries')
      .where({ id, location_id: actor.locationId })
      .forUpdate()
      .first();
    if (!before) throw AppError.notFound('Entry not found');
    await trx('time_entries').where({ id }).delete();
    await writeAudit(
      actor,
      {
        action: 'time_entry.deleted',
        entityType: 'time_entry',
        entityId: id,
        before: {
          userId: num(before.user_id),
          clockIn: iso(before.clock_in),
          clockOut: iso(before.clock_out),
        },
      },
      trx,
    );
    return num(before.user_id);
  });
  entryChanged(actor.locationId, userId);
}

/**
 * Worked vs scheduled minutes per person over local dates (plan §5.8). Open entries count to now;
 * scheduled time counts up to now too.
 */
export async function hours(actor: TimeActor, raw: unknown): Promise<HoursRow[]> {
  const q = dateRangeQuerySchema.parse(raw);
  const range = await dateRange(actor.locationId, q.from, q.to);
  const now = new Date();
  const [people, entries, shifts] = await Promise.all([
    staffAt(db, actor.locationId),
    db('time_entries')
      .where({ location_id: actor.locationId })
      .where('clock_in', '>=', range.start)
      .where('clock_in', '<', range.end)
      .select('user_id', 'clock_in', 'clock_out'),
    db('shifts')
      .where({ location_id: actor.locationId })
      .where('starts_at', '>=', range.start)
      .where('starts_at', '<', range.end)
      .select('user_id', 'starts_at', 'ends_at'),
  ]);
  return people
    .filter((p) => !q.userId || num(p.id) === q.userId)
    .map((p) => {
      const mine = entries.filter((e) => num(e.user_id) === num(p.id));
      return {
        userId: num(p.id),
        name: p.name,
        roleKey: p.role_key,
        workedMinutes: mine.reduce((s, e) => s + minutesBetween(e.clock_in, e.clock_out, now), 0),
        // Only schedule time that has already happened, so the difference is fair mid-week.
        scheduledMinutes: shifts
          .filter((s) => num(s.user_id) === num(p.id) && s.starts_at < now)
          .reduce(
            (s, sh) => s + minutesBetween(sh.starts_at, sh.ends_at < now ? sh.ends_at : now),
            0,
          ),
        entries: mine.length,
        openEntries: mine.filter((e) => !e.clock_out).length,
      };
    })
    .filter(
      (r) =>
        r.entries > 0 ||
        r.scheduledMinutes > 0 ||
        Boolean(people.find((p) => num(p.id) === r.userId)?.active),
    );
}

const CSV_HEADERS: Record<Lang, string[]> = {
  sq: ['Data', 'Punonjësi', 'Roli', 'Hyrja', 'Dalja', 'Orë', 'Shënim'],
  en: ['Date', 'Employee', 'Role', 'Clock in', 'Clock out', 'Hours', 'Note'],
  it: ['Data', 'Dipendente', 'Ruolo', 'Entrata', 'Uscita', 'Ore', 'Nota'],
};

/**
 * Payroll export (plan §5.8): one row per clock entry, local times, decimal hours. Open entries
 * are listed without hours so they get fixed before payroll.
 */
export async function hoursCsv(actor: TimeActor, raw: unknown): Promise<string> {
  const q = dateRangeQuerySchema.parse(raw);
  const loc = await locationRepo.findLocation(actor.locationId);
  const tz = loc?.timezone ?? 'Europe/Tirane';
  const lang = loc?.settings.defaultLang ?? 'sq';
  const range = await dateRange(actor.locationId, q.from, q.to);
  const roles = new Map((await staffAt(db, actor.locationId)).map((p) => [num(p.id), p.role_key]));
  const query = entryQuery(db, actor.locationId)
    .where('e.clock_in', '>=', range.start)
    .where('e.clock_in', '<', range.end)
    .orderBy([{ column: 'u.name' }, { column: 'e.clock_in' }]);
  if (q.userId) query.where('e.user_id', q.userId);
  const rows = (await query).map((r) => {
    const e = toEntry(r);
    return [
      localParts(new Date(e.clockIn), tz).date,
      e.userName,
      roles.get(e.userId) ?? '',
      localTime(new Date(e.clockIn), tz),
      e.clockOut ? localTime(new Date(e.clockOut), tz) : '',
      e.clockOut ? decimalHours(e.minutes) : '',
      e.note ?? '',
    ];
  });
  // A BOM makes Excel open UTF-8 (ë, ç) correctly.
  return `\uFEFF${Papa.unparse({ fields: CSV_HEADERS[lang], data: rows })}`;
}
