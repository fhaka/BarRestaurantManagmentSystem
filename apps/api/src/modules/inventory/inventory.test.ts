import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FloorState,
  Ingredient,
  ItemCosting,
  Order,
  PurchaseOrder,
  StockCount,
  StockMovement,
} from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import type * as RealtimeServer from '../../realtime/server.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const emitted = vi.hoisted(() => [] as { type: string; data: Record<string, unknown> }[]);
vi.mock('../../realtime/server.js', async (importOriginal) => {
  const real = await importOriginal<typeof RealtimeServer>();
  return {
    ...real,
    emit: (type: string, locationId: number, data: Record<string, unknown>, ...rest: unknown[]) => {
      emitted.push({ type, data });
      return (real.emit as (...a: unknown[]) => void)(type, locationId, data, ...rest);
    },
  };
});

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let kitchen: ReturnType<typeof as>;
let m: {
  coffee: number;
  beer: number;
  beerSmall: number;
  beerLarge: number;
  extraShot: number;
  coffeeBeans: number;
  milk: number;
  beerKeg: number;
};
let tableId: number;

const ingredient = async (body: Record<string, unknown>): Promise<Ingredient> => {
  const res = await manager.post('/api/v1/ingredients').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};
const stock = async (id: number): Promise<Ingredient> =>
  ((await manager.get('/api/v1/ingredients')).body as Ingredient[]).find((i) => i.id === id)!;

beforeEach(async () => {
  emitted.length = 0;
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  kitchen = as(app, await login(app, fx.users.kitchen.email), fx.locationId);
  await manager.post('/api/v1/tax-rates').send({ name: 'TVSH 20%', rateBp: 2000, isDefault: true });
  const barId = (await manager.post('/api/v1/stations').send({ name: 'Bar', type: 'bar' })).body.id;
  const drinks = (await manager.post('/api/v1/menu/categories').send({ name: 'Pije' })).body.id;
  const extras = (
    await manager.post('/api/v1/menu/modifier-groups').send({
      name: 'Shtesa',
      minSelect: 0,
      maxSelect: 1,
      required: false,
      modifiers: [{ name: 'Shot ekstra', priceDeltaMinor: 5_000 }],
    })
  ).body;
  const coffee = (
    await manager.post('/api/v1/menu/items').send({
      categoryId: drinks,
      stationId: barId,
      name: 'Kapuçino',
      priceMinor: 18_000,
      modifierGroupIds: [extras.id],
    })
  ).body;
  const beer = (
    await manager.post('/api/v1/menu/items').send({
      categoryId: drinks,
      stationId: barId,
      name: 'Birrë',
      priceMinor: 25_000,
      variants: [
        { name: '0.33', priceMinor: 25_000 },
        { name: '0.5', priceMinor: 35_000 },
      ],
    })
  ).body;
  // 1 kg coffee 2 400 L, 1 l milk 120 L, 1 l draught beer 300 L.
  const beans = await ingredient({
    name: 'Kafe kokërr',
    unit: 'kg',
    category: 'Bar',
    stockQty: '2',
    minQty: '0.5',
    costPerUnitMinor: 240_000,
  });
  const milk = await ingredient({
    name: 'Qumësht',
    unit: 'l',
    category: 'Bar',
    stockQty: '10',
    minQty: '2',
    costPerUnitMinor: 12_000,
  });
  const keg = await ingredient({
    name: 'Birrë fuçi',
    unit: 'l',
    category: 'Bar',
    stockQty: '30',
    costPerUnitMinor: 30_000,
  });
  m = {
    coffee: coffee.id,
    beer: beer.id,
    beerSmall: beer.variants[0].id,
    beerLarge: beer.variants[1].id,
    extraShot: extras.modifiers[0].id,
    coffeeBeans: beans.id,
    milk: milk.id,
    beerKeg: keg.id,
  };
  // Cappuccino: 18 g coffee, 150 ml milk. Extra shot: +9 g coffee. Beer: by size.
  await manager
    .put(`/api/v1/menu/items/${m.coffee}/recipe`)
    .send({
      lines: [
        { ingredientId: m.coffeeBeans, qty: '0.018' },
        { ingredientId: m.milk, qty: '0.15' },
      ],
    })
    .expect(200);
  await manager
    .put(`/api/v1/menu/modifiers/${m.extraShot}/recipe`)
    .send({ lines: [{ ingredientId: m.coffeeBeans, qty: '0.009' }] })
    .expect(200);
  await manager
    .put(`/api/v1/menu/items/${m.beer}/recipe`)
    .send({
      lines: [
        { ingredientId: m.beerKeg, qty: '0.33', variantId: m.beerSmall },
        { ingredientId: m.beerKeg, qty: '0.5', variantId: m.beerLarge },
      ],
    })
    .expect(200);
  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  tableId = (
    await manager.post('/api/v1/tables').send({ areaId, name: '1', x: 0, y: 0, w: 3, h: 3 })
  ).body.id;
});

