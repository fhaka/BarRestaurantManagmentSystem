import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  businessDate,
  type BillView,
  type DashboardData,
  type DiscountsVoidsReport,
  type FloorState,
  type InventoryReport,
  type ItemsReport,
  type Order,
  type PaymentsReport,
  type SalesReport,
  type StaffReport,
} from '@tavolina/shared';
import { createApp } from '../../app.js';
import {
  as,
  createLocation,
  login,
  PINS,
  resetAndSeed,
  type Fixture,
} from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let cashier: ReturnType<typeof as>;
let m: { coffee: number; tave: number; beer: number; beans: number; milk: number };
let tables: number[];
const today = () => businessDate(new Date(), 'Europe/Tirane');
const range = () => `from=${today()}&to=${today()}`;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  cashier = as(app, await login(app, fx.users.cashier.email), fx.locationId);
  await manager.post('/api/v1/tax-rates').send({ name: 'TVSH 20%', rateBp: 2000, isDefault: true });
  const stationId = (await manager.post('/api/v1/stations').send({ name: 'Kuzhina' })).body.id;
  const drinks = (await manager.post('/api/v1/menu/categories').send({ name: 'Pije' })).body.id;
  const food = (await manager.post('/api/v1/menu/categories').send({ name: 'Gatime' })).body.id;
  const item = async (categoryId: number, name: string, priceMinor: number) =>
    (await manager.post('/api/v1/menu/items').send({ categoryId, stationId, name, priceMinor }))
      .body.id as number;
  const ingredient = async (body: Record<string, unknown>) =>
    (await manager.post('/api/v1/ingredients').send(body)).body.id as number;
  m = {
    coffee: await item(drinks, 'Kapuçino', 18_000),
    tave: await item(food, 'Tavë kosi', 85_000),
    beer: await item(drinks, 'Birrë', 25_000),
    beans: await ingredient({ name: 'Kafe', unit: 'kg', stockQty: '2', costPerUnitMinor: 240_000 }),
    milk: await ingredient({
      name: 'Qumësht',
      unit: 'l',
      stockQty: '10',
      costPerUnitMinor: 12_000,
    }),
  };
  await manager
    .put(`/api/v1/menu/items/${m.coffee}/recipe`)
    .send({
      lines: [
        { ingredientId: m.beans, qty: '0.018' },
        { ingredientId: m.milk, qty: '0.15' },
      ],
    })
    .expect(200);
  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  tables = [];
  for (let i = 0; i < 2; i++) {
    tables.push(
      (
        await manager
          .post('/api/v1/tables')
          .send({ areaId, name: String(i + 1), x: i * 5, y: 0, w: 3, h: 3 })
      ).body.id,
    );
  }
});

