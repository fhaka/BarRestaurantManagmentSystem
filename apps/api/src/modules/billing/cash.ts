import type { Knex } from 'knex';
import {
  ALL_DENOMINATIONS,
  cashMovementSchema,
  closeDrawerSchema,
  countDenominations,
  noSaleSchema,
  openDrawerSchema,
  type CashDrawer,
  type CashMovementType,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emit } from '../../realtime/server.js';
import { consumeApproval } from '../approvals/service.js';
import { createFiscalRecord, registerSoon } from '../fiscal/service.js';
import * as locationRepo from '../locations/repo.js';
import type { OrderActor } from '../orders/service.js';
import { drawerKickDocument } from '../printing/documents.js';
import { enqueue } from '../printing/queue.js';
import { assertDayOpen } from './service.js';

type Tx = Knex | Knex.Transaction;
const num = (v: unknown) => Number(v);
const iso = (v: unknown) => (v ? (v as Date).toISOString() : null);

/** Expected cash = float + cash sales (with cash tips) + pay-ins − pay-outs − refunds − tips paid out. */
const SIGN: Record<CashMovementType, 1 | -1> = {
  sale: 1,
  pay_in: 1,
  pay_out: -1,
  refund: -1,
  tip_out: -1,
};

export async function expectedCash(trx: Tx, drawerId: number): Promise<number> {
  const drawer = await trx('cash_drawers').where({ id: drawerId }).first('opening_float_minor');
  const moves = await trx('cash_movements')
    .where({ drawer_id: drawerId })
    .select('type', 'amount_minor');
  return moves.reduce(
    (sum, m) => sum + SIGN[m.type as CashMovementType] * num(m.amount_minor),
    num(drawer.opening_float_minor),
  );
}

async function drawerView(id: number): Promise<CashDrawer> {
  const d = await db('cash_drawers as d')
    .join('users as u', 'u.id', 'd.opened_by')
    .where('d.id', id)
    .first('d.*', 'u.name as opened_by_name');
  const moves = await db('cash_movements as m')
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .where('m.drawer_id', id)
    .orderBy('m.id', 'desc')
    .select('m.*', 'u.name as user_name');
  return {
    id: num(d.id),
    status: d.closed_at ? 'closed' : 'open',
    openedBy: d.opened_by_name,
    openedAt: iso(d.opened_at)!,
    floatMinor: num(d.opening_float_minor),
    expectedMinor: d.closed_at ? num(d.expected_minor) : await expectedCash(db, id),
    countedMinor: d.counted_minor === null ? null : num(d.counted_minor),
    differenceMinor: d.difference_minor === null ? null : num(d.difference_minor),
    closedAt: iso(d.closed_at),
    movements: moves.map((m) => ({
      id: num(m.id),
      type: m.type,
      amountMinor: num(m.amount_minor),
      reason: m.reason,
      userName: m.user_name ?? null,
      createdAt: iso(m.created_at)!,
    })),
  };
}

async function openDrawerRow(trx: Tx, locationId: number, lock = false) {
  const q = trx('cash_drawers').where({ location_id: locationId }).whereNull('closed_at');
  if (lock) q.forUpdate();
  return q.first();
}

export async function currentDrawer(actor: OrderActor): Promise<CashDrawer | null> {
  const row = await openDrawerRow(db, actor.locationId);
  return row ? drawerView(num(row.id)) : null;
}

const changed = (locationId: number) => emit('cash_drawer.updated', locationId, {});

/** Opens the location's cash drawer with a starting float; DPT gets the initial cash deposit. */
export async function openDrawer(actor: OrderActor, raw: unknown): Promise<CashDrawer> {
  const input = openDrawerSchema.parse(raw);
  const { id, fiscalId } = await transactionWithRetry(async (trx) => {
    const date = await assertDayOpen(trx, actor.locationId);
    if (await openDrawerRow(trx, actor.locationId, true)) {
      throw AppError.conflict('CASH_DRAWER_OPEN', 'The cash drawer is already open.');
    }
    const [drawerId] = await trx('cash_drawers').insert({
      location_id: actor.locationId,
      business_date: date,
      opened_by: actor.userId,
      opening_float_minor: input.floatMinor,
    });
    const fiscal = await createFiscalRecord(trx, {
      locationId: actor.locationId,
      kind: 'cash_deposit',
      userId: actor.userId,
      totalMinor: input.floatMinor,
      drawerId: num(drawerId),
    });
    await writeAudit(
      actor,
      {
        action: 'cash_drawer.opened',
        entityType: 'cash_drawer',
        entityId: num(drawerId),
        after: { floatMinor: input.floatMinor },
      },
      trx,
    );
    return { id: num(drawerId), fiscalId: fiscal };
  });
  registerSoon([fiscalId]);
  changed(actor.locationId);
  return drawerView(id);
}

async function ownDrawer(trx: Tx, actor: OrderActor, id: number) {
  const row = await trx('cash_drawers')
    .where({ id, location_id: actor.locationId })
    .forUpdate()
    .first();
  if (!row) throw AppError.notFound('Cash drawer not found');
  if (row.closed_at) throw AppError.conflict('CASH_DRAWER_CLOSED', 'This cash drawer is closed.');
  return row;
}

