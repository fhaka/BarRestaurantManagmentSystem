import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import {
  addDays,
  businessDate,
  computeTotals,
  consumption,
  fromMilli,
  toMilli,
  weekdayOf,
  zonedDateTime,
  type DiscountInput,
  type RecipeLineInput,
} from '@tavolina/shared';
import { randomToken } from '../../lib/crypto.js';

/**
 * Plan §14: 30 days of past service so the dashboard and reports have something to show. Each day
 * follows the rhythm of a Tirana bar-restaurant — the morning coffee rush, lunch, a quiet
 * afternoon, beers and dinner in the evening, busier at the weekend. Everything is paid and
 * closed; a few items are voided, a few bills discounted, a couple of payments refunded, and the
 * stock ledger books out what was sold. Repeatable: the same seed gives the same history.
 */

const TZ = 'Europe/Tirane';
const DAYS = 30;
const MIN = 60_000;

// mulberry32: small, fast, repeatable.
let state = 20261014;
function rand(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const chance = (p: number) => rand() < p;
function pick<T>(items: readonly T[], weight: (t: T) => number = () => 1): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let r = rand() * total;
  for (const i of items) {
    r -= weight(i);
    if (r <= 0) return i;
  }
  return items[items.length - 1]!;
}

/** Orders started per hour on an ordinary weekday (local time). */
const HOURLY: Record<number, number> = {
  7: 6,
  8: 10,
  9: 9,
  10: 7,
  11: 5,
  12: 7,
  13: 9,
  14: 7,
  15: 4,
  16: 4,
  17: 5,
  18: 6,
  19: 9,
  20: 11,
  21: 9,
  22: 6,
};
/** Monday … Sunday. */
const WEEKDAY_FACTOR = [0.85, 0.9, 0.95, 1, 1.2, 1.35, 1.15];

type Moment = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'dinner' | 'late';
const momentOf = (hour: number): Moment =>
  hour < 11
    ? 'morning'
    : hour < 15
      ? 'lunch'
      : hour < 18
        ? 'afternoon'
        : hour < 19
          ? 'evening'
          : hour < 22
            ? 'dinner'
            : 'late';

const VOID_REASONS = ['Klienti ndryshoi mendje', 'Gabim në porosi', 'U vonua shumë', 'U derdh'];
const DISCOUNTS: [string, number, boolean][] = [
  ['Klient i rregullt', 1000, false],
  ['Ditëlindje', 2000, true],
  ['Vonesë në shërbim', 1500, true],
];
const REFUND_REASONS = ['Pjata u kthye e ftohtë', 'Pagesë e dyfishtë me kartë'];
const CUSTOMERS = [
  'Ardit',
  'Besa',
  'Endri',
  'Jonida',
  'Mateo',
  'Klea',
  'Orges',
  'Rea',
  'Gerti',
  'Alba',
];

interface MenuItem {
  id: number;
  name: string;
  category: string;
  priceMinor: number;
  stationId: number | null;
  rateBp: number;
  prep: number;
  variants: { id: number; name: string; priceMinor: number }[];
}

