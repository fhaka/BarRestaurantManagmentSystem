import type { Knex } from 'knex';
import {
  addDays,
  average,
  businessDate,
  extractTax,
  localParts,
  reportQuerySchema,
  stockValue,
  toMilli,
  zonedDateTime,
  type DashboardData,
  type DiscountsVoidsReport,
  type HoursReport,
  type InventoryReport,
  type ItemsReport,
  type OrderType,
  type PaymentMethod,
  type PaymentsReport,
  type Permission,
  type SalesReport,
  type StaffReport,
  type StockUnit,
  type TimeRange,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import type { ActorContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { getRolePermissions } from '../auth/access-repo.js';
import * as locationRepo from '../locations/repo.js';
import { hours as staffHours } from '../time/service.js';

export interface ReportActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v as Date).toISOString();
const dateText = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
/** Items that count as sold (not voided, not still a draft). */
const SOLD = ['sent', 'preparing', 'ready', 'served'];
const TZ_FALLBACK = 'Europe/Tirane';
const DAY_START_MIN = 4 * 60; // business days run 04:00 → 04:00

interface Scope {
  locationIds: number[];
  from: string;
  to: string;
  timeZone: string;
  /** The business days as instants. */
  range: TimeRange;
}

/**
 * Resolves the report's locations: the current one, or several where this user may see reports
 * (plan §5.13 "location filters"). All locations share the account's timezone.
 */
async function scope(actor: ReportActor, raw: unknown): Promise<Scope> {
  const q = reportQuerySchema.parse(raw);
  let locationIds = [actor.locationId];
  if (q.locations.length) {
    const access = await db('user_locations as ul')
      .join('locations as l', 'l.id', 'ul.location_id')
      .where({ 'ul.user_id': actor.userId, 'l.account_id': actor.accountId })
      .whereNull('l.deleted_at')
      .whereIn('ul.location_id', q.locations)
      .select('ul.location_id', 'ul.role_id');
    const allowed: number[] = [];
    for (const a of access) {
      if ((await getRolePermissions(num(a.role_id))).has('report.view'))
        allowed.push(num(a.location_id));
    }
    if (allowed.length !== q.locations.length)
      throw AppError.forbidden('You cannot see reports for one of these locations.');
    locationIds = allowed;
  }
  const timeZone = (await locationRepo.findLocation(actor.locationId))?.timezone ?? TZ_FALLBACK;
  return {
    locationIds,
    from: q.from,
    to: q.to,
    timeZone,
    range: {
      start: zonedDateTime(q.from, DAY_START_MIN, timeZone),
      end: zonedDateTime(addDays(q.to, 1), DAY_START_MIN, timeZone),
    },
  };
}

/**
 * Paid orders: closed ones, and those on a table whose bill is fully paid but that the waiter
 * has not closed yet (dine-in orders close with the table).
 */
function paidOnly<T extends Knex.QueryBuilder>(q: T): T {
  return q
    .leftJoin('table_sessions as pts', 'pts.id', 'o.table_session_id')
    .where((w) =>
      w
        .where('o.status', 'closed')
        .orWhere((x) => x.where('o.status', 'open').where('pts.status', 'paid')),
    ) as T;
}

/** Paid orders of the period. */
const closedOrders = (s: Scope) =>
  paidOnly(
    db('orders as o')
      .whereIn('o.location_id', s.locationIds)
      .whereBetween('o.business_date', [s.from, s.to]),
  );

/** Sold lines of paid orders, with modifier deltas (before bill discounts). */
function soldLines(s: Scope) {
  const deltas = db('order_item_modifiers')
    .groupBy('order_item_id')
    .select('order_item_id', db.raw('SUM(price_delta_minor) AS delta'));
  return closedOrders(s)
    .join('order_items as i', 'i.order_id', 'o.id')
    .leftJoin(deltas.as('md'), 'md.order_item_id', 'i.id')
    .whereIn('i.status', SOLD);
}
const LINE_GROSS = '(i.unit_price_minor + COALESCE(md.delta, 0)) * i.qty';

// ---- Dashboard ---------------------------------------------------------------------------------

/** Plan §5.13: today, live, for owners and managers. */
export async function dashboard(actor: ReportActor, now = new Date()): Promise<DashboardData> {
  const loc = await locationRepo.findLocation(actor.locationId);
  const tz = loc?.timezone ?? TZ_FALLBACK;
  const today = businessDate(now, tz);
  const lastWeek = addDays(today, -7);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const where = { location_id: actor.locationId };

  const [paid, previous, open, sessionsToday, top, prep, low, voids] = await Promise.all([
    paidOnly(
      db('orders as o').where({ 'o.location_id': actor.locationId, 'o.business_date': today }),
    ).select('o.total_minor', db.raw('COALESCE(o.closed_at, pts.updated_at) AS closed_at')),
    paidOnly(
      db('orders as o').where({ 'o.location_id': actor.locationId, 'o.business_date': lastWeek }),
    ).select('o.total_minor', db.raw('COALESCE(o.closed_at, pts.updated_at) AS closed_at')),
    db('orders as o')
      .leftJoin('table_sessions as ts', 'ts.id', 'o.table_session_id')
      .where({ 'o.location_id': actor.locationId, 'o.status': 'open' })
      .where((w) => w.whereNull('ts.status').orWhereNot('ts.status', 'paid'))
      .sum({ total: 'o.total_minor' })
      .first(),
    db('table_sessions')
      .where(where)
      .where('opened_at', '>=', zonedDateTime(today, DAY_START_MIN, tz))
      .select('guest_count', 'status'),
    db('order_items as i')
      .join('orders as o', 'o.id', 'i.order_id')
      .where({ 'o.location_id': actor.locationId, 'o.business_date': today })
      .whereIn('i.status', SOLD)
      .whereNull('i.parent_item_id')
      .groupBy('i.name_snapshot')
      .orderBy('qty', 'desc')
      .limit(8)
      .select(
        'i.name_snapshot as name',
        db.raw('SUM(i.qty) AS qty'),
        db.raw('SUM(i.unit_price_minor * i.qty) AS revenue'),
      ),
    db('order_items as i')
      .join('orders as o', 'o.id', 'i.order_id')
      .join('stations as s', 's.id', 'i.station_id')
      .where({ 'o.location_id': actor.locationId, 'o.business_date': today })
      .whereNotNull('i.ready_at')
      .whereNotNull('i.sent_at')
      .groupBy('s.id', 's.name')
      .select(
        's.id',
        's.name',
        db.raw('AVG(TIMESTAMPDIFF(SECOND, i.sent_at, i.ready_at)) / 60 AS minutes'),
        db.raw('COUNT(*) AS items'),
      ),
    db('ingredients')
      .where({ ...where, active: true })
      .whereNull('deleted_at')
      .where('min_qty', '>', 0)
      .whereRaw('stock_qty < min_qty')
      .orderBy('name')
      .select('id', 'name', 'unit', 'stock_qty', 'min_qty'),
    db('order_items as i')
      .join('orders as o', 'o.id', 'i.order_id')
      .where({ 'o.location_id': actor.locationId, 'o.business_date': today, 'i.status': 'voided' })
      .select(
        db.raw('COUNT(*) AS n'),
        db.raw('COALESCE(SUM(i.unit_price_minor * i.qty), 0) AS amount'),
      )
      .first(),
  ]);

  const revenueMinor = paid.reduce((s, o) => s + num(o.total_minor), 0);
  // In business-day order, 04:00 … 03:00, so after-midnight sales come last.
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: (i + 4) % 24,
    todayMinor: 0,
    lastWeekMinor: 0,
  }));
  const slot = (at: Date) => (((localParts(at, tz).minutes / 60) | 0) + 20) % 24;
  for (const o of paid) hourly[slot(o.closed_at)]!.todayMinor += num(o.total_minor);
  for (const o of previous) hourly[slot(o.closed_at)]!.lastWeekMinor += num(o.total_minor);
  const openTables = await db('table_sessions')
    .where(where)
    .whereNot('status', 'closed')
    .count({ n: '*' })
    .first();

  return {
    businessDate: today,
    generatedAt: now.toISOString(),
    revenueMinor,
    revenueLastWeekMinor: previous
      .filter((o) => (o.closed_at as Date) <= weekAgo)
      .reduce((s, o) => s + num(o.total_minor), 0),
    orders: paid.length,
    avgTicketMinor: average(revenueMinor, paid.length),
    covers: sessionsToday.reduce((s, r) => s + num(r.guest_count), 0),
    openTables: num(openTables?.n),
    openOrdersMinor: num(open?.total),
    hourly,
    topItems: top.map((r) => ({
      name: String(r.name),
      qty: num(r.qty),
      revenueMinor: num(r.revenue),
    })),
    prepTimes: prep.map((r) => ({
      stationId: num(r.id),
      name: String(r.name),
      avgMinutes: Math.round(num(r.minutes) * 10) / 10,
      items: num(r.items),
    })),
    lowStock: low.map((r) => ({
      id: num(r.id),
      name: String(r.name),
      unit: r.unit as StockUnit,
      stockMilli: toMilli(String(r.stock_qty)),
      minMilli: toMilli(String(r.min_qty)),
    })),
    voids: { count: num(voids?.n), amountMinor: num(voids?.amount) },
  };
}

