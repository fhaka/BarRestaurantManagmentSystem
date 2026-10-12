import type { Knex } from 'knex';
import type { Area, SessionStatus, TableShape } from '@tavolina/shared';
import { db as defaultDb } from '../../db/knex.js';

type Tx = Knex | Knex.Transaction;

export interface TableRow {
  id: number;
  areaId: number;
  name: string;
  seats: number;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  qrToken: string;
  active: boolean;
  needsCleaning: boolean;
}

export interface SessionRow {
  id: number;
  uuid: string;
  locationId: number;
  tableId: number;
  waiterId: number;
  waiterName: string;
  guestCount: number;
  status: SessionStatus;
  openedAt: Date;
  tableIds: number[];
}

const toTable = (r: Record<string, unknown>): TableRow => ({
  id: Number(r.id),
  areaId: Number(r.area_id),
  name: String(r.name),
  seats: Number(r.seats),
  shape: r.shape as TableShape,
  x: Number(r.x),
  y: Number(r.y),
  w: Number(r.w),
  h: Number(r.h),
  rotation: Number(r.rotation),
  qrToken: String(r.qr_token),
  active: Boolean(r.active),
  needsCleaning: Boolean(r.needs_cleaning),
});

export async function listAreas(locationId: number, db: Tx = defaultDb): Promise<Area[]> {
  const rows = await db('areas')
    .where({ location_id: locationId })
    .whereNull('deleted_at')
    .orderBy([{ column: 'sort' }, { column: 'id' }]);
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    sort: Number(r.sort),
    active: Boolean(r.active),
  }));
}

export async function findArea(locationId: number, id: number, db: Tx = defaultDb) {
  return db('areas').where({ id, location_id: locationId }).whereNull('deleted_at').first();
}

export async function listTables(locationId: number, db: Tx = defaultDb): Promise<TableRow[]> {
  const rows = await db('tables')
    .where({ location_id: locationId })
    .whereNull('deleted_at')
    .orderBy([{ column: 'area_id' }, { column: 'id' }]);
  return rows.map(toTable);
}

export async function findTable(locationId: number, id: number, db: Tx = defaultDb) {
  const row = await db('tables')
    .where({ id, location_id: locationId })
    .whereNull('deleted_at')
    .first();
  return row ? toTable(row) : undefined;
}

export async function findTableByToken(token: string, db: Tx = defaultDb) {
  const row = await db('tables').where({ qr_token: token }).whereNull('deleted_at').first();
  return row ? { ...toTable(row), locationId: Number(row.location_id) } : undefined;
}

/** Active (not closed) sessions with their tables and waiter names. */
export async function listActiveSessions(
  locationId: number,
  db: Tx = defaultDb,
): Promise<SessionRow[]> {
  const rows = await db('table_sessions as s')
    .join('users as u', 'u.id', 's.waiter_id')
    .where('s.location_id', locationId)
    .whereNot('s.status', 'closed')
    .select('s.*', 'u.name as waiter_name');
  if (!rows.length) return [];
  const links = await db('table_session_tables').whereIn(
    'session_id',
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: Number(r.id),
    uuid: r.uuid,
    locationId: Number(r.location_id),
    tableId: Number(r.table_id),
    waiterId: Number(r.waiter_id),
    waiterName: r.waiter_name,
    guestCount: Number(r.guest_count),
    status: r.status as SessionStatus,
    openedAt: r.opened_at as Date,
    tableIds: links
      .filter((l) => Number(l.session_id) === Number(r.id))
      .map((l) => Number(l.table_id)),
  }));
}

export async function findSession(locationId: number, id: number, db: Tx = defaultDb) {
  return (await listActiveSessions(locationId, db)).find((s) => s.id === id);
}

/** The active session a table belongs to, if any. Locks the link row inside a transaction. */
export async function sessionIdForTable(tableId: number, trx: Tx): Promise<number | null> {
  const row = await trx('table_session_tables')
    .where({ table_id: tableId })
    .forUpdate()
    .first('session_id');
  return row ? Number(row.session_id) : null;
}

/** Staff at the location whose role can open tables (candidates for "transfer to waiter"). */
export async function listWaiters(locationId: number, db: Tx = defaultDb) {
  const rows = await db('user_locations as ul')
    .join('users as u', 'u.id', 'ul.user_id')
    .join('role_permissions as rp', 'rp.role_id', 'ul.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where({ 'ul.location_id': locationId, 'p.key': 'table.open', 'u.active': true })
    .whereNull('u.deleted_at')
    .distinct('u.id', 'u.name')
    .orderBy('u.name');
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
}

export async function userCanOpenTables(locationId: number, userId: number, db: Tx = defaultDb) {
  return (await listWaiters(locationId, db)).some((w) => w.id === userId);
}
