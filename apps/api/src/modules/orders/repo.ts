import type { Knex } from 'knex';
import {
  lineTotal,
  type Course,
  type Order,
  type OrderItem,
  type OrderItemStatus,
  type OrderSummary,
  type OrderType,
} from '@tavolina/shared';
import * as billingTotals from '../billing/totals.js';

type Tx = Knex | Knex.Transaction;

const num = (v: unknown) => Number(v);
const iso = (v: unknown) => (v ? (v as Date).toISOString() : null);
const dateOnly = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export interface OrderRow {
  id: number;
  uuid: string;
  locationId: number;
  tableSessionId: number | null;
  type: OrderType;
  status: string;
  number: number;
}

const isUuid = (ref: string | number) => typeof ref === 'string' && ref.includes('-');

/** Finds an order by id or uuid within a location (optionally locking it). */
export async function findOrderRow(
  db: Tx,
  locationId: number,
  ref: string | number,
  lock = false,
): Promise<OrderRow | undefined> {
  const q = db('orders')
    .where({ location_id: locationId })
    .where(isUuid(ref) ? { uuid: ref } : { id: Number(ref) });
  if (lock) q.forUpdate();
  const r = await q.first();
  return r
    ? {
        id: num(r.id),
        uuid: r.uuid,
        locationId: num(r.location_id),
        tableSessionId: r.table_session_id === null ? null : num(r.table_session_id),
        type: r.type,
        status: r.status,
        number: num(r.number),
      }
    : undefined;
}

export async function findOrderForSession(
  db: Tx,
  sessionId: number,
): Promise<OrderRow | undefined> {
  const r = await db('orders')
    .where({ table_session_id: sessionId, status: 'open' })
    .first('id', 'location_id');
  return r ? findOrderRow(db, num(r.location_id), num(r.id)) : undefined;
}

export async function findSessionRow(db: Tx, locationId: number, ref: string | number) {
  const r = await db('table_sessions')
    .where({ location_id: locationId })
    .where(isUuid(ref) ? { uuid: ref } : { id: Number(ref) })
    .first('id', 'status', 'waiter_id');
  return r ? { id: num(r.id), status: String(r.status), waiterId: num(r.waiter_id) } : undefined;
}

/**
 * Business rule 10: the next number for this location and business day. The upsert locks the
 * counter row until the transaction ends, so concurrent orders get distinct numbers.
 */
export async function nextNumber(
  trx: Tx,
  locationId: number,
  businessDate: string,
  kind: 'order' | 'ticket' | 'fiscal',
) {
  await trx.raw(
    'INSERT INTO daily_counters (location_id, business_date, kind, value) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE value = value + 1',
    [locationId, businessDate, kind],
  );
  const row = await trx('daily_counters')
    .where({ location_id: locationId, business_date: businessDate, kind })
    .first('value');
  return num(row.value);
}

/** Recomputes the order totals (business rule 2); see billing/totals.ts. */
export async function recalcTotals(trx: Tx, orderId: number): Promise<void> {
  await billingTotals.recalcTotals(trx, orderId);
}

async function tableNamesForSessions(db: Tx, sessionIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!sessionIds.length) return out;
  // Active sessions list their tables in table_session_tables; closed ones keep their main table.
  const linked = await db('table_session_tables as l')
    .join('tables as t', 't.id', 'l.table_id')
    .whereIn('l.session_id', sessionIds)
    .select('l.session_id', 't.name');
  for (const r of linked)
    out.set(num(r.session_id), [...(out.get(num(r.session_id)) ?? []), r.name]);
  const missing = sessionIds.filter((id) => !out.has(id));
  if (missing.length) {
    const main = await db('table_sessions as s')
      .join('tables as t', 't.id', 's.table_id')
      .whereIn('s.id', missing)
      .select('s.id', 't.name');
    for (const r of main) out.set(num(r.id), [r.name]);
  }
  for (const [k, v] of out)
    out.set(
      k,
      v.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    );
  return out;
}