// ---- Sales -------------------------------------------------------------------------------------

export async function sales(actor: ReportActor, raw: unknown): Promise<SalesReport> {
  const s = await scope(actor, raw);
  const [orders, categories, refunds] = await Promise.all([
    closedOrders(s)
      .leftJoin('table_sessions as ts', 'ts.id', 'o.table_session_id')
      .select(
        'o.business_date',
        'o.created_at',
        'o.type',
        'o.total_minor',
        'o.tax_minor',
        'o.discount_minor',
        'ts.guest_count',
      ),
    soldLines(s)
      .leftJoin('menu_items as m', 'm.id', 'i.menu_item_id')
      .leftJoin('menu_categories as c', 'c.id', 'm.category_id')
      .whereNull('i.parent_item_id')
      .groupBy('c.name')
      .select('c.name', db.raw('SUM(i.qty) AS qty'), db.raw(`SUM(${LINE_GROSS}) AS revenue`))
      .orderBy('revenue', 'desc'),
    db('refunds as r')
      .join('payments as p', 'p.id', 'r.payment_id')
      .whereIn('p.location_id', s.locationIds)
      .whereBetween('r.business_date', [s.from, s.to])
      .sum({ total: 'r.amount_minor' })
      .first(),
  ]);

  const daily = new Map<string, { revenueMinor: number; orders: number; covers: number }>();
  for (let d = s.from; d <= s.to; d = addDays(d, 1))
    daily.set(d, { revenueMinor: 0, orders: 0, covers: 0 });
  const heat = new Map<string, { revenueMinor: number; orders: number }>();
  const types = new Map<OrderType, { orders: number; revenueMinor: number }>();
  let revenue = 0;
  let tax = 0;
  let discount = 0;
  let covers = 0;
  for (const o of orders) {
    const total = num(o.total_minor);
    const guests = o.guest_count === null ? 0 : num(o.guest_count);
    revenue += total;
    tax += num(o.tax_minor);
    discount += num(o.discount_minor);
    covers += guests;
    const day = daily.get(dateText(o.business_date));
    if (day) {
      day.revenueMinor += total;
      day.orders += 1;
      day.covers += guests;
    }
    const local = localParts(o.created_at, s.timeZone);
    const key = `${local.weekday}:${(local.minutes / 60) | 0}`;
    const cell = heat.get(key) ?? { revenueMinor: 0, orders: 0 };
    cell.revenueMinor += total;
    cell.orders += 1;
    heat.set(key, cell);
    const t = types.get(o.type) ?? { orders: 0, revenueMinor: 0 };
    t.orders += 1;
    t.revenueMinor += total;
    types.set(o.type, t);
  }
  const refundsMinor = num(refunds?.total);
  return {
    totals: {
      revenueMinor: revenue,
      orders: orders.length,
      covers,
      avgTicketMinor: average(revenue, orders.length),
      taxMinor: tax,
      discountMinor: discount,
      refundsMinor,
      netMinor: revenue - refundsMinor,
    },
    daily: [...daily].map(([date, d]) => ({
      date,
      ...d,
      avgTicketMinor: average(d.revenueMinor, d.orders),
    })),
    heatmap: [...heat].map(([key, v]) => {
      const [weekday, hour] = key.split(':').map(Number);
      return { weekday: weekday!, hour: hour!, ...v };
    }),
    byCategory: categories.map((c) => ({
      name: c.name ?? '—',
      qty: num(c.qty),
      revenueMinor: num(c.revenue),
    })),
    byType: [...types]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor),
  };
}

