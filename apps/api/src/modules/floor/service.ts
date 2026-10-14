import type { Knex } from 'knex';
import QRCode from 'qrcode';
import {
  areaInputSchema,
  deriveTableStatus,
  layoutSaveSchema,
  rectsOverlap,
  tableInputSchema,
  tableUpdateSchema,
  type FloorRequest,
  type FloorState,
  type FloorTable,
  type Permission,
  type Rect,
  type TableQr,
} from '@tavolina/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { emitTableUpdated } from '../../realtime/server.js';
import * as locationRepo from '../locations/repo.js';
import * as orderRepo from '../orders/repo.js';
import { floorReservations } from '../reservations/service.js';
import * as repo from './repo.js';

export interface FloorActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Tx = Knex | Knex.Transaction;

/** Waiters act only on their own tables unless their role or the location setting allows all. */
export async function canActOnAllTables(actor: FloorActor): Promise<boolean> {
  if (actor.permissions.has('table.view_all')) return true;
  const location = await locationRepo.findLocation(actor.locationId);
  return location?.settings.waitersSeeAllTables ?? false;
}

// ---- Live floor ------------------------------------------------------------------------------

/** Open "call waiter" / "bill" requests, by table. */
async function listOpenRequestsByTable(locationId: number): Promise<Map<number, FloorRequest[]>> {
  const rows = await db('service_requests')
    .where({ location_id: locationId, status: 'open' })
    .orderBy('created_at')
    .select('id', 'table_id', 'type', 'created_at');
  const out = new Map<number, FloorRequest[]>();
  for (const r of rows) {
    const list = out.get(Number(r.table_id)) ?? [];
    list.push({ id: Number(r.id), type: r.type, createdAt: (r.created_at as Date).toISOString() });
    out.set(Number(r.table_id), list);
  }
  return out;
}

export async function getFloor(actor: FloorActor): Promise<FloorState> {
  const [areas, tables, sessions, waiters, actOnAll] = await Promise.all([
    repo.listAreas(actor.locationId),
    repo.listTables(actor.locationId),
    repo.listActiveSessions(actor.locationId),
    repo.listWaiters(actor.locationId),
    canActOnAllTables(actor),
  ]);
  const stats = await orderRepo.sessionOrderStats(db, actor.locationId);
  const requests = await listOpenRequestsByTable(actor.locationId);
  const reservations = await floorReservations(actor.locationId);
  const sessionByTable = new Map<number, (typeof sessions)[number]>();
  for (const s of sessions) for (const tableId of s.tableIds) sessionByTable.set(tableId, s);

  const floorTables: FloorTable[] = tables.map((t) => {
    const s = sessionByTable.get(t.id);
    const session = s
      ? {
          id: s.id,
          uuid: s.uuid,
          status: s.status,
          guestCount: s.guestCount,
          waiterId: s.waiterId,
          waiterName: s.waiterName,
          mine: actOnAll || s.waiterId === actor.userId || s.waiterId === null,
          openedAt: s.openedAt.toISOString(),
          tableIds: s.tableIds,
          primaryTableId: s.tableId,
          totalMinor: stats.get(s.id)?.totalMinor ?? 0,
          pendingGuestItems: stats.get(s.id)?.pendingGuestItems ?? 0,
        }
      : null;
    return {
      id: t.id,
      areaId: t.areaId,
      name: t.name,
      seats: t.seats,
      shape: t.shape,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      rotation: t.rotation,
      active: t.active,
      needsCleaning: t.needsCleaning,
      status: deriveTableStatus({
        needsCleaning: t.needsCleaning,
        session: session && { status: session.status, ...stats.get(session.id) },
        reservedSoon: reservations.has(t.id),
      }),
      session,
      requests: requests.get(t.id) ?? [],
      reservation: reservations.get(t.id) ?? null,
    };
  });

  return {
    areas,
    tables: floorTables,
    waiters,
    canActOnAllTables: actOnAll,
    generatedAt: new Date().toISOString(),
  };
}

// ---- Areas -----------------------------------------------------------------------------------

