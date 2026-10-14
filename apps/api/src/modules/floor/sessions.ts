import type { Knex } from 'knex';
import {
  canCloseSession,
  canTransitionSession,
  mergeSchema,
  openSessionSchema,
  sessionUpdateSchema,
  splitSchema,
  transferSchema,
  type FloorState,
  type SessionStatus,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emitTableUpdated } from '../../realtime/server.js';
import { paidOnOrder } from '../billing/totals.js';
import * as orderRepo from '../orders/repo.js';
import { completeForSession, reservationsChanged, seatInSession } from '../reservations/service.js';
import * as repo from './repo.js';
import { canActOnAllTables, getFloor, type FloorActor } from './service.js';

type Tx = Knex | Knex.Transaction;

const occupied = () =>
  AppError.conflict('TABLE_OCCUPIED', 'This table already has guests. Choose a free table.');

function isDuplicate(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

/**
 * Loads an active session the actor may act on: their own, any if allowed, or one that guests
 * opened from the QR menu and no waiter has taken yet.
 */
export async function loadSession(actor: FloorActor, id: number, trx: Tx = db) {
  const session = await repo.findSession(actor.locationId, id, trx);
  if (!session) throw AppError.notFound('This table session is closed or does not exist.');
  if (
    session.waiterId !== null &&
    session.waiterId !== actor.userId &&
    !(await canActOnAllTables(actor))
  ) {
    throw new AppError(403, 'NOT_YOUR_TABLE', 'This table belongs to another waiter.', {
      waiterName: session.waiterName,
    });
  }
  return session;
}

async function requireTable(actor: FloorActor, tableId: number, trx: Tx) {
  const table = await repo.findTable(actor.locationId, tableId, trx);
  if (!table || !table.active) {
    throw new AppError(400, 'INVALID_REFERENCE', 'Choose an active table of this location.', {
      field: 'tableId',
    });
  }
  return table;
}

async function setStatus(actor: FloorActor, id: number, to: SessionStatus, action: string) {
  const session = await loadSession(actor, id);
  if (!canTransitionSession(session.status, to)) {
    throw AppError.conflict(
      'SESSION_STATE',
      `The table cannot go from ${session.status} to ${to}.`,
      {
        from: session.status,
        to,
      },
    );
  }
  await db.transaction(async (trx) => {
    await trx('table_sessions').where({ id }).update({ status: to });
    await writeAudit(
      actor,
      {
        action,
        entityType: 'table_session',
        entityId: id,
        before: { status: session.status },
        after: { status: to },
      },
      trx,
    );
  });
  emitTableUpdated(actor.locationId, session.tableIds);
}

// ---- Open / update -----------------------------------------------------------------------------

/**
 * Seats guests at a free table. Idempotent on the client-generated uuid: replaying the same open
 * (offline queue, double tap) returns the floor instead of failing.
 */
export async function openSession(actor: FloorActor, raw: unknown): Promise<FloorState> {
  const input = openSessionSchema.parse(raw);
  const existing = await db('table_sessions')
    .where({ uuid: input.uuid })
    .first('id', 'location_id', 'table_id');
  if (existing) {
    if (
      Number(existing.location_id) !== actor.locationId ||
      Number(existing.table_id) !== input.tableId
    ) {
      throw AppError.conflict('CONFLICT', 'This session id is already used for another table.');
    }
    return getFloor(actor);
  }

  try {
    await transactionWithRetry(async (trx) => {
      await requireTable(actor, input.tableId, trx);
      if (await repo.sessionIdForTable(input.tableId, trx)) throw occupied();
      const [id] = await trx('table_sessions').insert({
        uuid: input.uuid,
        location_id: actor.locationId,
        table_id: input.tableId,
        waiter_id: actor.userId,
        guest_count: input.guestCount,
        status: 'open',
      });
      // The unique key on table_id makes two waiters opening one table at once impossible.
      await trx('table_session_tables').insert({ session_id: id, table_id: input.tableId });
      await trx('tables').where({ id: input.tableId }).update({ needs_cleaning: false });
      if (input.reservationId) {
        await seatInSession(trx, actor.locationId, input.reservationId, input.tableId, Number(id));
      }
    });
  } catch (err) {
    if (isDuplicate(err)) throw occupied();
    throw err;
  }
  emitTableUpdated(actor.locationId, [input.tableId]);
  if (input.reservationId) reservationsChanged(actor.locationId, [input.reservationId], []);
  return getFloor(actor);
}

export async function updateSession(
  actor: FloorActor,
  id: number,
  raw: unknown,
): Promise<FloorState> {
  const input = sessionUpdateSchema.parse(raw);
  const session = await loadSession(actor, id);
  await db('table_sessions').where({ id }).update({ guest_count: input.guestCount });
  emitTableUpdated(actor.locationId, session.tableIds);
  return getFloor(actor);
}

// ---- Transfer / merge / split ------------------------------------------------------------------

export async function transferSession(
  actor: FloorActor,
  id: number,
  raw: unknown,
): Promise<FloorState> {
  const input = transferSchema.parse(raw);
  const session = await loadSession(actor, id);
  const touched = [...session.tableIds];

  if (input.toWaiterId !== undefined) {
    if (!(await repo.userCanOpenTables(actor.locationId, input.toWaiterId))) {
      throw new AppError(400, 'INVALID_REFERENCE', 'This person cannot take tables here.', {
        field: 'toWaiterId',
      });
    }
    await transactionWithRetry(async (trx) => {
      await trx('table_sessions').where({ id }).update({ waiter_id: input.toWaiterId });
      await writeAudit(
        actor,
        {
          action: 'table_session.waiter_changed',
          entityType: 'table_session',
          entityId: id,
          before: { waiterId: session.waiterId },
          after: { waiterId: input.toWaiterId },
        },
        trx,
      );
    });
  } else {
    const toTableId = input.toTableId!;
    if (session.tableIds.includes(toTableId)) {
      throw AppError.conflict('CONFLICT', 'The guests are already at this table.');
    }
    try {
      await transactionWithRetry(async (trx) => {
        await requireTable(actor, toTableId, trx);
        if (await repo.sessionIdForTable(toTableId, trx)) throw occupied();
        // Move the guests' main table; merged tables stay with the session.
        await trx('table_session_tables')
          .where({ session_id: id, table_id: session.tableId })
          .delete();
        await trx('table_session_tables').insert({ session_id: id, table_id: toTableId });
        await trx('table_sessions').where({ id }).update({ table_id: toTableId });
        await trx('tables').where({ id: session.tableId }).update({ needs_cleaning: true });
        await trx('tables').where({ id: toTableId }).update({ needs_cleaning: false });
        await writeAudit(
          actor,
          {
            action: 'table_session.table_changed',
            entityType: 'table_session',
            entityId: id,
            before: { tableId: session.tableId },
            after: { tableId: toTableId },
          },
          trx,
        );
      });
    } catch (err) {
      if (isDuplicate(err)) throw occupied();
      throw err;
    }
    touched.push(toTableId);
  }
  emitTableUpdated(actor.locationId, touched);
  return getFloor(actor);
}

/**
 * Joins another table to this session. A free table is simply added; if it has its own session,
 * that session's tables and guests move here and it is closed as merged.
 */
export async function mergeSession(
  actor: FloorActor,
  id: number,
  raw: unknown,
): Promise<FloorState> {
  const { tableId } = mergeSchema.parse(raw);
  const session = await loadSession(actor, id);
  if (session.tableIds.includes(tableId)) {
    throw AppError.conflict('CONFLICT', 'This table is already part of the group.');
  }
  const touched = [...session.tableIds, tableId];

  await transactionWithRetry(async (trx) => {
    await requireTable(actor, tableId, trx);
    const otherId = await repo.sessionIdForTable(tableId, trx);
    if (otherId === null) {
      await trx('table_session_tables').insert({ session_id: id, table_id: tableId });
      await trx('tables').where({ id: tableId }).update({ needs_cleaning: false });
    } else {
      const other = await loadSession(actor, otherId, trx);
      touched.push(...other.tableIds);
      await trx('table_session_tables').where({ session_id: otherId }).update({ session_id: id });
      await trx('table_sessions')
        .where({ id })
        .update({ guest_count: Math.min(99, session.guestCount + other.guestCount) });
      await orderRepo.moveSessionOrder(trx, otherId, id);
      // Guests' phones and their requests follow the merged party.
      await trx('guest_sessions')
        .where({ table_session_id: otherId })
        .update({ table_session_id: id });
      await trx('service_requests')
        .where({ table_session_id: otherId })
        .update({ table_session_id: id });
      await trx('table_sessions')
        .where({ id: otherId })
        .update({
          status: 'closed',
          closed_at: trx.fn.now(3),
          closed_by: actor.userId,
          merged_into_id: id,
        });
    }
    await writeAudit(
      actor,
      {
        action: 'table_session.merged',
        entityType: 'table_session',
        entityId: id,
        after: { tableId, mergedSessionId: otherId },
      },
      trx,
    );
  });
  emitTableUpdated(actor.locationId, touched);
  return getFloor(actor);
}

/** Takes a table out of a merged group; it becomes free. */
export async function splitSession(
  actor: FloorActor,
  id: number,
  raw: unknown,
): Promise<FloorState> {
  const { tableId } = splitSchema.parse(raw);
  const session = await loadSession(actor, id);
  if (!session.tableIds.includes(tableId)) {
    throw new AppError(400, 'INVALID_REFERENCE', 'This table is not part of the group.', {
      field: 'tableId',
    });
  }
  if (session.tableIds.length < 2) {
    throw AppError.conflict('SESSION_STATE', 'Only merged tables can be split.');
  }
  await db.transaction(async (trx) => {
    await trx('table_session_tables').where({ session_id: id, table_id: tableId }).delete();
    if (session.tableId === tableId) {
      const remaining = session.tableIds.find((t) => t !== tableId)!;
      await trx('table_sessions').where({ id }).update({ table_id: remaining });
    }
    await writeAudit(
      actor,
      {
        action: 'table_session.split',
        entityType: 'table_session',
        entityId: id,
        after: { tableId },
      },
      trx,
    );
  });
  emitTableUpdated(actor.locationId, session.tableIds);
  return getFloor(actor);
}

// ---- Bill / close ------------------------------------------------------------------------------

export async function requestBill(actor: FloorActor, id: number): Promise<FloorState> {
  await setStatus(actor, id, 'bill_requested', 'table_session.bill_requested');
  return getFloor(actor);
}

export async function reopenSession(actor: FloorActor, id: number): Promise<FloorState> {
  await setStatus(actor, id, 'open', 'table_session.reopened');
  return getFloor(actor);
}

/**
 * Ends the session (business rule 4: only when nothing is owed). Its tables become free and are
 * flagged for cleaning.
 */
/** What is still owed on the table's open order (total minus payments). */
async function sessionBalance(sessionId: number): Promise<number> {
  const order = await orderRepo.findOrderForSession(db, sessionId);
  if (!order) return 0;
  const row = await db('orders').where({ id: order.id }).first('total_minor');
  return Number(row.total_minor) - (await paidOnOrder(db, order.id));
}

export async function closeSession(actor: FloorActor, id: number): Promise<FloorState> {
  const session = await loadSession(actor, id);
  // Business rule 4: nothing may be left to pay.
  const balanceMinor = await sessionBalance(id);
  if (!canCloseSession(session.status, balanceMinor)) {
    throw AppError.conflict('BALANCE_DUE', 'Settle the bill before closing the table.', {
      balanceMinor,
    });
  }
  const completed = await db.transaction(async (trx) => {
    await trx('table_sessions')
      .where({ id })
      .update({
        status: 'closed',
        closed_at: trx.fn.now(3),
        closed_by: actor.userId,
      });
    await trx('table_session_tables').where({ session_id: id }).delete();
    await trx('tables').whereIn('id', session.tableIds).update({ needs_cleaning: true });
    await orderRepo.closeSessionOrders(trx, id);
    // Requests from the table are settled once the guests leave.
    await trx('service_requests')
      .where({ table_session_id: id, status: 'open' })
      .update({ status: 'handled', handled_by: actor.userId, handled_at: trx.fn.now(3) });
    await writeAudit(
      actor,
      {
        action: 'table_session.closed',
        entityType: 'table_session',
        entityId: id,
        before: { status: session.status, tableIds: session.tableIds },
      },
      trx,
    );
    // The guests have left: a reservation seated here is completed.
    return completeForSession(trx, id);
  });
  emitTableUpdated(actor.locationId, session.tableIds);
  if (completed.length) reservationsChanged(actor.locationId, completed, []);
  return getFloor(actor);
}

export async function markClean(actor: FloorActor, tableId: number): Promise<FloorState> {
  const table = await repo.findTable(actor.locationId, tableId);
  if (!table) throw AppError.notFound('Table not found');
  await db('tables').where({ id: tableId }).update({ needs_cleaning: false });
  emitTableUpdated(actor.locationId, [tableId]);
  return getFloor(actor);
}