// ---- Product mix and margin --------------------------------------------------------------------

export async function items(actor: ReportActor, raw: unknown): Promise<ItemsReport> {
  const s = await scope(actor, raw);
  const rows = await soldLines(s)
    .leftJoin('menu_items as m', 'm.id', 'i.menu_item_id')
    .leftJoin('menu_categories as c', 'c.id', 'm.category_id')
    .whereNull('i.parent_item_id')
    .groupBy('i.menu_item_id', 'i.name_snapshot', 'c.name', 'm.cost_minor', 'i.tax_rate_bp')
    .select(
      'i.menu_item_id',
      'i.name_snapshot as name',
      'c.name as category',
      'm.cost_minor',
      'i.tax_rate_bp',
      db.raw('SUM(i.qty) AS qty'),
      db.raw(`SUM(${LINE_GROSS}) AS revenue`),
    );
  // One row per menu item (a VAT rate change could split it in SQL).
  const merged = new Map<string, ItemsReport['rows'][number]>();
  for (const r of rows) {
    const key = r.menu_item_id === null ? `n:${r.name}` : `m:${r.menu_item_id}`;
    const revenue = num(r.revenue);
    const net = revenue - extractTax(revenue, num(r.tax_rate_bp ?? 0));
    const cost = r.cost_minor === null ? null : num(r.cost_minor) * num(r.qty);
    const row = merged.get(key) ?? {
      menuItemId: r.menu_item_id === null ? null : num(r.menu_item_id),
      name: String(r.name),
      category: r.category ?? null,
      qty: 0,
      revenueMinor: 0,
      netMinor: 0,
      costMinor: cost === null ? null : 0,
      marginMinor: null,
      marginBp: null,
      shareBp: 0,
    };
    row.qty += num(r.qty);
    row.revenueMinor += revenue;
    row.netMinor += net;
    if (row.costMinor !== null && cost !== null) row.costMinor += cost;
    merged.set(key, row);
  }
  const total = [...merged.values()].reduce((sum, r) => sum + r.revenueMinor, 0);
  return {
    rows: [...merged.values()]
      .map((r) => {
        const marginMinor = r.costMinor === null ? null : r.netMinor - r.costMinor;
        return {
          ...r,
          marginMinor,
          marginBp:
            marginMinor === null || r.netMinor <= 0
              ? null
              : Math.round((marginMinor * 10_000) / r.netMinor),
          shareBp: total > 0 ? Math.round((r.revenueMinor * 10_000) / total) : 0,
        };
      })
      .sort((a, b) => b.revenueMinor - a.revenueMinor),
  };
}