export async function createArea(actor: FloorActor, raw: unknown) {
  const input = areaInputSchema.parse(raw);
  const max = await db('areas')
    .where({ location_id: actor.locationId })
    .whereNull('deleted_at')
    .max<{ max: number | null }>('sort as max')
    .first();
  const [id] = await db('areas').insert({
    location_id: actor.locationId,
    name: input.name,
    active: input.active,
    sort: (max?.max ?? -1) + 1,
  });
  emitTableUpdated(actor.locationId, [], true);
  return { id: Number(id), name: input.name, active: input.active, sort: (max?.max ?? -1) + 1 };
}

export async function updateArea(actor: FloorActor, id: number, raw: unknown) {
  const input = areaInputSchema.partial().parse(raw);
  if (!(await repo.findArea(actor.locationId, id))) throw AppError.notFound('Area not found');
  await db('areas').where({ id }).update(input);
  emitTableUpdated(actor.locationId, [], true);
  return (await repo.listAreas(actor.locationId)).find((a) => a.id === id)!;
}

export async function deleteArea(actor: FloorActor, id: number) {
  if (!(await repo.findArea(actor.locationId, id))) throw AppError.notFound('Area not found');
  const table = await db('tables').where({ area_id: id }).whereNull('deleted_at').first('id');
  if (table) {
    throw AppError.conflict('AREA_NOT_EMPTY', 'Move or delete the tables in this area first.');
  }
  await db('areas')
    .where({ id })
    .update({ deleted_at: db.fn.now(3) });
  emitTableUpdated(actor.locationId, [], true);
}

// ---- Tables ----------------------------------------------------------------------------------

/** Rejects a table rectangle that overlaps another table in the same area. */
async function assertNoOverlap(
  trx: Tx,
  locationId: number,
  areaId: number,
  rect: Rect,
  ignoreIds: number[],
) {
  const others = (await repo.listTables(locationId, trx)).filter(
    (t) => t.areaId === areaId && !ignoreIds.includes(t.id),
  );
  const hit = others.find((t) => rectsOverlap(t, rect));
  if (hit) {
    throw AppError.conflict('TABLE_OVERLAP', 'This table would overlap another table.', {
      tableId: hit.id,
      tableName: hit.name,
    });
  }
}

export async function createTable(actor: FloorActor, raw: unknown) {
  const input = tableInputSchema.parse(raw);
  if (!(await repo.findArea(actor.locationId, input.areaId))) {
    throw new AppError(400, 'INVALID_REFERENCE', 'Choose an area of this location.', {
      field: 'areaId',
    });
  }
  const id = await db.transaction(async (trx) => {
    await assertNoOverlap(trx, actor.locationId, input.areaId, input, []);
    const [newId] = await trx('tables').insert({
      location_id: actor.locationId,
      area_id: input.areaId,
      name: input.name,
      seats: input.seats,
      shape: input.shape,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      rotation: input.rotation,
      active: input.active,
      qr_token: randomToken(16),
    });
    await writeAudit(
      actor,
      { action: 'table.created', entityType: 'table', entityId: Number(newId), after: input },
      trx,
    );
    return Number(newId);
  });
  emitTableUpdated(actor.locationId, [id], true);
  return (await getFloor(actor)).tables.find((t) => t.id === id)!;
}

