import {
  PAYMENT_METHODS,
  businessDate,
  lineTotal,
  type PaymentMethod,
  type TaxLine,
  type ZReport,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import * as locationRepo from '../locations/repo.js';
import type { OrderActor } from '../orders/service.js';
import { zReportDocument } from '../printing/documents.js';
import { enqueue } from '../printing/queue.js';
import { expectedCash } from './cash.js';
import { loadTotals } from './totals.js';

const num = (v: unknown) => Number(v);

/**
 * The Z report (plan §5.8) for one business day: sales, VAT, payments by method, tips, refunds,
 * voids, items sold, staff and the cash drawers. The same numbers are an "X report" while the
 * day is still open.
 */
export async function buildReport(locationId: number, date: string): Promise<ZReport> {
  const stored = await db('business_days')
    .where({ location_id: locationId, business_date: date })
    .first();
  if (stored)
    return (
      typeof stored.z_report === 'string' ? JSON.parse(stored.z_report) : stored.z_report
    ) as ZReport;

  const orders = await db('orders')
    .where({ location_id: locationId, business_date: date })
    .whereNot('status', 'cancelled')
    .select(
      'id',
      'subtotal_minor',
      'discount_minor',
      'service_minor',
      'total_minor',
      'table_session_id',
      'opened_by',
    );
  const sold = orders.filter((o) => num(o.subtotal_minor) > 0);

  const tax = new Map<number, TaxLine>();
  for (const o of sold) {
    for (const t of (await loadTotals(db, num(o.id))).totals.tax) {
      const acc = tax.get(t.rateBp) ?? {
        rateBp: t.rateBp,
        grossMinor: 0,
        taxMinor: 0,
        netMinor: 0,
      };
      acc.grossMinor += t.grossMinor;
      acc.taxMinor += t.taxMinor;
      acc.netMinor += t.netMinor;
      tax.set(t.rateBp, acc);
    }
  }

  const payments = await db('payments')
    .where({ location_id: locationId, business_date: date })
    .select('method', 'amount_minor', 'tip_minor', 'tip_user_id');
  const byMethod = PAYMENT_METHODS.map((method) => {
    const own = payments.filter((p) => p.method === method);
    return {
      method: method as PaymentMethod,
      count: own.length,
      amountMinor: own.reduce((s, p) => s + num(p.amount_minor), 0),
    };
  }).filter((m) => m.count > 0);

  const refundRows = await db('refunds as r')
    .join('payments as p', 'p.id', 'r.payment_id')
    .where({ 'p.location_id': locationId, 'r.business_date': date })
    .select('r.amount_minor');

  const orderIds = orders.map((o) => num(o.id));
  const items = orderIds.length
    ? await db('order_items')
        .whereIn('order_id', orderIds)
        .select('id', 'name_snapshot', 'unit_price_minor', 'qty', 'status', 'sent_at')
    : [];
  const mods = items.length
    ? await db('order_item_modifiers')
        .whereIn(
          'order_item_id',
          items.map((i) => i.id),
        )
        .select('order_item_id', 'price_delta_minor')
    : [];
  const gross = (i: Record<string, unknown>) =>
    lineTotal(
      num(i.unit_price_minor),
      mods.filter((m) => num(m.order_item_id) === num(i.id)).map((m) => num(m.price_delta_minor)),
      num(i.qty),
    );
  // Voids are dishes that reached the kitchen and were then cancelled (rejected phone orders are not).
  const voided = items.filter((i) => i.status === 'voided' && i.sent_at !== null);
  const soldItems = new Map<string, { qty: number; amountMinor: number }>();
  for (const i of items.filter((x) =>
    ['sent', 'preparing', 'ready', 'served'].includes(x.status),
  )) {
    const acc = soldItems.get(i.name_snapshot) ?? { qty: 0, amountMinor: 0 };
    acc.qty += num(i.qty);
    acc.amountMinor += gross(i);
    soldItems.set(i.name_snapshot, acc);
  }

  // Staff: the table's waiter (or who opened the order) gets the sale; tips by tip owner.
  const sessions = orders.filter((o) => o.table_session_id).map((o) => num(o.table_session_id));
  const waiterOf = new Map<number, number | null>();
  if (sessions.length) {
    for (const s of await db('table_sessions').whereIn('id', sessions).select('id', 'waiter_id')) {
      waiterOf.set(num(s.id), s.waiter_id === null ? null : num(s.waiter_id));
    }
  }
  const staff = new Map<number, { orders: number; salesMinor: number; tipsMinor: number }>();
  const staffEntry = (id: number) => {
    const e = staff.get(id) ?? { orders: 0, salesMinor: 0, tipsMinor: 0 };
    staff.set(id, e);
    return e;
  };
  for (const o of sold) {
    const owner =
      (o.table_session_id ? waiterOf.get(num(o.table_session_id)) : null) ??
      (o.opened_by === null ? null : num(o.opened_by));
    if (owner === null) continue;
    const e = staffEntry(owner);
    e.orders += 1;
    e.salesMinor += num(o.total_minor);
  }
  for (const p of payments)
    if (p.tip_user_id !== null) staffEntry(num(p.tip_user_id)).tipsMinor += num(p.tip_minor);
  const names = staff.size
    ? new Map(
        (
          await db('users')
            .whereIn('id', [...staff.keys()])
            .select('id', 'name')
        ).map((u) => [num(u.id), String(u.name)]),
      )
    : new Map<number, string>();

  const drawers = await db('cash_drawers')
    .where({ location_id: locationId, business_date: date })
    .select('id', 'opening_float_minor', 'counted_minor', 'closed_at');
  const moves = drawers.length
    ? await db('cash_movements')
        .whereIn(
          'drawer_id',
          drawers.map((d) => d.id),
        )
        .select('type', 'amount_minor')
    : [];
  const sumMoves = (type: string) =>
    moves.filter((m) => m.type === type).reduce((s, m) => s + num(m.amount_minor), 0);
  let expected = 0;
  for (const d of drawers) expected += await expectedCash(db, num(d.id));
  const allClosed = drawers.length > 0 && drawers.every((d) => d.closed_at);

  const fiscalRows = await db('fiscal_invoices as f')
    .leftJoin('bills as b', 'b.id', 'f.bill_id')
    .leftJoin('orders as o', 'o.id', 'b.order_id')
    .leftJoin('cash_drawers as d', 'd.id', 'f.drawer_id')
    .where('f.location_id', locationId)
    .where((q) => q.where('o.business_date', date).orWhere('d.business_date', date))
    .groupBy('f.status')
    .select('f.status', db.raw('COUNT(*) as n'));
  const fiscalCount = (s: string) => num(fiscalRows.find((r) => r.status === s)?.n ?? 0);

  const paymentsTotal = byMethod.reduce((s, m) => s + m.amountMinor, 0);
  return {
    businessDate: date,
    generatedAt: new Date().toISOString(),
    closed: false,
    orders: sold.length,
    grossSalesMinor: sold.reduce((s, o) => s + num(o.subtotal_minor), 0),
    discountsMinor: sold.reduce((s, o) => s + num(o.discount_minor), 0),
    serviceMinor: sold.reduce((s, o) => s + num(o.service_minor), 0),
    netSalesMinor: sold.reduce((s, o) => s + num(o.total_minor), 0),
    tax: [...tax.values()].sort((a, b) => b.rateBp - a.rateBp),
    payments: byMethod,
    paymentsTotalMinor: paymentsTotal,
    tipsMinor: payments.reduce((s, p) => s + num(p.tip_minor), 0),
    refunds: {
      count: refundRows.length,
      amountMinor: refundRows.reduce((s, r) => s + num(r.amount_minor), 0),
    },
    voids: { count: voided.length, amountMinor: voided.reduce((s, i) => s + gross(i), 0) },
    items: [...soldItems.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name)),
    waiters: [...staff.entries()]
      .map(([id, v]) => ({ name: names.get(id) ?? '?', ...v }))
      .sort((a, b) => b.salesMinor - a.salesMinor),
    cash: {
      floatMinor: drawers.reduce((s, d) => s + num(d.opening_float_minor), 0),
      salesMinor: sumMoves('sale'),
      payInsMinor: sumMoves('pay_in'),
      payOutsMinor: sumMoves('pay_out') + sumMoves('tip_out'),
      refundsMinor: sumMoves('refund'),
      expectedMinor: expected,
      countedMinor: allClosed ? drawers.reduce((s, d) => s + num(d.counted_minor ?? 0), 0) : null,
    },
    fiscal: {
      registered: fiscalCount('registered'),
      pending: fiscalCount('pending'),
      failed: fiscalCount('failed'),
    },
  };
}