// ---- Staff, payments, tips ---------------------------------------------------------------------

export async function staff(actor: ReportActor, raw: unknown): Promise<StaffReport> {
  const s = await scope(actor, raw);
  const [orders, tips, voids] = await Promise.all([
    closedOrders(s)
      .join('users as u', 'u.id', 'o.opened_by')
      .leftJoin('table_sessions as ts', 'ts.id', 'o.table_session_id')
      .groupBy('u.id', 'u.name')
      .select(
        'u.id',
        'u.name',
        db.raw('COUNT(*) AS orders'),
        db.raw('SUM(o.total_minor) AS revenue'),
        db.raw('COALESCE(SUM(ts.guest_count), 0) AS covers'),
      ),
    db('payments')
      .whereIn('location_id', s.locationIds)
      .whereBetween('business_date', [s.from, s.to])
      .whereNotNull('tip_user_id')
      .groupBy('tip_user_id')
      .select('tip_user_id', db.raw('SUM(tip_minor) AS tips')),
    db('order_items as i')
      .join('orders as o', 'o.id', 'i.order_id')
      .whereIn('o.location_id', s.locationIds)
      .whereBetween('o.business_date', [s.from, s.to])
      .where('i.status', 'voided')
      .groupBy('i.voided_by')
      .select('i.voided_by', db.raw('COUNT(*) AS n')),
  ]);
  const tipsBy = new Map(tips.map((t) => [num(t.tip_user_id), num(t.tips)]));
  const voidsBy = new Map(voids.map((v) => [num(v.voided_by), num(v.n)]));
  const names = new Map(orders.map((o) => [num(o.id), String(o.name)]));
  // People who only received tips or voided items still appear.
  const extra = [...new Set([...tipsBy.keys(), ...voidsBy.keys()])].filter(
    (id) => id && !names.has(id),
  );
  if (extra.length) {
    for (const u of await db('users').whereIn('id', extra).select('id', 'name'))
      names.set(num(u.id), String(u.name));
  }
  const byId = new Map(orders.map((o) => [num(o.id), o]));
  return {
    rows: [...names]
      .map(([userId, name]) => {
        const o = byId.get(userId);
        const revenueMinor = num(o?.revenue);
        const count = num(o?.orders);
        return {
          userId,
          name,
          orders: count,
          covers: num(o?.covers),
          revenueMinor,
          avgTicketMinor: average(revenueMinor, count),
          tipsMinor: tipsBy.get(userId) ?? 0,
          voids: voidsBy.get(userId) ?? 0,
        };
      })
      .sort((a, b) => b.revenueMinor - a.revenueMinor),
  };
}