function toItem(r: Record<string, unknown>, mods: Record<string, unknown>[]): OrderItem {
  const modifiers = mods
    .filter((m) => num(m.order_item_id) === num(r.id))
    .map((m) => ({
      modifierId: m.modifier_id === null ? null : num(m.modifier_id),
      name: String(m.name_snapshot),
      priceDeltaMinor: num(m.price_delta_minor),
    }));
  const status = r.status as OrderItemStatus;
  return {
    id: num(r.id),
    uuid: String(r.uuid),
    menuItemId: r.menu_item_id === null ? null : num(r.menu_item_id),
    comboId: r.combo_id === null ? null : num(r.combo_id),
    parentItemId: r.parent_item_id === null ? null : num(r.parent_item_id),
    variantId: r.variant_id === null ? null : num(r.variant_id),
    name: String(r.name_snapshot),
    variantName: (r.variant_name_snapshot as string | null) ?? null,
    unitPriceMinor: num(r.unit_price_minor),
    qty: num(r.qty),
    seat: r.seat === null ? null : num(r.seat),
    course: r.course === null ? null : (num(r.course) as Course),
    held: Boolean(r.held),
    notes: (r.notes as string | null) ?? null,
    status,
    stationId: r.station_id === null ? null : num(r.station_id),
    source: r.source as 'staff' | 'guest',
    modifiers,
    lineTotalMinor:
      status === 'voided'
        ? 0
        : lineTotal(
            num(r.unit_price_minor),
            modifiers.map((m) => m.priceDeltaMinor),
            num(r.qty),
          ),
    addedAt: iso(r.added_at)!,
    sentAt: iso(r.sent_at),
    readyAt: iso(r.ready_at),
    servedAt: iso(r.served_at),
    voidReason: (r.void_reason as string | null) ?? null,
  };
}

export async function loadOrder(db: Tx, orderId: number): Promise<Order> {
  const r = await db('orders as o')
    .leftJoin('table_sessions as s', 's.id', 'o.table_session_id')
    .leftJoin('users as w', 'w.id', db.raw('COALESCE(s.waiter_id, o.opened_by)'))
    .where('o.id', orderId)
    .first('o.*', 'w.id as waiter_id', 'w.name as waiter_name');
  const items = await db('order_items').where({ order_id: orderId }).orderBy('id');
  const mods = items.length
    ? await db('order_item_modifiers').whereIn(
        'order_item_id',
        items.map((i) => i.id),
      )
    : [];
  const names = r.table_session_id
    ? await tableNamesForSessions(db, [num(r.table_session_id)])
    : new Map();
  const orderItems = items.map((i) => toItem(i, mods));
  const heldCourses = [
    ...new Set(
      orderItems.filter((i) => i.held && i.status !== 'voided' && i.course).map((i) => i.course!),
    ),
  ].sort();
  return {
    id: num(r.id),
    uuid: r.uuid,
    number: num(r.number),
    businessDate: dateOnly(r.business_date),
    type: r.type,
    status: r.status,
    tableSessionId: r.table_session_id === null ? null : num(r.table_session_id),
    tableNames: r.table_session_id ? (names.get(num(r.table_session_id)) ?? []) : [],
    waiterId: r.waiter_id === null ? null : num(r.waiter_id),
    waiterName: r.waiter_name ?? null,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    deliveryAddress: r.delivery_address,
    pickupAt: iso(r.pickup_at),
    subtotalMinor: num(r.subtotal_minor),
    totalMinor: num(r.total_minor),
    heldCourses,
    items: orderItems,
    createdAt: iso(r.created_at)!,
  };
}