export async function updateTable(actor: FloorActor, id: number, raw: unknown) {
  const input = tableUpdateSchema.parse(raw);
  const before = await repo.findTable(actor.locationId, id);
  if (!before) throw AppError.notFound('Table not found');
  const areaId = input.areaId ?? before.areaId;
  if (input.areaId !== undefined && !(await repo.findArea(actor.locationId, input.areaId))) {
    throw new AppError(400, 'INVALID_REFERENCE', 'Choose an area of this location.', {
      field: 'areaId',
    });
  }
  await db.transaction(async (trx) => {
    const rect = {
      x: input.x ?? before.x,
      y: input.y ?? before.y,
      w: input.w ?? before.w,
      h: input.h ?? before.h,
    };
    await assertNoOverlap(trx, actor.locationId, areaId, rect, [id]);
    await trx('tables')
      .where({ id })
      .update({
        ...(input.areaId !== undefined ? { area_id: input.areaId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.seats !== undefined ? { seats: input.seats } : {}),
        ...(input.shape !== undefined ? { shape: input.shape } : {}),
        ...rect,
        ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      });
  });
  emitTableUpdated(actor.locationId, [id], true);
  return (await getFloor(actor)).tables.find((t) => t.id === id)!;
}

export async function deleteTable(actor: FloorActor, id: number) {
  if (!(await repo.findTable(actor.locationId, id))) throw AppError.notFound('Table not found');
  await db.transaction(async (trx) => {
    if (await repo.sessionIdForTable(id, trx)) {
      throw AppError.conflict('TABLE_OCCUPIED', 'Close the table before deleting it.');
    }
    await trx('tables')
      .where({ id })
      .update({ deleted_at: trx.fn.now(3) });
    await writeAudit(actor, { action: 'table.deleted', entityType: 'table', entityId: id }, trx);
  });
  emitTableUpdated(actor.locationId, [id], true);
}

/** Saves positions of many tables in one area from the floor editor; all or nothing. */
export async function saveLayout(actor: FloorActor, raw: unknown): Promise<FloorState> {
  const input = layoutSaveSchema.parse(raw);
  if (!(await repo.findArea(actor.locationId, input.areaId)))
    throw AppError.notFound('Area not found');
  await db.transaction(async (trx) => {
    const current = (await repo.listTables(actor.locationId, trx)).filter(
      (t) => t.areaId === input.areaId,
    );
    const byId = new Map(current.map((t) => [t.id, t]));
    for (const t of input.tables) {
      if (!byId.has(t.id)) {
        throw new AppError(400, 'INVALID_REFERENCE', 'A table is not in this area.', {
          tableId: t.id,
        });
      }
    }
    // Final positions: moved tables from the payload, the rest unchanged.
    const moved = new Map(input.tables.map((t) => [t.id, t]));
    const final = current.map((t) => ({ ...t, ...(moved.get(t.id) ?? {}) }));
    for (let i = 0; i < final.length; i++) {
      for (let j = i + 1; j < final.length; j++) {
        if (rectsOverlap(final[i]!, final[j]!)) {
          throw AppError.conflict('TABLE_OVERLAP', 'Two tables would overlap.', {
            tableIds: [final[i]!.id, final[j]!.id],
          });
        }
      }
    }
    for (const t of input.tables) {
      await trx('tables')
        .where({ id: t.id })
        .update({ x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation });
    }
  });
  emitTableUpdated(
    actor.locationId,
    input.tables.map((t) => t.id),
    true,
  );
  return getFloor(actor);
}

// ---- QR codes --------------------------------------------------------------------------------

export function guestUrlFor(token: string): string {
  return `${env.GUEST_APP_URL.replace(/\/$/, '')}/t/${token}`;
}

async function qrFor(table: repo.TableRow): Promise<TableQr> {
  const url = guestUrlFor(table.qrToken);
  // Error correction "M" survives smudges on a printed table card.
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { tableId: table.id, tableName: table.name, url, svg };
}

export async function getTableQr(actor: FloorActor, id: number): Promise<TableQr> {
  const table = await repo.findTable(actor.locationId, id);
  if (!table) throw AppError.notFound('Table not found');
  return qrFor(table);
}

export async function getAreaQrSheet(actor: FloorActor, areaId: number): Promise<TableQr[]> {
  if (!(await repo.findArea(actor.locationId, areaId))) throw AppError.notFound('Area not found');
  const tables = (await repo.listTables(actor.locationId)).filter(
    (t) => t.areaId === areaId && t.active,
  );
  return Promise.all(tables.map(qrFor));
}

/** Issues a new QR token; the old printed code stops working. */
export async function rotateQr(actor: FloorActor, id: number): Promise<TableQr> {
  if (!(await repo.findTable(actor.locationId, id))) throw AppError.notFound('Table not found');
  await db.transaction(async (trx) => {
    await trx('tables')
      .where({ id })
      .update({ qr_token: randomToken(16) });
    await writeAudit(actor, { action: 'table.qr_rotated', entityType: 'table', entityId: id }, trx);
  });
  return getTableQr(actor, id);
}
