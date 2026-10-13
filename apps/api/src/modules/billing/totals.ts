import type { Knex } from 'knex';
import {
  businessDate,
  computeTotals,
  isBillable,
  lineTotal,
  type DiscountInput,
  type LocationSettings,
  type OrderItemStatus,
  type OrderTotals,
} from '@tavolina/shared';
import { db as defaultDb } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import * as locationRepo from '../locations/repo.js';

type Tx = Knex | Knex.Transaction;
const num = (v: unknown) => Number(v);

export interface BillableLine {
  id: number;
  parentItemId: number | null;
  seat: number | null;
  grossMinor: number;
  taxRateBp: number;
}

export interface DiscountRow {
  id: number;
  orderItemId: number | null;
  type: 'percent' | 'fixed';
  value: number;
  reason: string;
}

export interface LoadedTotals {
  orderId: number;
  locationId: number;
  type: string;
  settings: LocationSettings;
  lines: BillableLine[];
  discounts: DiscountRow[];
  totals: OrderTotals;
}

/** The location's default VAT rate (20% if none is set up yet). */
export async function defaultTaxRate(trx: Tx, locationId: number): Promise<number> {
  const row = await trx('tax_rates')
    .where({ location_id: locationId, is_default: true })
    .first('rate_bp');
  return row ? num(row.rate_bp) : 2000;
}

/**
 * Business rule 2 on the server: billable lines → item discounts → bill discount → service
 * charge (dine-in only) → VAT extracted per rate. Clients never send totals.
 */
export async function loadTotals(trx: Tx, orderId: number): Promise<LoadedTotals> {
  const order = await trx('orders').where({ id: orderId }).first('id', 'location_id', 'type');
  const location = await locationRepo.findLocation(num(order.location_id), trx as Knex);
  const settings = location!.settings;
  const fallbackRate = await defaultTaxRate(trx, num(order.location_id));
  const items = await trx('order_items')
    .where({ order_id: orderId })
    .orderBy('id')
    .select('id', 'parent_item_id', 'seat', 'unit_price_minor', 'qty', 'status', 'tax_rate_bp');
  const billable = items.filter((i) => isBillable(i.status as OrderItemStatus));
  const mods = billable.length
    ? await trx('order_item_modifiers')
        .whereIn(
          'order_item_id',
          billable.map((i) => i.id),
        )
        .select('order_item_id', 'price_delta_minor')
    : [];
  const lines: BillableLine[] = billable.map((i) => ({
    id: num(i.id),
    parentItemId: i.parent_item_id === null ? null : num(i.parent_item_id),
    seat: i.seat === null ? null : num(i.seat),
    grossMinor: lineTotal(
      num(i.unit_price_minor),
      mods.filter((m) => num(m.order_item_id) === num(i.id)).map((m) => num(m.price_delta_minor)),
      num(i.qty),
    ),
    taxRateBp: i.tax_rate_bp === null ? fallbackRate : num(i.tax_rate_bp),
  }));
  const discountRows = await trx('discounts').where({ order_id: orderId }).orderBy('id');
  const discounts: DiscountRow[] = discountRows.map((d) => ({
    id: num(d.id),
    orderItemId: d.order_item_id === null ? null : num(d.order_item_id),
    type: d.type,
    value: num(d.value),
    reason: d.reason,
  }));
  const totals = computeTotals({
    lines,
    discounts: discounts.map((d): DiscountInput => ({
      orderItemId: d.orderItemId,
      type: d.type,
      value: d.value,
    })),
    serviceChargeBp: order.type === 'dine_in' ? settings.serviceChargeBp : 0,
  });
  return {
    orderId,
    locationId: num(order.location_id),
    type: order.type,
    settings,
    lines,
    discounts,
    totals,
  };
}

/** Recomputes and stores an order's totals (called after every change to the order). */
export async function recalcTotals(trx: Tx = defaultDb, orderId: number): Promise<LoadedTotals> {
  const loaded = await loadTotals(trx, orderId);
  const { totals } = loaded;
  await trx('orders').where({ id: orderId }).update({
    subtotal_minor: totals.subtotalMinor,
    discount_minor: totals.discountMinor,
    service_minor: totals.serviceMinor,
    tax_minor: totals.taxMinor,
    total_minor: totals.totalMinor,
  });
  for (const d of loaded.discounts) {
    const amount =
      d.orderItemId === null
        ? totals.orderDiscountMinor
        : (totals.lines.find((l) => l.id === d.orderItemId)?.itemDiscountMinor ?? 0);
    await trx('discounts').where({ id: d.id }).update({ amount_minor: amount });
  }
  await reconcileBills(trx, orderId, totals.totalMinor);
  // Something new was ordered after the table paid: it is open again.
  const order = await trx('orders').where({ id: orderId }).first('table_session_id');
  if (order?.table_session_id && totals.totalMinor > (await paidOnOrder(trx, orderId))) {
    await trx('table_sessions')
      .where({ id: order.table_session_id, status: 'paid' })
      .update({ status: 'open' });
  }
  return loaded;
}

/** What has been paid on an order (refunds are tracked separately and do not reopen it). */
export async function paidOnOrder(trx: Tx, orderId: number): Promise<number> {
  const row = await trx('payments').where({ order_id: orderId }).sum({ s: 'amount_minor' }).first();
  return num(row?.s ?? 0);
}

/**
 * A split no longer matches once the order changes (a dish added or voided, a discount): unpaid
 * bills without payments are dropped so the cashier splits again; paid bills stay as they are.
 */
async function reconcileBills(trx: Tx, orderId: number, totalMinor: number) {
  const bills = await trx('bills')
    .where({ order_id: orderId })
    .select('id', 'status', 'total_minor');
  if (!bills.length) return;
  const sum = bills.reduce((s, b) => s + num(b.total_minor), 0);
  if (sum === totalMinor) return;
  const withPayments = new Set(
    (
      await trx('payments')
        .whereIn(
          'bill_id',
          bills.map((b) => b.id),
        )
        .distinct('bill_id')
    ).map((r) => num(r.bill_id)),
  );
  const drop = bills
    .filter((b) => b.status === 'open' && !withPayments.has(num(b.id)))
    .map((b) => b.id);
  if (drop.length) await trx('bills').whereIn('id', drop).delete();
}

/** Business rule 5's counterpart: once the day is closed (Z report), nothing more is sold on it. */
export async function assertDayOpen(trx: Tx, locationId: number): Promise<string> {
  const location = await locationRepo.findLocation(locationId, trx as Knex);
  const date = businessDate(new Date(), location!.timezone);
  const closed = await trx('business_days')
    .where({ location_id: locationId, business_date: date })
    .first('id');
  if (closed) {
    throw AppError.conflict('BUSINESS_DAY_CLOSED', 'Today has been closed with a Z report.', {
      businessDate: date,
    });
  }
  return date;
}