export async function listOpenOrders(db: Tx, locationId: number): Promise<OrderSummary[]> {
  const rows = await db('orders as o')
    .leftJoin('table_sessions as s', 's.id', 'o.table_session_id')
    .leftJoin('users as w', 'w.id', db.raw('COALESCE(s.waiter_id, o.opened_by)'))
    .where({ 'o.location_id': locationId, 'o.status': 'open' })
    .orderBy('o.created_at', 'desc')
    .select('o.*', 'w.name as waiter_name');
  if (!rows.length) return [];
  const counts = await db('order_items')
    .whereIn(
      'order_id',
      rows.map((r) => r.id),
    )
    .whereNull('parent_item_id')
    .whereNot('status', 'voided')
    .groupBy('order_id')
    .select('order_id', db.raw('SUM(qty) as items'), db.raw("SUM(status = 'ready') as ready"));
  const names = await tableNamesForSessions(
    db,
    rows.filter((r) => r.table_session_id).map((r) => num(r.table_session_id)),
  );
  return rows.map((r) => {
    const c = counts.find((x) => num(x.order_id) === num(r.id));
    return {
      id: num(r.id),
      uuid: r.uuid,
      number: num(r.number),
      type: r.type,
      tableNames: r.table_session_id ? (names.get(num(r.table_session_id)) ?? []) : [],
      tableSessionId: r.table_session_id === null ? null : num(r.table_session_id),
      customerName: r.customer_name,
      waiterName: r.waiter_name ?? null,
      totalMinor: num(r.total_minor),
      itemCount: c ? num(c.items) : 0,
      readyCount: c ? num(c.ready) : 0,
      createdAt: iso(r.created_at)!,
    };
  });
}

export { tableNamesForSessions };

export interface SessionOrderStats {
  totalMinor: number;
  hasOrders: boolean;
  hasReadyItems: boolean;
  pendingGuestItems: number;
}

/** Per table session: the running total and whether food is ordered / waiting at the pass. */
export async function sessionOrderStats(
  db: Tx,
  locationId: number,
): Promise<Map<number, SessionOrderStats>> {
  const rows = await db('orders as o')
    .leftJoin('order_items as i', function () {
      this.on('i.order_id', 'o.id').andOnNull('i.parent_item_id');
    })
    .where({ 'o.location_id': locationId, 'o.status': 'open' })
    .whereNotNull('o.table_session_id')
    .groupBy('o.table_session_id', 'o.total_minor')
    .select(
      'o.table_session_id',
      'o.total_minor',
      db.raw("SUM(i.status IN ('sent', 'preparing', 'ready', 'served')) as billable"),
      db.raw("SUM(i.status = 'ready') as ready"),
      db.raw("SUM(i.status = 'pending_confirmation') as pending"),
    );
  const out = new Map<number, SessionOrderStats>();
  for (const r of rows) {
    const prev = out.get(num(r.table_session_id));
    out.set(num(r.table_session_id), {
      totalMinor: (prev?.totalMinor ?? 0) + num(r.total_minor),
      hasOrders: Boolean(prev?.hasOrders) || num(r.billable) > 0,
      hasReadyItems: Boolean(prev?.hasReadyItems) || num(r.ready) > 0,
      pendingGuestItems: (prev?.pendingGuestItems ?? 0) + num(r.pending),
    });
  }
  return out;
}

/**
 * Merging tables: the merged session's items (and their kitchen tickets) join the main order.
 * When the main table has no order yet, the other order is simply re-pointed.
 */
export async function moveSessionOrder(
  trx: Tx,
  fromSessionId: number,
  toSessionId: number,
): Promise<void> {
  const from = await trx('orders')
    .where({ table_session_id: fromSessionId, status: 'open' })
    .forUpdate()
    .first('id');
  if (!from) return;
  const to = await trx('orders')
    .where({ table_session_id: toSessionId, status: 'open' })
    .forUpdate()
    .first('id');
  if (!to) {
    await trx('orders').where({ id: from.id }).update({ table_session_id: toSessionId });
    return;
  }
  await trx('order_items').where({ order_id: from.id }).update({ order_id: to.id });
  await trx('kds_tickets').where({ order_id: from.id }).update({ order_id: to.id });
  await trx('orders')
    .where({ id: from.id })
    .update({
      status: 'cancelled',
      subtotal_minor: 0,
      total_minor: 0,
      closed_at: trx.fn.now(3),
    });
  await recalcTotals(trx, num(to.id));
}

/** Interim until bills exist (Phase 6): closing the table closes its order. */
export async function closeSessionOrders(trx: Tx, sessionId: number): Promise<void> {
  await trx('orders')
    .where({ table_session_id: sessionId, status: 'open' })
    .update({ status: 'closed', closed_at: trx.fn.now(3) });
}