async function order(table: number, guests: number, lines: [number, number][]): Promise<Order> {
  const floor: FloorState = (
    await waiter
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId: table, guestCount: guests })
  ).body;
  const sessionId = floor.tables.find((t) => t.id === table)!.session!.id;
  const res = await waiter.post(`/api/v1/table-sessions/${sessionId}/items`).send({
    items: lines.map(([menuItemId, qty]) => ({ uuid: randomUUID(), menuItemId, qty })),
    send: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function approval(action: string, entityType: string, entityId: number) {
  const res = await cashier.post('/api/v1/approvals').send({
    approverId: fx.users.manager.id,
    pin: PINS.manager,
    action,
    entityType,
    entityId: String(entityId),
  });
  return res.body.approvalToken as string;
}

/**
 * The fixture day: table 1 (2 guests) has 2 cappuccinos and a tavë kosi (1 210 L) plus a beer
 * that is voided, paid by card with a 100 L tip. Table 2 (4 guests) has 4 beers (1 000 L) with a
 * 10% discount, paid 900 L cash, of which 200 L is refunded.
 */
async function fixtureDay() {
  const a = await order(tables[0]!, 2, [
    [m.coffee, 2],
    [m.tave, 1],
    [m.beer, 1],
  ]);
  const beer = a.items.find((i) => i.menuItemId === m.beer)!;
  await manager.post(`/api/v1/order-items/${beer.id}/void`).send({ reason: 'Gabim' }).expect(200);
  await cashier
    .post(`/api/v1/orders/${a.id}/payments`)
    .send({
      uuid: randomUUID(),
      method: 'card',
      amountMinor: 121_000,
      tipMinor: 10_000,
      reference: 'TRM-1',
    })
    .expect(201);

  const b = await order(tables[1]!, 4, [[m.beer, 4]]);
  await cashier
    .post(`/api/v1/orders/${b.id}/discounts`)
    .send({ type: 'percent', value: 1000, reason: 'Klient i rregullt' })
    .expect(201);
  await cashier.post('/api/v1/cash-drawers').send({ floatMinor: 500_000 }).expect(201);
  const paid: BillView = (
    await cashier
      .post(`/api/v1/orders/${b.id}/payments`)
      .send({ uuid: randomUUID(), method: 'cash', amountMinor: 90_000 })
  ).body;
  const paymentId = paid.bills[0]!.payments[0]!.id;
  await cashier
    .post(`/api/v1/payments/${paymentId}/refund`)
    .send({
      amountMinor: 20_000,
      reason: 'Birra e ngrohtë',
      approvalToken: await approval('payment.refund', 'payment', paymentId),
    })
    .expect(201);
}

describe('reports (plan §5.13)', () => {
  it('sales: totals, days, categories, order types and the busiest-hours heatmap', async () => {
    await fixtureDay();
    const r: SalesReport = (await manager.get(`/api/v1/reports/sales?${range()}`)).body;
    expect(r.totals).toEqual({
      revenueMinor: 211_000,
      orders: 2,
      covers: 6,
      avgTicketMinor: 105_500,
      taxMinor: 35_167, // 1 210 / 6 + 900 / 6 = 201,67 + 150 → per-line rounding
      discountMinor: 10_000,
      refundsMinor: 20_000,
      netMinor: 191_000,
    });
    expect(r.daily).toEqual([
      { date: today(), revenueMinor: 211_000, orders: 2, covers: 6, avgTicketMinor: 105_500 },
    ]);
    expect(r.byCategory).toEqual([
      { name: 'Pije', qty: 6, revenueMinor: 136_000 }, // before the bill discount
      { name: 'Gatime', qty: 1, revenueMinor: 85_000 },
    ]);
    expect(r.byType).toEqual([{ type: 'dine_in', orders: 2, revenueMinor: 211_000 }]);
    expect(r.heatmap.reduce((s, c) => s + c.orders, 0)).toBe(2);
  });

  it('product mix with margin from the recipe cost', async () => {
    await fixtureDay();
    const { rows }: ItemsReport = (await manager.get(`/api/v1/reports/items?${range()}`)).body;
    expect(rows.map((r) => [r.name, r.qty, r.revenueMinor])).toEqual([
      ['Birrë', 4, 100_000],
      ['Tavë kosi', 1, 85_000],
      ['Kapuçino', 2, 36_000],
    ]);
    // 2 × (0.018 × 2 400 + 0.15 × 120) = 122,40 L; net of VAT 360 / 1.2 = 300 L.
    expect(rows.find((r) => r.name === 'Kapuçino')).toMatchObject({
      netMinor: 30_000,
      costMinor: 12_240,
      marginMinor: 17_760,
      marginBp: 5_920,
    });
    expect(rows.find((r) => r.name === 'Birrë')).toMatchObject({ costMinor: null, marginBp: null });
  });

  it('staff, payments with tips, and discounts / voids / refunds with who approved', async () => {
    await fixtureDay();
    const staff: StaffReport = (await manager.get(`/api/v1/reports/staff?${range()}`)).body;
    expect(staff.rows.find((r) => r.userId === fx.users.waiter.id)).toMatchObject({
      orders: 2,
      covers: 6,
      revenueMinor: 211_000,
      tipsMinor: 10_000,
    });
    expect(staff.rows.find((r) => r.userId === fx.users.manager.id)).toMatchObject({
      orders: 0,
      voids: 1,
    });

    const pay: PaymentsReport = (await manager.get(`/api/v1/reports/payments?${range()}`)).body;
    expect(pay.rows).toEqual([
      { method: 'card', count: 1, amountMinor: 121_000, tipsMinor: 10_000 },
      { method: 'cash', count: 1, amountMinor: 90_000, tipsMinor: 0 },
    ]);
    expect(pay.refunds).toEqual({ count: 1, amountMinor: 20_000 });

    const dv: DiscountsVoidsReport = (
      await manager.get(`/api/v1/reports/discounts-voids?${range()}`)
    ).body;
    expect(dv.discounts).toMatchObject([
      {
        reason: 'Klient i rregullt',
        amountMinor: 10_000,
        createdBy: 'Test cashier',
        approvedBy: null,
      },
    ]);
    expect(dv.voids).toMatchObject([
      { item: 'Birrë', amountMinor: 25_000, reason: 'Gabim', voidedBy: 'Test manager' },
    ]);
    expect(dv.refunds).toMatchObject([
      {
        method: 'cash',
        amountMinor: 20_000,
        createdBy: 'Test cashier',
        approvedBy: 'Test manager',
      },
    ]);
  });

  it('inventory consumption from the stock ledger', async () => {
    await fixtureDay();
    const { rows }: InventoryReport = (await manager.get(`/api/v1/reports/inventory?${range()}`))
      .body;
    expect(rows.find((r) => r.name === 'Kafe')).toMatchObject({
      consumedMilli: 36,
      consumedMinor: 8_640,
      stockMilli: 1_964,
    });
    expect(rows.find((r) => r.name === 'Qumësht')).toMatchObject({
      consumedMilli: 300,
      consumedMinor: 3_600,
    });
  });

  it('the live dashboard: paid so far, open tables, top items, voids, low stock', async () => {
    await fixtureDay();
    // Table 1 leaves; table 2 has paid but is still sitting (counts as paid, still open).
    const floor: FloorState = (await waiter.get('/api/v1/floor')).body;
    await waiter
      .post(
        `/api/v1/table-sessions/${floor.tables.find((t) => t.id === tables[0])!.session!.id}/close`,
      )
      .expect(200);
    await order(tables[0]!, 3, [[m.coffee, 1]]);
    const d: DashboardData = (await manager.get('/api/v1/reports/dashboard')).body;
    expect(d).toMatchObject({
      businessDate: today(),
      revenueMinor: 211_000,
      orders: 2,
      avgTicketMinor: 105_500,
      covers: 9,
      openTables: 2,
      openOrdersMinor: 18_000,
      voids: { count: 1, amountMinor: 25_000 },
    });
    expect(d.topItems[0]).toEqual({ name: 'Birrë', qty: 4, revenueMinor: 100_000 });
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly[0]!.hour).toBe(4);
    expect(d.hourly.reduce((s, h) => s + h.todayMinor, 0)).toBe(211_000);
  });

  it('only report.view; other locations only where the user may see reports', async () => {
    expect((await waiter.get('/api/v1/reports/dashboard')).status).toBe(403);
    expect((await cashier.get(`/api/v1/reports/sales?${range()}`)).status).toBe(403);
    const other = await createLocation(fx.accountId, 'Las Vegas Durrës');
    const forbidden = await manager.get(
      `/api/v1/reports/sales?${range()}&locations=${fx.locationId},${other}`,
    );
    expect(forbidden.status).toBe(403);
    const bad = await manager.get(`/api/v1/reports/sales?from=${today()}&to=2020-01-01`);
    expect(bad.status).toBe(400);
  });
});