async function setSettings(patch: Record<string, unknown>) {
  const row = await db('locations').where({ id: fx.locationId }).first('settings');
  const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
  await db('locations')
    .where({ id: fx.locationId })
    .update({ settings: JSON.stringify({ ...settings, ...patch }) });
}

async function order(items: Record<string, unknown>[], send = true): Promise<Order> {
  let floor: FloorState = (await waiter.get('/api/v1/floor')).body;
  if (!floor.tables.find((t) => t.id === tableId)!.session) {
    floor = (
      await waiter
        .post('/api/v1/table-sessions')
        .send({ uuid: randomUUID(), tableId, guestCount: 2 })
    ).body;
  }
  const sessionId = floor.tables.find((t) => t.id === tableId)!.session!.id;
  const res = await waiter
    .post(`/api/v1/table-sessions/${sessionId}/items`)
    .send({ items: items.map((i) => ({ uuid: randomUUID(), ...i })), send });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('auto-deduction (business rule 7)', () => {
  it('selling 10 cappuccinos deducts 180 g coffee and 1.5 l milk, once', async () => {
    const o = await order([{ menuItemId: m.coffee, qty: 10 }]);
    expect((await stock(m.coffeeBeans)).stockMilli).toBe(1_820); // 2 kg − 0.180
    expect((await stock(m.milk)).stockMilli).toBe(8_500); // 10 l − 1.5
    const sales: StockMovement[] = (await manager.get('/api/v1/stock-movements?type=sale')).body;
    expect(sales.map((s) => [s.ingredientName, s.qtyMilli]).sort()).toEqual([
      ['Kafe kokërr', -180],
      ['Qumësht', -1_500],
    ]);
    expect(sales.every((s) => s.refType === 'order_item' && s.refId === o.items[0]!.id)).toBe(true);

    // Paying later does not book the same dishes again.
    await waiter
      .post(`/api/v1/orders/${o.id}/payments`)
      .send({ uuid: randomUUID(), method: 'card', amountMinor: 180_000 })
      .expect(201);
    expect((await stock(m.milk)).stockMilli).toBe(8_500);
  });

  it('uses the size-specific recipe and the extra-shot option recipe', async () => {
    await order([
      { menuItemId: m.beer, variantId: m.beerLarge, qty: 2 },
      { menuItemId: m.beer, variantId: m.beerSmall },
      { menuItemId: m.coffee, qty: 2, modifierIds: [m.extraShot] },
    ]);
    expect((await stock(m.beerKeg)).stockMilli).toBe(30_000 - 1_000 - 330);
    expect((await stock(m.coffeeBeans)).stockMilli).toBe(2_000 - 2 * (18 + 9));
  });

  it('a draft that is not sent deducts nothing', async () => {
    await order([{ menuItemId: m.coffee, qty: 3 }], false);
    expect((await stock(m.milk)).stockMilli).toBe(10_000);
  });

  it('with "deduct on payment" stock moves only when the order is fully paid', async () => {
    await setSettings({ stockDeductOn: 'payment' });
    const o = await order([{ menuItemId: m.coffee, qty: 2 }]);
    expect((await stock(m.milk)).stockMilli).toBe(10_000);
    await waiter
      .post(`/api/v1/orders/${o.id}/payments`)
      .send({ uuid: randomUUID(), method: 'card', amountMinor: 36_000 })
      .expect(201);
    expect((await stock(m.milk)).stockMilli).toBe(9_700);
  });

  it('a void before the kitchen started gives the stock back', async () => {
    const o = await order([{ menuItemId: m.coffee, qty: 2 }]);
    await manager
      .post(`/api/v1/order-items/${o.items[0]!.id}/void`)
      .send({ reason: 'Gabim' })
      .expect(200);
    expect((await stock(m.milk)).stockMilli).toBe(10_000);
    const types = ((await manager.get('/api/v1/stock-movements')).body as StockMovement[]).map(
      (s) => s.type,
    );
    expect(types).not.toContain('waste');
    expect(types).toContain('sale_reversal');
  });

  it('a void after the kitchen started is booked as waste (business rule 3)', async () => {
    const o = await order([{ menuItemId: m.coffee, qty: 2 }]);
    const itemId = o.items[0]!.id;
    await kitchen
      .patch(`/api/v1/order-items/${itemId}/status`)
      .send({ status: 'preparing' })
      .expect(204);
    await manager
      .post(`/api/v1/order-items/${itemId}/void`)
      .send({ reason: 'U derdh' })
      .expect(200);
    expect((await stock(m.milk)).stockMilli).toBe(9_700);
    const waste: StockMovement[] = (await manager.get('/api/v1/stock-movements?type=waste')).body;
    expect(waste.map((w) => [w.ingredientName, w.qtyMilli]).sort()).toEqual([
      ['Kafe kokërr', -36],
      ['Qumësht', -300],
    ]);
  });

  it('sends a stock.low event when a sale takes an ingredient below its minimum', async () => {
    emitted.length = 0;
    await order([{ menuItemId: m.coffee, qty: 40 }]); // 6 l milk: 10 → 4, still ≥ 2
    expect(emitted.filter((e) => e.type === 'stock.low')).toHaveLength(0);
    await order([{ menuItemId: m.coffee, qty: 20 }]); // 3 l milk: 4 → 1 < 2
    const low = emitted.filter((e) => e.type === 'stock.low');
    expect(low.map((e) => e.data)).toEqual([
      expect.objectContaining({ ingredientId: m.milk, stockMilli: 1_000, minMilli: 2_000 }),
    ]);
    expect(
      ((await manager.get('/api/v1/ingredients/low')).body as Ingredient[]).map((i) => i.id),
    ).toEqual([m.milk]);
  });
});

describe('costing and margins', () => {
  it('food cost and margin per item, size and option', async () => {
    const costing: ItemCosting[] = (await manager.get('/api/v1/costing')).body;
    const coffee = costing.find((c) => c.kind === 'item' && c.id === m.coffee)!;
    // 0.018 × 2 400 L + 0.15 × 120 L = 43.20 + 18.00 = 61.20 L. Net of 20% VAT: 180 / 1.2 = 150 L.
    expect(coffee).toMatchObject({
      costMinor: 6_120,
      netMinor: 15_000,
      marginMinor: 8_880,
      marginBp: 5_920,
    });
    const beer = costing.find((c) => c.kind === 'item' && c.id === m.beer)!;
    expect(beer.variants.map((v) => [v.name, v.costMinor])).toEqual([
      ['0.33', 9_900],
      ['0.5', 15_000],
    ]);
    const shot = costing.find((c) => c.kind === 'modifier' && c.id === m.extraShot)!;
    expect(shot.costMinor).toBe(2_160);
    expect((await db('menu_items').where({ id: m.coffee }).first('cost_minor')).cost_minor).toBe(
      6_120,
    );
  });
});

describe('waste and staff meals', () => {
  it('books out an ingredient or whole dishes by recipe', async () => {
    await manager
      .post('/api/v1/waste')
      .send({ ingredientId: m.milk, qty: '0.75', reason: 'Skadoi' })
      .expect(204);
    await manager
      .post('/api/v1/waste')
      .send({ type: 'staff_meal', menuItemId: m.coffee, dishes: 2, reason: 'Kafe stafi' })
      .expect(204);
    expect((await stock(m.milk)).stockMilli).toBe(10_000 - 750 - 300);
    const meals: StockMovement[] = (await manager.get('/api/v1/stock-movements?type=staff_meal'))
      .body;
    expect(meals).toHaveLength(2);
    const bad = await manager
      .post('/api/v1/waste')
      .send({ ingredientId: m.milk, reason: 'Pa sasi' });
    expect(bad.status).toBe(400);
  });

  it('waiters cannot record waste', async () => {
    const res = await waiter
      .post('/api/v1/waste')
      .send({ ingredientId: m.milk, qty: '1', reason: 'Skadoi' });
    expect(res.status).toBe(403);
  });
});

describe('purchase orders', () => {
  it('partial then full receipt raises stock and sets a weighted-average cost', async () => {
    const supplier = (
      await manager.post('/api/v1/suppliers').send({ name: 'Lufra', phone: '+355 69 000 0000' })
    ).body;
    let po: PurchaseOrder = (
      await manager.post('/api/v1/purchase-orders').send({
        supplierId: supplier.id,
        lines: [{ ingredientId: m.milk, qty: '20', unitCostMinor: 15_000 }],
      })
    ).body;
    expect(po).toMatchObject({ number: 1, status: 'draft', totalMinor: 300_000 });
    po = (await manager.post(`/api/v1/purchase-orders/${po.id}/send`)).body;
    expect(po.status).toBe('sent');
    const lineId = po.lines[0]!.id;

    po = (
      await manager
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .send({ lines: [{ lineId, qty: '10' }] })
    ).body;
    expect(po.status).toBe('partially_received');
    // 10 l at 120 L + 10 l at 150 L → 20 l at 135 L.
    let milk = await stock(m.milk);
    expect(milk).toMatchObject({ stockMilli: 20_000, costPerUnitMinor: 13_500 });

    const tooMuch = await manager
      .post(`/api/v1/purchase-orders/${po.id}/receive`)
      .send({ lines: [{ lineId, qty: '11' }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('RECEIVE_TOO_MUCH');

    // The rest arrives dearer: 20 l at 135 L + 10 l at 165 L → 30 l at 145 L.
    po = (
      await manager
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .send({ lines: [{ lineId, qty: '10', unitCostMinor: 16_500 }] })
    ).body;
    expect(po.status).toBe('received');
    milk = await stock(m.milk);
    expect(milk).toMatchObject({ stockMilli: 30_000, costPerUnitMinor: 14_500 });
    // The cappuccino's food cost follows: 43.20 + 0.15 × 145 = 64.95 L.
    expect((await db('menu_items').where({ id: m.coffee }).first('cost_minor')).cost_minor).toBe(
      6_495,
    );

    const closed = await manager.patch(`/api/v1/purchase-orders/${po.id}`).send({
      supplierId: supplier.id,
      lines: [{ ingredientId: m.milk, qty: '1', unitCostMinor: 1 }],
    });
    expect(closed.body.error.code).toBe('PO_STATE');
  });
});

describe('stock counts', () => {
  it('produces the correct variance and corrects stock, keeping sales made during the count', async () => {
    let count: StockCount = (await manager.post('/api/v1/stock-counts').send({ category: 'Bar' }))
      .body;
    expect(count.lines.map((l) => [l.ingredientName, l.expectedMilli])).toEqual([
      ['Birrë fuçi', 30_000],
      ['Kafe kokërr', 2_000],
      ['Qumësht', 10_000],
    ]);
    // A second count cannot start while this one is open.
    expect((await manager.post('/api/v1/stock-counts').send({})).body.error.code).toBe(
      'COUNT_STATE',
    );

    // Two cappuccinos are sold while counting.
    await order([{ menuItemId: m.coffee, qty: 2 }]);

    count = (
      await manager.patch(`/api/v1/stock-counts/${count.id}`).send({
        lines: [
          { ingredientId: m.milk, counted: '9.2' }, // 0.8 l missing → −0.8 × 120 = −96 L
          { ingredientId: m.coffeeBeans, counted: '2.05' }, // 50 g extra → +0.05 × 2 400 = +120 L
        ],
      })
    ).body;
    const milkLine = count.lines.find((l) => l.ingredientId === m.milk)!;
    expect(milkLine).toMatchObject({ varianceMilli: -800, varianceMinor: -9_600 });
    expect(count.lines.find((l) => l.ingredientId === m.coffeeBeans)).toMatchObject({
      varianceMilli: 50,
      varianceMinor: 12_000,
    });
    expect(count.lines.find((l) => l.ingredientId === m.beerKeg)).toMatchObject({
      countedMilli: null,
      varianceMinor: null,
    });
    expect(count.varianceMinor).toBe(2_400);

    count = (await manager.post(`/api/v1/stock-counts/${count.id}/apply`)).body;
    expect(count.status).toBe('applied');
    // 10 − 0.3 sold − 0.8 missing; 2 − 0.036 sold + 0.05 found; the keg was not counted.
    expect((await stock(m.milk)).stockMilli).toBe(8_900);
    expect((await stock(m.coffeeBeans)).stockMilli).toBe(2_014);
    expect((await stock(m.beerKeg)).stockMilli).toBe(30_000);
    const adjustments: StockMovement[] = (
      await manager.get('/api/v1/stock-movements?type=count_adjust')
    ).body;
    expect(
      adjustments
        .filter((a) => a.refType === 'stock_count')
        .map((a) => a.qtyMilli)
        .sort((a, b) => a - b),
    ).toEqual([-800, 50]);

    const again = await manager.post(`/api/v1/stock-counts/${count.id}/apply`);
    expect(again.body.error.code).toBe('COUNT_STATE');
  });
});

describe('ingredients and suppliers', () => {
  it('opening stock goes through the ledger and an ingredient used in a recipe cannot be deleted', async () => {
    const opening: StockMovement[] = (
      await manager.get(`/api/v1/stock-movements?ingredientId=${m.milk}`)
    ).body;
    expect(opening).toMatchObject([
      { type: 'count_adjust', qtyMilli: 10_000, refType: 'opening', reason: null },
    ]);
    expect((await manager.delete(`/api/v1/ingredients/${m.milk}`)).status).toBe(409);
    const sugar = await ingredient({ name: 'Sheqer', unit: 'kg' });
    await manager.delete(`/api/v1/ingredients/${sugar.id}`).expect(204);
  });

  it('a cost change refreshes the food cost of dishes using it', async () => {
    const milk = await stock(m.milk);
    await manager
      .patch(`/api/v1/ingredients/${m.milk}`)
      .send({
        name: milk.name,
        unit: milk.unit,
        category: milk.category,
        minQty: '2',
        costPerUnitMinor: 20_000,
      })
      .expect(200);
    // 43.20 + 0.15 × 200 = 73.20 L
    expect((await db('menu_items').where({ id: m.coffee }).first('cost_minor')).cost_minor).toBe(
      7_320,
    );
  });

  it('only roles with inventory permissions reach stock (plan §4 matrix)', async () => {
    expect((await kitchen.get('/api/v1/ingredients')).status).toBe(403);
    expect((await waiter.post('/api/v1/suppliers').send({ name: 'X' })).status).toBe(403);
  });
});