export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number }>('id');
  if (!location) throw new Error('Run 01_demo_access first');
  const locationId = location.id;
  const users = new Map(
    (await knex('users').select('id', 'name')).map((u) => [u.name as string, Number(u.id)]),
  );
  const manager = users.get('Elira Shehu')!;
  const cashier = users.get('Anisa Gjoni')!;
  const morningWaiters = [users.get('Klajdi Dervishi')!, users.get('Sara Leka')!];
  const eveningWaiters = [users.get('Sara Leka')!, users.get('Dritan Muça')!];

  const defaultRate = Number(
    (await knex('tax_rates').where({ location_id: locationId, is_default: true }).first('rate_bp'))
      ?.rate_bp ?? 2000,
  );
  const rows = await knex('menu_items as m')
    .join('menu_categories as c', 'c.id', 'm.category_id')
    .leftJoin('tax_rates as t', 't.id', 'm.tax_rate_id')
    .where('m.location_id', locationId)
    .whereNull('m.deleted_at')
    .select(
      'm.id',
      'm.name',
      'm.price_minor',
      'm.station_id',
      'm.prep_minutes',
      'c.name as category',
      't.rate_bp',
    );
  const variants = await knex('menu_item_variants').select('id', 'item_id', 'name', 'price_minor');
  const menu: MenuItem[] = rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    category: String(r.category),
    priceMinor: Number(r.price_minor),
    stationId: r.station_id === null ? null : Number(r.station_id),
    rateBp: r.rate_bp === null ? defaultRate : Number(r.rate_bp),
    prep: Number(r.prep_minutes ?? 5) || 5,
    variants: variants
      .filter((v) => Number(v.item_id) === Number(r.id))
      .map((v) => ({ id: Number(v.id), name: String(v.name), priceMinor: Number(v.price_minor) })),
  }));
  const inCategory = (...names: string[]) => menu.filter((m) => names.includes(m.category));
  const coffees = inCategory('Kafe', 'Çajra');
  const softs = inCategory('Pije freskuese');
  const alcohol = inCategory('Birra', 'Verë dhe raki');
  const breakfast = inCategory('Mëngjes');
  const starters = inCategory('Sallata', 'Antipasta');
  const mains = inCategory('Pjata kryesore', 'Pasta dhe rizoto');
  const desserts = inCategory('Ëmbëlsira');
  const popular = new Set([
    'Kapuçino',
    'Espresso',
    'Makiato',
    'Birra Korça 0.5 l',
    'Tavë kosi',
    'Fërgesë Tirane',
    'Byrek me spinaq',
    'Trileçe',
  ]);
  const weight = (m: MenuItem) => (popular.has(m.name) ? 4 : 1);

  /** What one guest has at a given moment of the day. */
  function guestOrder(moment: Moment): MenuItem[] {
    const out: MenuItem[] = [];
    switch (moment) {
      case 'morning':
        out.push(pick(coffees, weight));
        if (chance(0.35)) out.push(pick(breakfast, weight));
        if (chance(0.3)) out.push(pick(softs, weight));
        break;
      case 'lunch':
        out.push(pick(chance(0.6) ? softs : coffees, weight));
        if (chance(0.75)) out.push(pick(mains, weight));
        if (chance(0.35)) out.push(pick(starters, weight));
        if (chance(0.2)) out.push(pick(desserts, weight));
        break;
      case 'afternoon':
        out.push(pick(chance(0.6) ? coffees : softs, weight));
        if (chance(0.25)) out.push(pick(desserts, weight));
        break;
      case 'evening':
      case 'late':
        out.push(pick(chance(0.7) ? alcohol : softs, weight));
        if (chance(0.4)) out.push(pick(alcohol, weight));
        if (chance(0.2)) out.push(pick(starters, weight));
        break;
      case 'dinner':
        out.push(pick(chance(0.65) ? alcohol : softs, weight));
        if (chance(0.85)) out.push(pick(mains, weight));
        if (chance(0.45)) out.push(pick(starters, weight));
        if (chance(0.3)) out.push(pick(desserts, weight));
        if (chance(0.3)) out.push(pick(alcohol, weight));
        break;
    }
    return out;
  }

  const tables = (
    await knex('tables').where({ location_id: locationId, active: true }).select('id', 'seats')
  ).map((t) => ({
    id: Number(t.id),
    seats: Number(t.seats),
  }));
  const recipeRows = await knex('recipe_lines').select(
    'menu_item_id',
    'variant_id',
    'modifier_id',
    'ingredient_id',
    'qty',
  );
  const recipes = new Map<number, RecipeLineInput[]>();
  for (const r of recipeRows) {
    if (r.menu_item_id === null) continue;
    const id = Number(r.menu_item_id);
    recipes.set(id, [
      ...(recipes.get(id) ?? []),
      {
        ingredientId: Number(r.ingredient_id),
        qtyMilli: toMilli(String(r.qty)),
        variantId: r.variant_id === null ? null : Number(r.variant_id),
      },
    ]);
  }

  const today = businessDate(new Date(), TZ);
  // Rows are built in memory with their ids and inserted in batches (much faster than one by one).
  const nextId = async (table: string) =>
    Number((await knex(table).max({ m: 'id' }).first())?.m ?? 0) + 1;
  const ids = {
    session: await nextId('table_sessions'),
    order: await nextId('orders'),
    item: await nextId('order_items'),
    bill: await nextId('bills'),
    payment: await nextId('payments'),
  };
  const batch: Record<
    'table_sessions' | 'orders' | 'order_items' | 'discounts' | 'bills' | 'payments',
    Record<string, unknown>[]
  > = {
    table_sessions: [],
    orders: [],
    order_items: [],
    discounts: [],
    bills: [],
    payments: [],
  };
  /** Consumption per ingredient per business date, for the stock ledger. */
  const used = new Map<string, Map<number, number>>();
  const paymentsForRefund: { id: number; amount: number; date: string; at: Date }[] = [];

  // Today's service so far is history too (paid and gone), after the live orders' numbers.
  const now = Date.now();
  const todayNumbers = Number(
    (
      await knex('orders')
        .where({ location_id: locationId, business_date: today })
        .max({ n: 'number' })
        .first()
    )?.n ?? 0,
  );
  // The e2e database leaves today clean, so its till and report assertions start from zero.
  const includeToday = process.env.SEED_HISTORY_TODAY !== 'false';
  const lastNumber = new Map<string, number>();
  for (let d = DAYS; d >= (includeToday ? 0 : 1); d--) {
    const date = addDays(today, -d);
    const factor = WEEKDAY_FACTOR[weekdayOf(date)]!;
    let number = d === 0 ? todayNumbers : 0;
    const dayUse = new Map<number, number>();
    used.set(date, dayUse);

    for (const [hourText, base] of Object.entries(HOURLY)) {
      const hour = Number(hourText);
      const count = Math.max(0, Math.round(base * factor * (0.8 + rand() * 0.4)));
      for (let n = 0; n < count; n++) {
        const at = zonedDateTime(date, hour * 60 + between(0, 59), TZ);
        const moment = momentOf(hour);
        const type = chance(0.86) ? 'dine_in' : chance(0.8) ? 'takeaway' : 'delivery';
        const guests = type === 'dine_in' ? pick([1, 2, 2, 2, 3, 4, 4, 5, 6]) : between(1, 3);
        const waiter = pick(hour < 15 ? morningWaiters : eveningWaiters);
        const lines = Array.from({ length: guests }, () => guestOrder(moment)).flat();
        if (!lines.length) continue;
        const stay =
          type === 'dine_in'
            ? moment === 'morning' || moment === 'afternoon'
              ? between(20, 50)
              : between(45, 110)
            : between(10, 25);
        const closedAt = new Date(at.getTime() + stay * MIN);
        // Today: only guests who have already paid and left.
        if (closedAt.getTime() > now - 10 * MIN) continue;

        let sessionId: number | null = null;
        if (type === 'dine_in') {
          const table = pick(
            tables.filter((t) => t.seats >= Math.min(guests, 8)).length
              ? tables.filter((t) => t.seats >= Math.min(guests, 8))
              : tables,
          );
          sessionId = ids.session++;
          batch.table_sessions.push({
            id: sessionId,
            uuid: randomUUID(),
            location_id: locationId,
            table_id: table.id,
            waiter_id: waiter,
            guest_count: guests,
            status: 'closed',
            opened_at: at,
            closed_at: closedAt,
            closed_by: waiter,
            created_at: at,
          });
        }
        number++;
        lastNumber.set(date, number);
        const orderId = ids.order++;
        const order: Record<string, unknown> = {
          id: orderId,
          uuid: randomUUID(),
          location_id: locationId,
          table_session_id: sessionId,
          type,
          number,
          business_date: date,
          status: 'closed',
          customer_name: type === 'dine_in' ? null : pick(CUSTOMERS),
          customer_phone:
            type === 'delivery' ? `+355 69 ${between(100, 999)} ${between(1000, 9999)}` : null,
          delivery_address:
            type === 'delivery' ? `Rruga e Kavajës ${between(1, 200)}, Tiranë` : null,
          opened_by: waiter,
          closed_at: closedAt,
          created_at: at,
        };
        batch.orders.push(order);

        // Items, with the kitchen's timings.
        const totalsLines: { id: number; grossMinor: number; taxRateBp: number }[] = [];
        for (const [i, item] of lines.entries()) {
          const variant = item.variants.length ? pick(item.variants) : null;
          const price = variant?.priceMinor ?? item.priceMinor;
          const added = new Date(at.getTime() + (i < guests ? 0 : between(0, 3)) * MIN);
          const started = new Date(added.getTime() + between(0, 3) * MIN);
          const ready = new Date(started.getTime() + Math.max(1, item.prep + between(-2, 6)) * MIN);
          const voided = chance(0.018);
          const itemId = ids.item++;
          batch.order_items.push({
            id: itemId,
            uuid: randomUUID(),
            order_id: orderId,
            menu_item_id: item.id,
            variant_id: variant?.id ?? null,
            name_snapshot: item.name,
            variant_name_snapshot: variant?.name ?? null,
            unit_price_minor: price,
            qty: 1,
            status: voided ? 'voided' : 'served',
            station_id: item.stationId,
            source: 'staff',
            added_by: waiter,
            added_at: added,
            sent_at: added,
            started_at: item.stationId ? started : null,
            ready_at: item.stationId ? ready : null,
            served_at: voided ? null : new Date(ready.getTime() + between(1, 4) * MIN),
            voided_at: voided ? new Date(added.getTime() + between(2, 15) * MIN) : null,
            void_reason: voided ? pick(VOID_REASONS) : null,
            voided_by: voided ? waiter : null,
            void_approved_by: voided ? manager : null,
            tax_rate_bp: item.rateBp,
            stock_deducted: !voided,
            created_at: added,
          });
          if (voided) continue;
          totalsLines.push({ id: Number(itemId), grossMinor: price, taxRateBp: item.rateBp });
          for (const [ingredientId, q] of consumption(
            1,
            recipes.get(item.id) ?? [],
            variant?.id ?? null,
            [],
          )) {
            dayUse.set(ingredientId, (dayUse.get(ingredientId) ?? 0) + q);
          }
        }
        if (!totalsLines.length) {
          order.status = 'cancelled';
          continue;
        }

        // Now and then a discount on the bill.
        const discounts: DiscountInput[] = [];
        if (chance(0.035)) {
          const [reason, bp, needsApproval] = pick(DISCOUNTS);
          discounts.push({ orderItemId: null, type: 'percent', value: bp });
          const totalsBefore = computeTotals({
            lines: totalsLines,
            discounts: [],
            serviceChargeBp: 0,
          });
          batch.discounts.push({
            order_id: orderId,
            order_item_id: null,
            type: 'percent',
            value: bp,
            amount_minor: Math.round((totalsBefore.totalMinor * bp) / 10_000 / 100) * 100,
            reason,
            created_by: waiter,
            approved_by: needsApproval ? manager : null,
            created_at: new Date(closedAt.getTime() - 5 * MIN),
          });
        }
        const totals = computeTotals({ lines: totalsLines, discounts, serviceChargeBp: 0 });
        Object.assign(order, {
          subtotal_minor: totals.subtotalMinor,
          discount_minor: totals.discountMinor,
          service_minor: totals.serviceMinor,
          tax_minor: totals.taxMinor,
          total_minor: totals.totalMinor,
        });
        const billId = ids.bill++;
        batch.bills.push({
          id: billId,
          order_id: orderId,
          split_type: 'full',
          label: '',
          sort: 0,
          total_minor: totals.totalMinor,
          status: 'paid',
          tax: JSON.stringify(totals.tax),
          receipt_token: randomToken(18),
          created_at: closedAt,
          paid_at: closedAt,
        });

        // Paid in cash, by card or with a voucher; card payers often tip their waiter.
        const method = pick(['cash', 'card', 'voucher'] as const, (m) =>
          m === 'cash' ? 55 : m === 'card' ? 40 : 5,
        );
        const tip =
          method === 'card' && chance(0.35)
            ? Math.round((totals.totalMinor * between(5, 10)) / 100 / 5000) * 5000
            : method === 'cash' && chance(0.15)
              ? 10_000
              : 0;
        const tendered = method === 'cash' ? Math.ceil(totals.totalMinor / 50_000) * 50_000 : null;
        const paymentId = ids.payment++;
        batch.payments.push({
          id: paymentId,
          uuid: randomUUID(),
          location_id: locationId,
          order_id: orderId,
          bill_id: billId,
          method,
          amount_minor: totals.totalMinor,
          tip_minor: tip,
          tendered_minor: tendered,
          change_minor: tendered === null ? 0 : tendered - totals.totalMinor,
          reference: method === 'card' ? `TRM-${between(100000, 999999)}` : null,
          tip_user_id: tip ? waiter : null,
          taken_by: hour >= 8 && hour < 16 ? cashier : waiter,
          drawer_id: null,
          business_date: date,
          created_at: closedAt,
        });
        if (method === 'card' && totals.totalMinor > 200_000) {
          paymentsForRefund.push({
            id: Number(paymentId),
            amount: totals.totalMinor,
            date,
            at: closedAt,
          });
        }
      }
    }

    // A little waste each day: milk past its date, a dropped plate.
    if (chance(0.4)) dayUse.set(-1, between(300, 1500));
  }

  for (const [table, rows] of Object.entries(batch)) {
    for (let i = 0; i < rows.length; i += 1000) await knex(table).insert(rows.slice(i, i + 1000));
  }
  // New orders continue the day's numbering (business rule 10: unique per business day).
  for (const [date, value] of lastNumber) {
    await knex.raw(
      'INSERT INTO daily_counters (location_id, business_date, kind, value) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value))',
      [locationId, date, 'order', value],
    );
  }

  // Two refunds in the month, approved by the manager.
  for (const [i, p] of [
    paymentsForRefund[40],
    paymentsForRefund[paymentsForRefund.length - 60],
  ].entries()) {
    if (!p) continue;
    await knex('refunds').insert({
      payment_id: p.id,
      amount_minor: i === 0 ? Math.round(p.amount / 3 / 100) * 100 : p.amount,
      reason: REFUND_REASONS[i]!,
      created_by: cashier,
      approved_by: manager,
      drawer_id: null,
      business_date: p.date,
      created_at: new Date(p.at.getTime() + 10 * MIN),
    });
  }

  await stockHistory(knex, locationId, manager, today, used);
  await auditHistory(knex, locationId);
}

