import type { Knex } from 'knex';
import {
  billSplitSchema,
  billTax,
  discountSchema,
  paymentSchema,
  refundSchema,
  splitByGroups,
  splitEqually,
  type Bill,
  type BillView,
  type Payment,
  type PaymentMethod,
  type SplitType,
  type TaxLine,
} from '@tavolina/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { writeAudit } from '../../lib/audit.js';
import { randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { emit, emitTableUpdated } from '../../realtime/server.js';
import { consumeApproval } from '../approvals/service.js';
import { createFiscalRecord, fiscalForBills, registerSoon } from '../fiscal/service.js';
import { deductForItems, emitLowStock } from '../inventory/stock.js';
import * as locationRepo from '../locations/repo.js';
import * as orderRepo from '../orders/repo.js';
import { assertOpen, orderForActor, type OrderActor } from '../orders/service.js';
import { printReceipt } from './receipts.js';
import {
  assertDayOpen,
  loadTotals,
  paidOnOrder,
  recalcTotals,
  type BillableLine,
} from './totals.js';

export { assertDayOpen };

type Tx = Knex | Knex.Transaction;
const num = (v: unknown) => Number(v);
const iso = (v: unknown) => (v as Date).toISOString();

// ---- Guards ------------------------------------------------------------------------------------

async function assertNoPayments(trx: Tx, orderId: number) {
  const paid = await trx('payments').where({ order_id: orderId }).first('id');
  if (paid) {
    throw AppError.conflict(
      'ORDER_HAS_PAYMENTS',
      'Part of this bill is already paid; refund it first.',
    );
  }
}

async function tableIdsOfOrder(orderId: number): Promise<number[]> {
  const order = await db('orders').where({ id: orderId }).first('table_session_id');
  if (!order?.table_session_id) return [];
  return (
    await db('table_session_tables')
      .where({ session_id: order.table_session_id })
      .select('table_id')
  ).map((r) => num(r.table_id));
}

async function notify(locationId: number, orderId: number) {
  emit('bill.updated', locationId, { orderId });
  emitTableUpdated(locationId, await tableIdsOfOrder(orderId));
}

// ---- Bill view ---------------------------------------------------------------------------------

export async function billView(orderId: number): Promise<BillView> {
  const order = await orderRepo.loadOrder(db, orderId);
  const loaded = await loadTotals(db, orderId);
  const discountRows = await db('discounts').where({ order_id: orderId }).orderBy('id');
  const billRows = await db('bills').where({ order_id: orderId }).orderBy(['sort', 'id']);
  const billIds = billRows.map((b) => num(b.id));
  const items = billIds.length ? await db('bill_items').whereIn('bill_id', billIds) : [];
  const paymentRows = billIds.length
    ? await db('payments as p')
        .leftJoin('users as u', 'u.id', 'p.taken_by')
        .whereIn('p.bill_id', billIds)
        .orderBy('p.id')
        .select('p.*', 'u.name as taken_by_name')
    : [];
  const refundRows = paymentRows.length
    ? await db('refunds')
        .whereIn(
          'payment_id',
          paymentRows.map((p) => p.id),
        )
        .groupBy('payment_id')
        .select('payment_id', db.raw('SUM(amount_minor) as refunded'))
    : [];
  const refunded = new Map(refundRows.map((r) => [num(r.payment_id), num(r.refunded)]));
  const fiscal = await fiscalForBills(billIds);
  const payments: Payment[] = paymentRows.map((p) => ({
    id: num(p.id),
    uuid: p.uuid,
    billId: num(p.bill_id),
    method: p.method,
    amountMinor: num(p.amount_minor),
    tipMinor: num(p.tip_minor),
    tenderedMinor: p.tendered_minor === null ? null : num(p.tendered_minor),
    changeMinor: num(p.change_minor),
    reference: p.reference,
    refundedMinor: refunded.get(num(p.id)) ?? 0,
    takenBy: p.taken_by_name ?? null,
    createdAt: iso(p.created_at),
  }));
  const bills: Bill[] = billRows.map((b) => {
    const own = payments.filter((p) => p.billId === num(b.id));
    const paid = own.reduce((s, p) => s + p.amountMinor, 0);
    return {
      id: num(b.id),
      label: b.label,
      splitType: b.split_type,
      itemIds: items.filter((i) => num(i.bill_id) === num(b.id)).map((i) => num(i.order_item_id)),
      totalMinor: num(b.total_minor),
      paidMinor: paid,
      refundedMinor: own.reduce((s, p) => s + p.refundedMinor, 0),
      balanceMinor: num(b.total_minor) - paid,
      status: b.status,
      tax: (typeof b.tax === 'string' ? JSON.parse(b.tax) : b.tax) as TaxLine[],
      payments: own,
      fiscal: fiscal.get(num(b.id)) ?? null,
      receiptToken: b.receipt_token,
      receiptUrl: `${env.GUEST_APP_URL.replace(/\/$/, '')}/r/${b.receipt_token}`,
    };
  });
  const paidMinor = payments.reduce((s, p) => s + p.amountMinor, 0);
  return {
    order,
    totals: loaded.totals,
    discounts: discountRows.map((d) => ({
      id: num(d.id),
      orderItemId: d.order_item_id === null ? null : num(d.order_item_id),
      type: d.type,
      value: num(d.value),
      amountMinor: num(d.amount_minor),
      reason: d.reason,
    })),
    bills,
    paidMinor,
    balanceMinor: loaded.totals.totalMinor - paidMinor,
    serviceChargeBp: loaded.type === 'dine_in' ? loaded.settings.serviceChargeBp : 0,
    tipOptionsBp: loaded.settings.tipOptionsBp,
  };
}

export async function getBill(actor: OrderActor, orderRef: string | number): Promise<BillView> {
  const order = await orderForActor(actor, orderRef);
  return billView(order.id);
}

// ---- Discounts ---------------------------------------------------------------------------------

/**
 * Plan §5.7: % or fixed, per line or whole bill, with a reason. Above the location's threshold a
 * manager approves with their PIN, unless the person can approve themselves. Always audited.
 */
export async function addDiscount(actor: OrderActor, orderRef: string | number, raw: unknown) {
  const input = discountSchema.parse(raw);
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  await transactionWithRetry(async (trx) => {
    await trx('orders').where({ id: order.id }).forUpdate().first('id');
    await assertNoPayments(trx, order.id);
    const loaded = await loadTotals(trx, order.id);
    const target = input.orderItemId ?? null;
    let base: number;
    if (target !== null) {
      const line = loaded.lines.find((l) => l.id === target);
      if (!line)
        throw new AppError(400, 'INVALID_REFERENCE', 'Choose a line of this bill.', {
          field: 'orderItemId',
        });
      base = line.grossMinor;
    } else {
      base = loaded.totals.subtotalMinor - loaded.totals.itemDiscountMinor;
    }
    const percentBp =
      input.type === 'percent'
        ? input.value
        : base > 0
          ? Math.ceil((input.value * 10_000) / base)
          : 10_000;
    const needsApproval = percentBp > loaded.settings.discountApprovalThresholdBp;
    let approvedBy: number | null = null;
    if (actor.permissions.has('approval.grant')) approvedBy = actor.userId;
    else if (needsApproval) {
      approvedBy = await consumeApproval(trx, {
        token: input.approvalToken,
        locationId: actor.locationId,
        action: 'order.discount',
        entityType: 'order',
        entityId: order.id,
      });
    }
    // One discount per line and one on the whole bill: a new one replaces the old.
    const replace = trx('discounts').where({ order_id: order.id });
    await (
      target === null
        ? replace.whereNull('order_item_id')
        : replace.where({ order_item_id: target })
    ).delete();
    const [id] = await trx('discounts').insert({
      order_id: order.id,
      order_item_id: target,
      type: input.type,
      value: input.value,
      reason: input.reason,
      created_by: actor.userId,
      approved_by: approvedBy,
    });
    await recalcTotals(trx, order.id);
    await writeAudit(
      actor,
      {
        action: 'order.discount_added',
        entityType: 'order',
        entityId: order.id,
        after: {
          discountId: num(id),
          orderItemId: target,
          type: input.type,
          value: input.value,
          reason: input.reason,
        },
        approvedBy,
      },
      trx,
    );
  });
  await notify(actor.locationId, order.id);
  return billView(order.id);
}

export async function removeDiscount(actor: OrderActor, discountId: number) {
  const row = await db('discounts as d')
    .join('orders as o', 'o.id', 'd.order_id')
    .where({ 'd.id': discountId, 'o.location_id': actor.locationId })
    .first('d.*');
  if (!row) throw AppError.notFound('Discount not found');
  const order = await orderForActor(actor, num(row.order_id));
  assertOpen(order);
  await db.transaction(async (trx) => {
    await assertNoPayments(trx, order.id);
    await trx('discounts').where({ id: discountId }).delete();
    await recalcTotals(trx, order.id);
    await writeAudit(
      actor,
      {
        action: 'order.discount_removed',
        entityType: 'order',
        entityId: order.id,
        before: { discountId, value: num(row.value), type: row.type },
      },
      trx,
    );
  });
  await notify(actor.locationId, order.id);
  return billView(order.id);
}

// ---- Splitting ---------------------------------------------------------------------------------

interface BillPlan {
  label: string;
  totalMinor: number;
  itemIds: number[];
  tax: TaxLine[];
}

const invalidSplit = (message: string) => AppError.conflict('SPLIT_INVALID', message);

/** Lines with their combo dishes, grouped under the top-level line. */
function topLevel(lines: BillableLine[]) {
  return lines
    .filter((l) => l.parentItemId === null)
    .map((l) => ({
      line: l,
      ids: [l.id, ...lines.filter((c) => c.parentItemId === l.id).map((c) => c.id)],
    }));
}

function planGroups(
  totalMinor: number,
  finals: Map<number, { amount: number; rateBp: number }>,
  groups: { label: string; ids: number[] }[],
): BillPlan[] {
  const sums = groups.map((g) => g.ids.reduce((s, id) => s + (finals.get(id)?.amount ?? 0), 0));
  const amounts = splitByGroups(totalMinor, sums);
  return groups.map((g, i) => ({
    label: g.label,
    totalMinor: amounts[i]!,
    itemIds: g.ids,
    tax: billTax(
      amounts[i]!,
      g.ids.map((id) => ({ rateBp: finals.get(id)!.rateBp, amount: finals.get(id)!.amount })),
    ),
  }));
}

async function writeBills(
  trx: Knex.Transaction,
  orderId: number,
  type: SplitType,
  plans: BillPlan[],
) {
  await trx('bills').where({ order_id: orderId }).delete();
  for (const [sort, plan] of plans.entries()) {
    const [billId] = await trx('bills').insert({
      order_id: orderId,
      split_type: type,
      label: plan.label,
      sort,
      total_minor: plan.totalMinor,
      tax: JSON.stringify(plan.tax),
      receipt_token: randomToken(16),
    });
    if (plan.itemIds.length) {
      await trx('bill_items').insert(
        plan.itemIds.map((id) => ({ bill_id: billId, order_item_id: id })),
      );
    }
  }
}

/** Builds the bills for a split (plan §5.7: equally, by seat, by items, custom amounts). */
async function planSplit(
  trx: Tx,
  orderId: number,
  raw: unknown,
): Promise<{ type: SplitType; plans: BillPlan[] }> {
  const input = billSplitSchema.parse(raw);
  const { totals, lines } = await loadTotals(trx, orderId);
  if (totals.totalMinor <= 0) throw invalidSplit('There is nothing to pay on this order.');
  const finals = new Map(
    totals.lines.map((l) => [l.id, { amount: l.finalMinor, rateBp: l.taxRateBp }]),
  );
  const orderMix = totals.lines.map((l) => ({ rateBp: l.taxRateBp, amount: l.finalMinor }));
  const all = topLevel(lines);

  switch (input.type) {
    case 'full':
      return {
        type: 'full',
        plans: [
          {
            label: '',
            totalMinor: totals.totalMinor,
            itemIds: lines.map((l) => l.id),
            tax: totals.tax,
          },
        ],
      };
    case 'equal':
      return {
        type: 'equal',
        plans: splitEqually(totals.totalMinor, input.parts).map((amount, i) => ({
          label: `${i + 1}/${input.parts}`,
          totalMinor: amount,
          itemIds: [],
          tax: billTax(amount, orderMix),
        })),
      };
    case 'custom': {
      const sum = input.amountsMinor.reduce((a, b) => a + b, 0);
      if (sum !== totals.totalMinor) {
        throw invalidSplit('The amounts must add up to the total.');
      }
      return {
        type: 'custom',
        plans: input.amountsMinor.map((amount, i) => ({
          label: String(i + 1),
          totalMinor: amount,
          itemIds: [],
          tax: billTax(amount, orderMix),
        })),
      };
    }
    case 'seat': {
      const bySeat = new Map<string, number[]>();
      for (const g of all) {
        const key = g.line.seat === null ? 'shared' : `seat:${g.line.seat}`;
        bySeat.set(key, [...(bySeat.get(key) ?? []), ...g.ids]);
      }
      if (bySeat.size < 2) throw invalidSplit('Give the dishes seats first, or split another way.');
      const keys = [...bySeat.keys()].sort((a, b) =>
        a === 'shared' ? 1 : b === 'shared' ? -1 : Number(a.slice(5)) - Number(b.slice(5)),
      );
      return {
        type: 'seat',
        plans: planGroups(
          totals.totalMinor,
          finals,
          keys.map((k) => ({ label: k, ids: bySeat.get(k)! })),
        ),
      };
    }
    case 'items': {
      const known = new Map(all.map((g) => [g.line.id, g.ids]));
      const seen = new Set<number>();
      for (const group of input.groups) {
        for (const id of group) {
          if (!known.has(id)) throw invalidSplit('Choose dishes from this order.');
          if (seen.has(id)) throw invalidSplit('Each dish can be on one bill only.');
          seen.add(id);
        }
      }
      if (seen.size !== known.size) throw invalidSplit('Every dish must be on a bill.');
      return {
        type: 'items',
        plans: planGroups(
          totals.totalMinor,
          finals,
          input.groups.map((group, i) => ({
            label: String(i + 1),
            ids: group.flatMap((id) => known.get(id)!),
          })),
        ),
      };
    }
  }
}

export async function splitBill(actor: OrderActor, orderRef: string | number, raw: unknown) {
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  await transactionWithRetry(async (trx) => {
    await trx('orders').where({ id: order.id }).forUpdate().first('id');
    await assertNoPayments(trx, order.id);
    const { type, plans } = await planSplit(trx, order.id, raw);
    await writeBills(trx, order.id, type, plans);
    await writeAudit(
      actor,
      {
        action: 'order.split',
        entityType: 'order',
        entityId: order.id,
        after: { type, bills: plans.map((p) => p.totalMinor) },
      },
      trx,
    );
  });
  await notify(actor.locationId, order.id);
  return billView(order.id);
}

// ---- Payments ----------------------------------------------------------------------------------

async function openDrawerId(trx: Tx, locationId: number): Promise<number | null> {
  const drawer = await trx('cash_drawers')
    .where({ location_id: locationId })
    .whereNull('closed_at')
    .forUpdate()
    .first('id');
  return drawer ? num(drawer.id) : null;
}

/**
 * Takes a payment on one bill. Cash needs an open drawer and gives change; card keeps the terminal
 * reference; several payments on one bill make a mixed payment. A fully paid bill is fiscalized
 * and its receipt printed; a fully paid table is marked "paid".
 */
export async function pay(
  actor: OrderActor,
  orderRef: string | number,
  billId: number | null,
  raw: unknown,
) {
  const input = paymentSchema.parse(raw);
  const replay = await db('payments').where({ uuid: input.uuid }).first('order_id', 'location_id');
  if (replay) {
    if (num(replay.location_id) !== actor.locationId)
      throw AppError.conflict('CONFLICT', 'Payment id already used.');
    return billView(num(replay.order_id));
  }
  const order = await orderForActor(actor, orderRef);
  assertOpen(order);
  const location = await locationRepo.findLocation(actor.locationId);

  const result = await transactionWithRetry(async (trx) => {
    const date = await assertDayOpen(trx, actor.locationId);
    await trx('orders').where({ id: order.id }).forUpdate().first('id');
    let targetId = billId;
    if (targetId === null) {
      const bills = await trx('bills').where({ order_id: order.id }).select('id', 'status');
      if (!bills.length) {
        const { type, plans } = await planSplit(trx, order.id, { type: 'full' });
        await writeBills(trx, order.id, type, plans);
        targetId = num((await trx('bills').where({ order_id: order.id }).first('id')).id);
      } else {
        const open = bills.filter((b) => b.status === 'open');
        if (open.length !== 1) throw invalidSplit('Choose which bill is being paid.');
        targetId = num(open[0]!.id);
      }
    }
    const bill = await trx('bills').where({ id: targetId, order_id: order.id }).forUpdate().first();
    if (!bill) throw AppError.notFound('Bill not found');
    if (bill.status !== 'open') throw AppError.conflict('BILL_PAID', 'This bill is already paid.');
    const paidBefore = num(
      (await trx('payments').where({ bill_id: bill.id }).sum({ s: 'amount_minor' }).first())?.s ??
        0,
    );
    const due = num(bill.total_minor) - paidBefore;
    if (input.amountMinor > due) {
      throw AppError.conflict('PAYMENT_TOO_HIGH', 'That is more than is left on this bill.', {
        dueMinor: due,
      });
    }

    let drawerId: number | null = null;
    let tendered: number | null = null;
    let change = 0;
    if (input.method === 'cash') {
      drawerId = await openDrawerId(trx, actor.locationId);
      if (drawerId === null) {
        throw AppError.conflict('CASH_DRAWER_CLOSED', 'Open the cash drawer before taking cash.');
      }
      tendered = input.tenderedMinor ?? input.amountMinor + input.tipMinor;
      change = tendered - input.amountMinor - input.tipMinor;
    }
    // Tips go to the table's waiter (or whoever opened the order).
    const owner = await trx('orders as o')
      .leftJoin('table_sessions as s', 's.id', 'o.table_session_id')
      .where('o.id', order.id)
      .first(trx.raw('COALESCE(s.waiter_id, o.opened_by) as user_id'));
    const [paymentId] = await trx('payments').insert({
      uuid: input.uuid,
      location_id: actor.locationId,
      order_id: order.id,
      bill_id: bill.id,
      method: input.method,
      amount_minor: input.amountMinor,
      tip_minor: input.tipMinor,
      tendered_minor: tendered,
      change_minor: change,
      reference: input.reference ?? null,
      tip_user_id: owner?.user_id ?? actor.userId,
      taken_by: actor.userId,
      drawer_id: drawerId,
      business_date: date,
    });
    if (drawerId !== null) {
      // The drawer keeps the bill amount and a cash tip; the change goes back to the guest.
      await trx('cash_movements').insert({
        drawer_id: drawerId,
        type: 'sale',
        amount_minor: input.amountMinor + input.tipMinor,
        user_id: actor.userId,
        payment_id: paymentId,
      });
    }

    const fiscalIds: number[] = [];
    const billPaid = paidBefore + input.amountMinor >= num(bill.total_minor);
    if (billPaid) {
      await trx('bills')
        .where({ id: bill.id })
        .update({ status: 'paid', paid_at: trx.fn.now(3) });
      const methods = await trx('payments')
        .where({ bill_id: bill.id })
        .groupBy('method')
        .select('method', trx.raw('SUM(amount_minor) as amount'));
      fiscalIds.push(
        await createFiscalRecord(trx, {
          locationId: actor.locationId,
          kind: 'invoice',
          userId: actor.userId,
          totalMinor: num(bill.total_minor),
          tax: (typeof bill.tax === 'string' ? JSON.parse(bill.tax) : bill.tax) as TaxLine[],
          payments: methods.map((m) => ({
            method: m.method as PaymentMethod,
            amountMinor: num(m.amount),
          })),
          billId: num(bill.id),
        }),
      );
    }
    const orderRow = await trx('orders')
      .where({ id: order.id })
      .first('total_minor', 'table_session_id');
    const fullyPaid = (await paidOnOrder(trx, order.id)) >= num(orderRow.total_minor);
    let lowStock: Awaited<ReturnType<typeof deductForItems>> = [];
    if (fullyPaid && location?.settings.stockDeductOn === 'payment') {
      // Business rule 7 (deduct on payment): every dish of the order is booked out now.
      const billable = await trx('order_items')
        .where({ order_id: order.id })
        .whereIn('status', ['sent', 'preparing', 'ready', 'served'])
        .select('id');
      lowStock = await deductForItems(
        trx,
        actor.locationId,
        billable.map((r) => num(r.id)),
        actor.userId,
      );
    }
    if (fullyPaid) {
      if (orderRow.table_session_id) {
        // The table's lifecycle: open → bill_requested → paid → closed (plan §6).
        await trx('table_sessions')
          .where({ id: orderRow.table_session_id })
          .whereIn('status', ['open', 'bill_requested'])
          .update({ status: 'paid' });
        await trx('service_requests')
          .where({ table_session_id: orderRow.table_session_id, status: 'open' })
          .whereIn('type', ['bill_cash', 'bill_card'])
          .update({ status: 'handled', handled_by: actor.userId, handled_at: trx.fn.now(3) });
      } else {
        await trx('orders')
          .where({ id: order.id })
          .update({ status: 'closed', closed_at: trx.fn.now(3) });
      }
    }
    await writeAudit(
      actor,
      {
        action: 'payment.taken',
        entityType: 'payment',
        entityId: num(paymentId),
        after: {
          orderId: order.id,
          billId: num(bill.id),
          method: input.method,
          amountMinor: input.amountMinor,
          tipMinor: input.tipMinor,
        },
      },
      trx,
    );
    return { billId: num(bill.id), billPaid, fiscalIds, lowStock };
  });
  registerSoon(result.fiscalIds);
  emitLowStock(actor.locationId, result.lowStock);
  if (result.billPaid && location) {
    void printReceipt(actor.locationId, result.billId).catch(() => undefined);
  }
  await notify(actor.locationId, order.id);
  return billView(order.id);
}

// ---- Refunds -----------------------------------------------------------------------------------

/** Plan §5.7: full or partial, always manager-approved, always logged; corrected with DPT. */
export async function refund(actor: OrderActor, paymentId: number, raw: unknown) {
  const input = refundSchema.parse(raw);
  const payment = await db('payments')
    .where({ id: paymentId, location_id: actor.locationId })
    .first();
  if (!payment) throw AppError.notFound('Payment not found');
  const result = await transactionWithRetry(async (trx) => {
    const date = await assertDayOpen(trx, actor.locationId);
    await trx('payments').where({ id: paymentId }).forUpdate().first('id');
    const already = num(
      (await trx('refunds').where({ payment_id: paymentId }).sum({ s: 'amount_minor' }).first())
        ?.s ?? 0,
    );
    const left = num(payment.amount_minor) - already;
    if (input.amountMinor > left) {
      throw AppError.conflict('REFUND_TOO_HIGH', 'That is more than was paid with this payment.', {
        maxMinor: left,
      });
    }
    const approvedBy = actor.permissions.has('approval.grant')
      ? actor.userId
      : await consumeApproval(trx, {
          token: input.approvalToken,
          locationId: actor.locationId,
          action: 'payment.refund',
          entityType: 'payment',
          entityId: paymentId,
        });
    let drawerId: number | null = null;
    if (payment.method === 'cash') {
      drawerId = await openDrawerId(trx, actor.locationId);
      if (drawerId === null) {
        throw AppError.conflict('CASH_DRAWER_CLOSED', 'Open the cash drawer to give cash back.');
      }
    }
    const [refundId] = await trx('refunds').insert({
      payment_id: paymentId,
      amount_minor: input.amountMinor,
      reason: input.reason,
      created_by: actor.userId,
      approved_by: approvedBy,
      drawer_id: drawerId,
      business_date: date,
    });
    if (drawerId !== null) {
      await trx('cash_movements').insert({
        drawer_id: drawerId,
        type: 'refund',
        amount_minor: input.amountMinor,
        reason: input.reason,
        user_id: actor.userId,
        refund_id: refundId,
      });
    }
    const bill = await trx('bills').where({ id: payment.bill_id }).first();
    const original = await trx('fiscal_invoices')
      .where({ bill_id: bill.id, kind: 'invoice' })
      .first('nivf');
    const fiscalId = await createFiscalRecord(trx, {
      locationId: actor.locationId,
      kind: 'corrective',
      userId: actor.userId,
      totalMinor: -input.amountMinor,
      // The refund carries the bill's mix of VAT rates, as negative amounts.
      tax: billTax(
        input.amountMinor,
        ((typeof bill.tax === 'string' ? JSON.parse(bill.tax) : bill.tax) as TaxLine[]).map(
          (t) => ({
            rateBp: t.rateBp,
            amount: t.grossMinor,
          }),
        ),
      ).map((t) => ({
        rateBp: t.rateBp,
        grossMinor: -t.grossMinor,
        taxMinor: -t.taxMinor,
        netMinor: -t.netMinor,
      })),
      payments: [{ method: payment.method, amountMinor: -input.amountMinor }],
      refundId: num(refundId),
      correctsNivf: original?.nivf ?? null,
    });
    const refundedOnBill = num(
      (
        await trx('refunds as r')
          .join('payments as p', 'p.id', 'r.payment_id')
          .where('p.bill_id', bill.id)
          .sum({ s: 'r.amount_minor' })
          .first()
      )?.s ?? 0,
    );
    if (refundedOnBill >= num(bill.total_minor)) {
      await trx('bills').where({ id: bill.id }).update({ status: 'refunded' });
    }
    await writeAudit(
      actor,
      {
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: paymentId,
        after: { amountMinor: input.amountMinor, reason: input.reason },
        approvedBy,
      },
      trx,
    );
    return { fiscalId };
  });
  registerSoon([result.fiscalId]);
  await notify(actor.locationId, num(payment.order_id));
  return billView(num(payment.order_id));
}

export async function reprintReceipt(actor: OrderActor, billId: number) {
  const bill = await db('bills as b')
    .join('orders as o', 'o.id', 'b.order_id')
    .where({ 'b.id': billId, 'o.location_id': actor.locationId })
    .first('b.id');
  if (!bill) throw AppError.notFound('Bill not found');
  return { jobId: await printReceipt(actor.locationId, billId) };
}