async function today(locationId: number) {
  const location = await locationRepo.findLocation(locationId);
  return { location: location!, date: businessDate(new Date(), location!.timezone) };
}

export async function currentReport(actor: OrderActor): Promise<ZReport> {
  const { date } = await today(actor.locationId);
  return buildReport(actor.locationId, date);
}

export async function reportFor(actor: OrderActor, date: string): Promise<ZReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw AppError.badRequest('Use a date like 2026-10-13.');
  return buildReport(actor.locationId, date);
}

/**
 * Business rule 5: the day can be closed only with every table and order settled and every cash
 * drawer counted. The Z report is stored, printed, and the day is locked.
 */
export async function closeDay(actor: OrderActor): Promise<ZReport> {
  const { location, date } = await today(actor.locationId);
  const report = await transactionWithRetry(async (trx) => {
    if (
      await trx('business_days')
        .where({ location_id: actor.locationId, business_date: date })
        .first('id')
    ) {
      throw AppError.conflict('BUSINESS_DAY_CLOSED', 'Today is already closed.');
    }
    const openTables = await trx('table_sessions')
      .where({ location_id: actor.locationId })
      .whereNot('status', 'closed')
      .count({ n: '*' })
      .first();
    const openOrders = await trx('orders')
      .where({ location_id: actor.locationId, status: 'open' })
      .whereNull('table_session_id')
      .count({ n: '*' })
      .first();
    if (num(openTables?.n) > 0 || num(openOrders?.n) > 0) {
      throw AppError.conflict('DAY_HAS_OPEN_TABLES', 'Close every table and order first.', {
        tables: num(openTables?.n),
        orders: num(openOrders?.n),
      });
    }
    if (
      await trx('cash_drawers')
        .where({ location_id: actor.locationId })
        .whereNull('closed_at')
        .first('id')
    ) {
      throw AppError.conflict('CASH_DRAWER_OPEN', 'Count and close the cash drawer first.');
    }
    const z = { ...(await buildReport(actor.locationId, date)), closed: true };
    await trx('business_days').insert({
      location_id: actor.locationId,
      business_date: date,
      status: 'closed',
      z_report: JSON.stringify(z),
      closed_by: actor.userId,
    });
    await writeAudit(
      actor,
      {
        action: 'business_day.closed',
        entityType: 'business_day',
        entityId: date,
        after: { netSalesMinor: z.netSalesMinor, paymentsTotalMinor: z.paymentsTotalMinor },
      },
      trx,
    );
    return z;
  });
  void enqueue(actor.locationId, location.settings.reportPrinterId, 'z_report', (p) =>
    zReportDocument(report, {
      lang: location.settings.defaultLang,
      widthChars: p.widthChars,
      currency: location.settings.currencyDisplay,
      locationName: location.name,
      timeZone: location.timezone,
    }),
  ).catch(() => undefined);
  return report;
}