/**
 * The audit log of the month (plan §5.14), derived from what the history contains: every void,
 * discount and refund with who approved it, and each sign-in on the shared device.
 */
async function auditHistory(knex: Knex, locationId: number) {
  const { account_id: accountId } = await knex('locations')
    .where({ id: locationId })
    .first('account_id');
  const common = [accountId, locationId];
  await knex.raw(
    `INSERT INTO audit_logs (account_id, location_id, user_id, action, entity_type, entity_id, \`before\`, \`after\`, approved_by, created_at)
     SELECT ?, o.location_id, i.voided_by, 'order_item.voided', 'order_item', i.id,
            JSON_OBJECT('status', 'served'), JSON_OBJECT('status', 'voided', 'reason', i.void_reason),
            i.void_approved_by, i.voided_at
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.location_id = ? AND i.status = 'voided' AND i.voided_at IS NOT NULL`,
    common,
  );
  await knex.raw(
    `INSERT INTO audit_logs (account_id, location_id, user_id, action, entity_type, entity_id, \`after\`, approved_by, created_at)
     SELECT ?, o.location_id, d.created_by, 'order.discount_added', 'order', o.id,
            JSON_OBJECT('type', d.type, 'value', d.value, 'amountMinor', d.amount_minor, 'reason', d.reason),
            d.approved_by, d.created_at
     FROM discounts d JOIN orders o ON o.id = d.order_id WHERE o.location_id = ?`,
    common,
  );
  await knex.raw(
    `INSERT INTO audit_logs (account_id, location_id, user_id, action, entity_type, entity_id, \`after\`, approved_by, created_at)
     SELECT ?, p.location_id, r.created_by, 'payment.refunded', 'payment', p.id,
            JSON_OBJECT('amountMinor', r.amount_minor, 'reason', r.reason), r.approved_by, r.created_at
     FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.location_id = ?`,
    common,
  );
  await knex.raw(
    `INSERT INTO audit_logs (account_id, location_id, user_id, action, entity_type, entity_id, ip, created_at)
     SELECT ?, e.location_id, e.user_id, 'auth.pin_switch', 'user', e.user_id, '192.168.1.20', e.clock_in
     FROM time_entries e WHERE e.location_id = ?`,
    common,
  );
}