/** Pay-ins and pay-outs (bought ice, paid a supplier) with a reason; pay-outs go to DPT too. */
export async function addMovement(
  actor: OrderActor,
  drawerId: number,
  raw: unknown,
): Promise<CashDrawer> {
  const input = cashMovementSchema.parse(raw);
  const fiscalIds = await transactionWithRetry(async (trx) => {
    await ownDrawer(trx, actor, drawerId);
    if (input.type !== 'pay_in' && (await expectedCash(trx, drawerId)) < input.amountMinor) {
      throw AppError.conflict('PAYMENT_TOO_HIGH', 'There is not that much cash in the drawer.');
    }
    const [id] = await trx('cash_movements').insert({
      drawer_id: drawerId,
      type: input.type,
      amount_minor: input.amountMinor,
      reason: input.reason,
      user_id: actor.userId,
    });
    await writeAudit(
      actor,
      {
        action: `cash_drawer.${input.type}`,
        entityType: 'cash_drawer',
        entityId: drawerId,
        after: { movementId: num(id), amountMinor: input.amountMinor, reason: input.reason },
      },
      trx,
    );
    if (input.type === 'pay_out') {
      return [
        await createFiscalRecord(trx, {
          locationId: actor.locationId,
          kind: 'withdrawal',
          userId: actor.userId,
          totalMinor: input.amountMinor,
          drawerId,
        }),
      ];
    }
    return [];
  });
  registerSoon(fiscalIds);
  changed(actor.locationId);
  return drawerView(drawerId);
}

/** Opening the drawer without a sale needs a manager (plan §10 rule 9) and is logged. */
export async function noSale(actor: OrderActor, drawerId: number, raw: unknown) {
  const input = noSaleSchema.parse(raw);
  await db.transaction(async (trx) => {
    await ownDrawer(trx, actor, drawerId);
    const approvedBy = actor.permissions.has('approval.grant')
      ? actor.userId
      : await consumeApproval(trx, {
          token: input.approvalToken,
          locationId: actor.locationId,
          action: 'cash_drawer.open_no_sale',
          entityType: 'cash_drawer',
          entityId: drawerId,
        });
    await writeAudit(
      actor,
      {
        action: 'cash_drawer.no_sale',
        entityType: 'cash_drawer',
        entityId: drawerId,
        after: { reason: input.reason },
        approvedBy,
      },
      trx,
    );
  });
  const location = await locationRepo.findLocation(actor.locationId);
  const jobId = await enqueue(
    actor.locationId,
    location?.settings.receiptPrinterId,
    'drawer_kick',
    (p) => drawerKickDocument(p.widthChars),
  );
  return { jobId };
}

/**
 * End of shift: the cashier counts notes and coins; the system shows expected vs counted. A
 * manager approves (people with cash.approve approve their own count).
 */
export async function closeDrawer(
  actor: OrderActor,
  drawerId: number,
  raw: unknown,
): Promise<CashDrawer> {
  const input = closeDrawerSchema.parse(raw);
  const allowed = new Set<number>(ALL_DENOMINATIONS);
  const counts: Record<number, number> = {};
  for (const [key, count] of Object.entries(input.counts)) {
    if (!allowed.has(Number(key))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown note or coin.', {
        issues: [{ path: `counts.${key}`, message: 'invalid' }],
      });
    }
    counts[Number(key)] = count;
  }
  const counted = countDenominations(counts);
  await transactionWithRetry(async (trx) => {
    await ownDrawer(trx, actor, drawerId);
    const expected = await expectedCash(trx, drawerId);
    const approvedBy = actor.permissions.has('cash.approve')
      ? actor.userId
      : await consumeApproval(trx, {
          token: input.approvalToken,
          locationId: actor.locationId,
          action: 'cash_drawer.close',
          entityType: 'cash_drawer',
          entityId: drawerId,
        });
    await trx('cash_drawers')
      .where({ id: drawerId })
      .update({
        closed_at: trx.fn.now(3),
        closed_by: actor.userId,
        approved_by: approvedBy,
        expected_minor: expected,
        counted_minor: counted,
        difference_minor: counted - expected,
        counts: JSON.stringify(counts),
        note: input.note ?? null,
      });
    await writeAudit(
      actor,
      {
        action: 'cash_drawer.closed',
        entityType: 'cash_drawer',
        entityId: drawerId,
        after: {
          expectedMinor: expected,
          countedMinor: counted,
          differenceMinor: counted - expected,
        },
        approvedBy,
      },
      trx,
    );
  });
  changed(actor.locationId);
  return drawerView(drawerId);
}

export async function getDrawer(actor: OrderActor, id: number) {
  const row = await db('cash_drawers').where({ id, location_id: actor.locationId }).first('id');
  if (!row) throw AppError.notFound('Cash drawer not found');
  return drawerView(id);
}