export async function payments(actor: ReportActor, raw: unknown): Promise<PaymentsReport> {
  const s = await scope(actor, raw);
  const [rows, refunds] = await Promise.all([
    db('payments')
      .whereIn('location_id', s.locationIds)
      .whereBetween('business_date', [s.from, s.to])
      .groupBy('method')
      .select(
        'method',
        db.raw('COUNT(*) AS n'),
        db.raw('SUM(amount_minor) AS amount'),
        db.raw('SUM(tip_minor) AS tips'),
      ),
    db('refunds as r')
      .join('payments as p', 'p.id', 'r.payment_id')
      .whereIn('p.location_id', s.locationIds)
      .whereBetween('r.business_date', [s.from, s.to])
      .select(db.raw('COUNT(*) AS n'), db.raw('COALESCE(SUM(r.amount_minor), 0) AS amount'))
      .first(),
  ]);
  const out = rows
    .map((r) => ({
      method: r.method as PaymentMethod,
      count: num(r.n),
      amountMinor: num(r.amount),
      tipsMinor: num(r.tips),
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  return {
    rows: out,
    refunds: { count: num(refunds?.n), amountMinor: num(refunds?.amount) },
    totalMinor: out.reduce((sum, r) => sum + r.amountMinor, 0),
  };
}

// ---- Discounts, voids, refunds (with who approved) ---------------------------------------------

export async function discountsVoids(
  actor: ReportActor,
  raw: unknown,
): Promise<DiscountsVoidsReport> {
  const s = await scope(actor, raw);
  const inScope = (q: Knex.QueryBuilder, alias = 'o') =>
    q
      .whereIn(`${alias}.location_id`, s.locationIds)
      .whereBetween(`${alias}.business_date`, [s.from, s.to]);
  const [discounts, voids, refunds] = await Promise.all([
    inScope(
      db('discounts as d')
        .join('orders as o', 'o.id', 'd.order_id')
        .leftJoin('users as c', 'c.id', 'd.created_by')
        .leftJoin('users as a', 'a.id', 'd.approved_by'),
    )
      .orderBy('d.created_at', 'desc')
      .select(
        'd.*',
        'o.number',
        'o.business_date',
        'c.name as created_name',
        'a.name as approved_name',
      ),
    inScope(
      db('order_items as i')
        .join('orders as o', 'o.id', 'i.order_id')
        .leftJoin('users as v', 'v.id', 'i.voided_by')
        .leftJoin('users as a', 'a.id', 'i.void_approved_by'),
    )
      .where('i.status', 'voided')
      .orderBy('i.voided_at', 'desc')
      .select(
        'i.*',
        'o.number',
        'o.business_date',
        'v.name as voided_name',
        'a.name as approved_name',
      ),
    db('refunds as r')
      .join('payments as p', 'p.id', 'r.payment_id')
      .join('orders as o', 'o.id', 'p.order_id')
      .leftJoin('users as c', 'c.id', 'r.created_by')
      .leftJoin('users as a', 'a.id', 'r.approved_by')
      .whereIn('p.location_id', s.locationIds)
      .whereBetween('r.business_date', [s.from, s.to])
      .orderBy('r.created_at', 'desc')
      .select('r.*', 'p.method', 'o.number', 'c.name as created_name', 'a.name as approved_name'),
  ]);
  return {
    discounts: discounts.map((d: Row) => ({
      at: iso(d.created_at),
      date: dateText(d.business_date),
      orderNumber: num(d.number),
      reason: String(d.reason),
      type: d.type as 'percent' | 'fixed',
      value: num(d.value),
      amountMinor: num(d.amount_minor),
      createdBy: (d.created_name as string | null) ?? null,
      approvedBy: (d.approved_name as string | null) ?? null,
    })),
    voids: voids.map((v: Row) => ({
      at: iso(v.voided_at ?? v.updated_at),
      date: dateText(v.business_date),
      orderNumber: num(v.number),
      item: String(v.name_snapshot),
      qty: num(v.qty),
      amountMinor: num(v.unit_price_minor) * num(v.qty),
      reason: (v.void_reason as string | null) ?? null,
      voidedBy: (v.voided_name as string | null) ?? null,
      approvedBy: (v.approved_name as string | null) ?? null,
    })),
    refunds: refunds.map((r) => ({
      at: iso(r.created_at),
      date: dateText(r.business_date),
      orderNumber: num(r.number),
      method: r.method,
      amountMinor: num(r.amount_minor),
      reason: String(r.reason),
      createdBy: r.created_name ?? null,
      approvedBy: r.approved_name ?? null,
    })),
  };
}

// ---- Inventory ---------------------------------------------------------------------------------

export async function inventory(actor: ReportActor, raw: unknown): Promise<InventoryReport> {
  const s = await scope(actor, raw);
  const [ingredients, moves] = await Promise.all([
    db('ingredients')
      .whereIn('location_id', s.locationIds)
      .whereNull('deleted_at')
      .orderBy(['category', 'name'])
      .select('id', 'name', 'unit', 'category', 'stock_qty', 'cost_per_unit_minor'),
    db('stock_movements')
      .whereIn('location_id', s.locationIds)
      .where('created_at', '>=', s.range.start)
      .where('created_at', '<', s.range.end)
      .groupBy('ingredient_id', 'type', 'ref_type')
      .select(
        'ingredient_id',
        'type',
        'ref_type',
        db.raw('SUM(qty) AS qty'),
        db.raw('SUM(qty * unit_cost_minor) AS value'),
      ),
  ]);
  const sum = (id: number, test: (m: (typeof moves)[number]) => boolean) =>
    moves
      .filter((m) => num(m.ingredient_id) === id && test(m))
      .reduce(
        (acc, m) => ({
          milli: acc.milli + toMilli(String(m.qty)),
          minor: acc.minor + Math.round(num(m.value)),
        }),
        { milli: 0, minor: 0 },
      );
  return {
    rows: ingredients.map((i) => {
      const id = num(i.id);
      const stock = toMilli(String(i.stock_qty));
      // Sales minus what voids gave back; waste includes staff meals.
      const consumed = sum(id, (m) => m.type === 'sale' || m.type === 'sale_reversal');
      const waste = sum(id, (m) => m.type === 'waste' || m.type === 'staff_meal');
      const variance = sum(id, (m) => m.type === 'count_adjust' && m.ref_type === 'stock_count');
      const purchased = sum(id, (m) => m.type === 'purchase');
      return {
        ingredientId: id,
        name: String(i.name),
        unit: i.unit as StockUnit,
        category: String(i.category ?? ''),
        stockMilli: stock,
        valueMinor: stockValue(Math.max(0, stock), num(i.cost_per_unit_minor)),
        purchasedMilli: purchased.milli,
        consumedMilli: -consumed.milli,
        consumedMinor: -consumed.minor,
        wasteMilli: -waste.milli,
        wasteMinor: -waste.minor,
        varianceMilli: variance.milli,
        varianceMinor: variance.minor,
      };
    }),
  };
}

// ---- Staff hours -------------------------------------------------------------------------------

export async function hoursReport(actor: ReportActor, raw: unknown): Promise<HoursReport> {
  const s = await scope(actor, raw);
  return { rows: await staffHours(actor, { from: s.from, to: s.to }) };
}