/**
 * Books the month's sales and waste into the stock ledger (one line per ingredient per day), adds
 * a stock count from a week ago, and raises the opening stock so today's levels stay as seeded.
 */
async function stockHistory(
  knex: Knex,
  locationId: number,
  manager: number,
  today: string,
  used: Map<string, Map<number, number>>,
) {
  const ingredients = await knex('ingredients')
    .where({ location_id: locationId })
    .select('id', 'name', 'stock_qty', 'cost_per_unit_minor', 'category');
  const byName = new Map(ingredients.map((i) => [String(i.name), i]));
  const milk = byName.get('Qumësht i plotë');
  const extra = new Map<number, number>(); // what left stock in the month, per ingredient
  const add = (id: number, q: number) => extra.set(id, (extra.get(id) ?? 0) + q);
  const movements: Record<string, unknown>[] = [];
  const cost = (id: number) =>
    Number(ingredients.find((i) => Number(i.id) === id)?.cost_per_unit_minor ?? 0);

  for (const [date, day] of used) {
    // End of that day's service; today's so far is booked a few minutes ago.
    const endOfDay = zonedDateTime(date, 23 * 60 + 30, 'Europe/Tirane');
    const at = new Date(Math.min(endOfDay.getTime(), Date.now() - 5 * MIN));
    for (const [ingredientId, q] of day) {
      if (ingredientId === -1) {
        if (!milk) continue;
        add(Number(milk.id), q);
        movements.push({
          location_id: locationId,
          ingredient_id: milk.id,
          type: 'waste',
          qty: fromMilli(-q),
          unit_cost_minor: cost(Number(milk.id)),
          reason: 'Skadoi',
          user_id: manager,
          created_at: at,
        });
        continue;
      }
      add(ingredientId, q);
      movements.push({
        location_id: locationId,
        ingredient_id: ingredientId,
        type: 'sale',
        qty: fromMilli(-q),
        unit_cost_minor: cost(ingredientId),
        reason: null,
        user_id: null,
        created_at: at,
      });
    }
  }

  // A count of the bar a week ago found a little coffee and milk missing.
  const countDate = addDays(today, -7);
  const countAt = zonedDateTime(countDate, 9 * 60, 'Europe/Tirane');
  const bar = ingredients.filter((i) => ['Bar', 'Bulmet'].includes(String(i.category)));
  const [countId] = await knex('stock_counts').insert({
    location_id: locationId,
    category: null,
    status: 'applied',
    note: 'Numërim javor',
    created_by: manager,
    applied_by: manager,
    created_at: countAt,
    applied_at: new Date(countAt.getTime() + 40 * MIN),
  });
  const variance: Record<string, number> = {
    'Kafe kokërr': -120,
    'Qumësht i plotë': -1500,
    Kakao: 40,
    Kos: -300,
  };
  for (const i of bar) {
    const v = variance[String(i.name)] ?? 0;
    const expected = toMilli(String(i.stock_qty)) + 3000;
    await knex('stock_count_lines').insert({
      stock_count_id: countId,
      ingredient_id: i.id,
      expected_qty: fromMilli(expected),
      counted_qty: fromMilli(expected + v),
      unit_cost_minor: i.cost_per_unit_minor,
    });
    if (v) {
      add(Number(i.id), -v);
      movements.push({
        location_id: locationId,
        ingredient_id: i.id,
        type: 'count_adjust',
        qty: fromMilli(v),
        unit_cost_minor: i.cost_per_unit_minor,
        ref_type: 'stock_count',
        ref_id: countId,
        reason: null,
        user_id: manager,
        created_at: countAt,
      });
    }
  }
  for (let i = 0; i < movements.length; i += 500)
    await knex('stock_movements').insert(movements.slice(i, i + 500));

  // Opening stock a month ago = today's stock + everything that left since.
  const openedAt = zonedDateTime(addDays(today, -DAYS - 1), 8 * 60, 'Europe/Tirane');
  for (const [ingredientId, q] of extra) {
    const opening = await knex('stock_movements')
      .where({ ingredient_id: ingredientId, ref_type: 'opening' })
      .first('id', 'qty');
    if (!opening) continue;
    await knex('stock_movements')
      .where({ id: opening.id })
      .update({ qty: fromMilli(toMilli(String(opening.qty)) + q), created_at: openedAt });
  }
  await knex('stock_movements')
    .where({ location_id: locationId, ref_type: 'opening' })
    .update({ created_at: openedAt });
}
