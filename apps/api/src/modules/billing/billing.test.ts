import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BillView, CashDrawer, FloorState, Order, ZReport } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, PINS, resetAndSeed, type Fixture } from '../../test/fixtures.js';
import { MockFiscalProvider, setFiscalProvider } from '../fiscal/provider.js';
import { retryDue } from '../fiscal/service.js';

const app = createApp();
let fx: Fixture;
let owner: ReturnType<typeof as>;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let cashier: ReturnType<typeof as>;
let fiscal: MockFiscalProvider;
let m: { coffee: number; tave: number; beer: number; water: number; drinks: number };
let tableId: number;
let table2: number;

beforeEach(async () => {
  fx = await resetAndSeed();
  fiscal = new MockFiscalProvider();
  setFiscalProvider(fiscal);
  owner = as(app, await login(app, fx.users.owner.email), fx.locationId);
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  cashier = as(app, await login(app, fx.users.cashier.email), fx.locationId);
  const vat20 = (
    await owner.post('/api/v1/tax-rates').send({ name: 'TVSH 20%', rateBp: 2000, isDefault: true })
  ).body.id;
  const vat6 = (await owner.post('/api/v1/tax-rates').send({ name: 'TVSH 6%', rateBp: 600 })).body
    .id;
  const stationId = (await manager.post('/api/v1/stations').send({ name: 'Kuzhina' })).body.id;
  const drinks = (await manager.post('/api/v1/menu/categories').send({ name: 'Pije' })).body.id;
  const food = (await manager.post('/api/v1/menu/categories').send({ name: 'Gatime' })).body.id;
  const item = async (body: Record<string, unknown>) =>
    (await manager.post('/api/v1/menu/items').send({ stationId, taxRateId: vat20, ...body })).body
      .id;
  m = {
    coffee: await item({ categoryId: drinks, name: 'Kapuçino', priceMinor: 18_000 }),
    tave: await item({ categoryId: food, name: 'Tavë kosi', priceMinor: 85_000 }),
    beer: await item({ categoryId: drinks, name: 'Birrë', priceMinor: 25_000 }),
    water: await item({ categoryId: drinks, name: 'Ujë', priceMinor: 50_000, taxRateId: vat6 }),
    drinks,
  };
  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  tableId = (
    await manager.post('/api/v1/tables').send({ areaId, name: '5', x: 0, y: 0, w: 3, h: 3 })
  ).body.id;
  table2 = (
    await manager.post('/api/v1/tables').send({ areaId, name: '6', x: 5, y: 0, w: 3, h: 3 })
  ).body.id;
});

afterEach(() => {
  setFiscalProvider(new MockFiscalProvider());
});

const line = (menuItemId: number, extra: Record<string, unknown> = {}) => ({
  uuid: randomUUID(),
  menuItemId,
  ...extra,
});

async function openAndOrder(items: unknown[], table = tableId): Promise<Order> {
  const floor: FloorState = (
    await waiter
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId: table, guestCount: 4 })
  ).body;
  const sessionId = floor.tables.find((t) => t.id === table)!.session!.id;
  const res = await waiter
    .post(`/api/v1/table-sessions/${sessionId}/items`)
    .send({ items, send: true });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** The fixture table of four (see billing-math.test.ts): 2× Kapuçino, Tavë kosi, Birrë at happy hour. */
async function fixtureOrder(): Promise<Order> {
  await manager.post('/api/v1/menu/price-rules').send({
    name: 'Happy hour',
    scope: 'item',
    scopeId: m.beer,
    type: 'percent',
    value: 2000,
  });
  return openAndOrder([
    line(m.coffee, { qty: 2, seat: 1 }),
    line(m.tave, { seat: 2 }),
    line(m.beer, { seat: 2 }),
  ]);
}

const bill = async (orderId: number, session = cashier): Promise<BillView> =>
  (await session.get(`/api/v1/orders/${orderId}/bill`)).body;

async function setSettings(patch: Record<string, unknown>) {
  const row = await db('locations').where({ id: fx.locationId }).first('settings');
  const settings = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
  await db('locations')
    .where({ id: fx.locationId })
    .update({ settings: JSON.stringify({ ...settings, ...patch }) });
}

async function approval(action: string, entityType: string, entityId: number, session = cashier) {
  const res = await session.post('/api/v1/approvals').send({
    approverId: fx.users.manager.id,
    pin: PINS.manager,
    action,
    entityType,
    entityId: String(entityId),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.approvalToken as string;
}

const openDrawer = async (floatMinor = 1_000_000): Promise<CashDrawer> =>
  (await cashier.post('/api/v1/cash-drawers').send({ floatMinor })).body;

const payment = (amountMinor: number, extra: Record<string, unknown> = {}) => ({
  uuid: randomUUID(),
  method: 'card',
  amountMinor,
  reference: 'TRM-1',
  ...extra,
});

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 40; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

describe('totals (business rule 2) match the hand-calculated fixture', () => {
  it('A: 1 410 L with 235,00 L VAT', async () => {
    const order = await fixtureOrder();
    const view = await bill(order.id);
    expect(view.totals).toMatchObject({
      subtotalMinor: 141_000,
      totalMinor: 141_000,
      taxMinor: 23_500,
    });
    expect(view.order.items.find((i) => i.name === 'Birrë')!.unitPriceMinor).toBe(20_000);
  });

  it('B: item 10%, bill −100 L, service 10% → 1 348 L, VAT 224,67 L', async () => {
    await setSettings({ serviceChargeBp: 1000 });
    const order = await fixtureOrder();
    const tave = order.items.find((i) => i.name === 'Tavë kosi')!;
    await manager
      .post(`/api/v1/orders/${order.id}/discounts`)
      .send({ orderItemId: tave.id, type: 'percent', value: 1000, reason: 'Pritje e gjatë' })
      .expect(201);
    const view: BillView = (
      await cashier
        .post(`/api/v1/orders/${order.id}/discounts`)
        .send({ type: 'fixed', value: 10_000, reason: 'Klient i rregullt' })
    ).body;
    expect(view.totals).toMatchObject({
      itemDiscountMinor: 8_500,
      orderDiscountMinor: 10_000,
      serviceMinor: 12_300,
      totalMinor: 134_800,
      taxMinor: 22_467,
    });
    expect(view.discounts.map((d) => d.amountMinor)).toEqual([8_500, 10_000]);
    const stored = await db('orders').where({ id: order.id }).first();
    expect(stored).toMatchObject({
      total_minor: 134_800,
      discount_minor: 18_500,
      service_minor: 12_300,
      tax_minor: 22_467,
    });
  });

  it('C: each line keeps its own VAT rate', async () => {
    const order = await openAndOrder([line(m.tave), line(m.water)]);
    const view = await bill(order.id);
    expect(view.totals.tax).toEqual([
      { rateBp: 2000, grossMinor: 85_000, taxMinor: 14_167, netMinor: 70_833 },
      { rateBp: 600, grossMinor: 50_000, taxMinor: 2_830, netMinor: 47_170 },
    ]);
  });

  it('service charge is for dine-in only', async () => {
    await setSettings({ serviceChargeBp: 1000 });
    const uuid = randomUUID();
    await cashier.post('/api/v1/orders').send({ uuid, type: 'takeaway' }).expect(201);
    const takeaway: Order = (
      await cashier.post(`/api/v1/orders/${uuid}/items`).send({ items: [line(m.tave)], send: true })
    ).body;
    expect((await bill(takeaway.id)).totals.serviceMinor).toBe(0);
  });
});

describe('discounts', () => {
  it('above the threshold a manager approves; always audited', async () => {
    const order = await fixtureOrder();
    const res = await cashier
      .post(`/api/v1/orders/${order.id}/discounts`)
      .send({ type: 'percent', value: 1500, reason: 'Ankesë' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPROVAL_INVALID');
    const token = await approval('order.discount', 'order', order.id);
    const ok = await cashier
      .post(`/api/v1/orders/${order.id}/discounts`)
      .send({ type: 'percent', value: 1500, reason: 'Ankesë', approvalToken: token });
    expect(ok.status).toBe(201);
    expect((ok.body as BillView).totals.orderDiscountMinor).toBe(21_200); // 15% of 1 410 = 211,5 → 212 L
    const audit = await db('audit_logs').where({ action: 'order.discount_added' }).first();
    expect(audit).toMatchObject({ user_id: fx.users.cashier.id, approved_by: fx.users.manager.id });
  });

  it('waiters cannot give discounts; a new discount replaces the old one; removing works', async () => {
    const order = await fixtureOrder();
    expect(
      (
        await waiter
          .post(`/api/v1/orders/${order.id}/discounts`)
          .send({ type: 'percent', value: 500, reason: 'Provë' })
      ).status,
    ).toBe(403);
    await cashier
      .post(`/api/v1/orders/${order.id}/discounts`)
      .send({ type: 'percent', value: 500, reason: 'Provë' });
    let view: BillView = (
      await cashier
        .post(`/api/v1/orders/${order.id}/discounts`)
        .send({ type: 'fixed', value: 5_000, reason: 'Provë 2' })
    ).body;
    expect(view.discounts).toHaveLength(1);
    view = (await cashier.delete(`/api/v1/discounts/${view.discounts[0]!.id}`)).body;
    expect(view.totals.discountMinor).toBe(0);
  });
});

describe('splitting', () => {
  it('equally by 3: 1 410 L → 470 + 470 + 470, VAT per bill', async () => {
    const order = await fixtureOrder();
    const view: BillView = (
      await cashier.post(`/api/v1/orders/${order.id}/split`).send({ type: 'equal', parts: 3 })
    ).body;
    expect(view.bills.map((b) => [b.label, b.totalMinor])).toEqual([
      ['1/3', 47_000],
      ['2/3', 47_000],
      ['3/3', 47_000],
    ]);
    // 470 L at 20% holds 78,33 L VAT; three bills give 234,99 L (rounded per bill).
    expect(view.bills.reduce((s, b) => s + b.tax[0]!.taxMinor, 0)).toBe(23_499);
  });

  it('by seat and by items: whole lek bills that add up to the total', async () => {
    const order = await fixtureOrder();
    let view: BillView = (
      await cashier.post(`/api/v1/orders/${order.id}/split`).send({ type: 'seat' })
    ).body;
    expect(view.bills.map((b) => [b.label, b.totalMinor])).toEqual([
      ['seat:1', 36_000],
      ['seat:2', 105_000],
    ]);
    const [coffee, tave, beer] = order.items;
    view = (
      await cashier
        .post(`/api/v1/orders/${order.id}/split`)
        .send({ type: 'items', groups: [[coffee!.id, beer!.id], [tave!.id]] })
    ).body;
    expect(view.bills.map((b) => b.totalMinor)).toEqual([56_000, 85_000]);
    expect(view.bills[0]!.itemIds.sort()).toEqual([coffee!.id, beer!.id].sort());

    const missing = await cashier
      .post(`/api/v1/orders/${order.id}/split`)
      .send({ type: 'items', groups: [[coffee!.id], [tave!.id]] });
    expect(missing.body.error.code).toBe('SPLIT_INVALID');
    const custom = await cashier
      .post(`/api/v1/orders/${order.id}/split`)
      .send({ type: 'custom', amountsMinor: [100_000, 40_000] });
    expect(custom.body.error.code).toBe('SPLIT_INVALID');
    await cashier
      .post(`/api/v1/orders/${order.id}/split`)
      .send({ type: 'custom', amountsMinor: [100_000, 41_000] })
      .expect(200);
  });

  it('adding a dish drops an unpaid split', async () => {
    const order = await fixtureOrder();
    await cashier.post(`/api/v1/orders/${order.id}/split`).send({ type: 'equal', parts: 2 });
    await waiter
      .post(`/api/v1/orders/${order.id}/items`)
      .send({ items: [line(m.coffee)], send: true });
    expect((await bill(order.id)).bills).toHaveLength(0);
  });
});

describe('payments', () => {
  it('equal split paid by cash (with change), card and a mixed bill; the table is then paid and can close', async () => {
    const order = await fixtureOrder();
    await openDrawer();
    let view: BillView = (
      await cashier.post(`/api/v1/orders/${order.id}/split`).send({ type: 'equal', parts: 3 })
    ).body;
    const [b1, b2, b3] = view.bills;

    view = (
      await cashier.post(`/api/v1/orders/${order.id}/payments`).send({
        billId: b1!.id,
        uuid: randomUUID(),
        method: 'cash',
        amountMinor: 47_000,
        tenderedMinor: 100_000,
      })
    ).body;
    expect(view.bills[0]).toMatchObject({ status: 'paid', balanceMinor: 0 });
    expect(view.bills[0]!.payments[0]).toMatchObject({ changeMinor: 53_000 });

    await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ billId: b2!.id, ...payment(47_000, { tipMinor: 5_000 }) })
      .expect(201);
    // Mixed: part cash, part card.
    await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ billId: b3!.id, uuid: randomUUID(), method: 'cash', amountMinor: 20_000 })
      .expect(201);
    view = (
      await cashier
        .post(`/api/v1/orders/${order.id}/payments`)
        .send({ billId: b3!.id, ...payment(27_000) })
    ).body;
    expect(view.balanceMinor).toBe(0);
    expect(view.bills.every((b) => b.status === 'paid')).toBe(true);

    const session = await db('table_sessions').where({ table_id: tableId }).first();
    expect(session.status).toBe('paid');
    // Tips belong to the table's waiter.
    expect(await db('payments').where('tip_minor', '>', 0).first()).toMatchObject({
      tip_user_id: fx.users.waiter.id,
    });

    // Every paid bill is fiscalized.
    const invoices = await waitFor(
      () => db('fiscal_invoices').where({ kind: 'invoice' }),
      (rows) => rows.length === 3 && rows.every((r) => r.status === 'registered'),
    );
    expect(invoices.map((i) => i.invoice_number)).toEqual([1, 2, 3]);
    expect(invoices[0]!.nslf).toMatch(/^[0-9A-F]{32}$/);
    expect((await bill(order.id)).bills[0]!.fiscal).toMatchObject({
      status: 'registered',
      invoiceNumber: `1/${new Date().getUTCFullYear()}/ef789gh012`,
    });

    await waiter.post(`/api/v1/table-sessions/${session.id}/close`).expect(200);
  });

  it('pays the whole order without splitting; replays are ignored', async () => {
    const order = await fixtureOrder();
    const body = payment(141_000);
    await waiter.post(`/api/v1/orders/${order.id}/payments`).send(body).expect(201);
    const again = await waiter.post(`/api/v1/orders/${order.id}/payments`).send(body);
    expect(again.status).toBe(201);
    expect(await db('payments')).toHaveLength(1);
    expect((await bill(order.id)).bills).toMatchObject([{ splitType: 'full', status: 'paid' }]);
  });

  it('refuses cash without an open drawer, overpaying, and closing a table that still owes', async () => {
    const order = await fixtureOrder();
    const cash = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ uuid: randomUUID(), method: 'cash', amountMinor: 10_000 });
    expect(cash.body.error.code).toBe('CASH_DRAWER_CLOSED');
    const tooMuch = await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send(payment(999_900));
    expect(tooMuch.body.error.code).toBe('PAYMENT_TOO_HIGH');
    await cashier.post(`/api/v1/orders/${order.id}/payments`).send(payment(41_000)).expect(201);
    const session = await db('table_sessions').where({ table_id: tableId }).first();
    const close = await waiter.post(`/api/v1/table-sessions/${session.id}/close`);
    expect(close.status).toBe(409);
    expect(close.body.error.code).toBe('BALANCE_DUE');
    const split = await cashier
      .post(`/api/v1/orders/${order.id}/split`)
      .send({ type: 'equal', parts: 2 });
    expect(split.body.error.code).toBe('ORDER_HAS_PAYMENTS');
  });

  it('a dish on a paid bill cannot be voided', async () => {
    await setSettings({ voidRequiresApproval: false });
    const order = await fixtureOrder();
    const [coffee, tave, beer] = order.items;
    const view: BillView = (
      await cashier
        .post(`/api/v1/orders/${order.id}/split`)
        .send({ type: 'items', groups: [[coffee!.id], [tave!.id, beer!.id]] })
    ).body;
    await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ billId: view.bills[0]!.id, ...payment(36_000) })
      .expect(201);
    const res = await waiter
      .post(`/api/v1/order-items/${coffee!.id}/void`)
      .send({ reason: 'Gabim' });
    expect(res.body.error.code).toBe('ITEM_PAID');
    // The other dishes can still be voided (their bill was not paid).
    await waiter.post(`/api/v1/order-items/${beer!.id}/void`).send({ reason: 'Gabim' }).expect(200);
  });

  it('a takeaway order closes once paid', async () => {
    const uuid = randomUUID();
    await cashier.post('/api/v1/orders').send({ uuid, type: 'takeaway' }).expect(201);
    const order: Order = (
      await cashier.post(`/api/v1/orders/${uuid}/items`).send({ items: [line(m.tave)], send: true })
    ).body;
    await cashier.post(`/api/v1/orders/${order.id}/payments`).send(payment(85_000)).expect(201);
    expect(await db('orders').where({ id: order.id }).first()).toMatchObject({ status: 'closed' });
  });
});

describe('refunds', () => {
  it('always manager-approved; cash goes back out of the drawer; DPT gets a corrective invoice', async () => {
    const order = await fixtureOrder();
    await openDrawer();
    const paid: BillView = (
      await cashier
        .post(`/api/v1/orders/${order.id}/payments`)
        .send({ uuid: randomUUID(), method: 'cash', amountMinor: 141_000 })
    ).body;
    const paymentId = paid.bills[0]!.payments[0]!.id;
    const noToken = await cashier
      .post(`/api/v1/payments/${paymentId}/refund`)
      .send({ amountMinor: 20_000, reason: 'Birra e ngrohtë' });
    expect(noToken.body.error.code).toBe('APPROVAL_INVALID');
    const token = await approval('payment.refund', 'payment', paymentId);
    const view: BillView = (
      await cashier
        .post(`/api/v1/payments/${paymentId}/refund`)
        .send({ amountMinor: 20_000, reason: 'Birra e ngrohtë', approvalToken: token })
    ).body;
    expect(view.bills[0]!.payments[0]!.refundedMinor).toBe(20_000);
    expect(await db('refunds').first()).toMatchObject({
      created_by: fx.users.cashier.id,
      approved_by: fx.users.manager.id,
    });
    expect(await db('cash_movements').where({ type: 'refund' }).first()).toMatchObject({
      amount_minor: 20_000,
    });
    const corrective = await waitFor(
      () => db('fiscal_invoices').where({ kind: 'corrective' }).first(),
      (r) => r?.status === 'registered',
    );
    expect(corrective.total_minor).toBe(-20_000);
    const tooMuch = await manager
      .post(`/api/v1/payments/${paymentId}/refund`)
      .send({ amountMinor: 130_000, reason: 'Provë' });
    expect(tooMuch.body.error.code).toBe('REFUND_TOO_HIGH');
  });
});

describe('cash drawer', () => {
  it('float, sales, pay-in/out, no-sale with approval, counted close with a difference', async () => {
    const drawer = await openDrawer(500_000);
    expect(drawer).toMatchObject({ status: 'open', floatMinor: 500_000, expectedMinor: 500_000 });
    expect(
      (await cashier.post('/api/v1/cash-drawers').send({ floatMinor: 1 })).body.error.code,
    ).toBe('CASH_DRAWER_OPEN');

    const order = await fixtureOrder();
    await cashier.post(`/api/v1/orders/${order.id}/payments`).send({
      uuid: randomUUID(),
      method: 'cash',
      amountMinor: 141_000,
      tipMinor: 9_000,
      tenderedMinor: 200_000,
    });
    await cashier
      .post(`/api/v1/cash-drawers/${drawer.id}/movements`)
      .send({ type: 'pay_in', amountMinor: 20_000, reason: 'Monedha nga banka' })
      .expect(201);
    const after: CashDrawer = (
      await cashier
        .post(`/api/v1/cash-drawers/${drawer.id}/movements`)
        .send({ type: 'pay_out', amountMinor: 30_000, reason: 'Akull' })
    ).body;
    // 5 000 + 1 410 + 90 tip + 200 − 300 = 6 400 L
    expect(after.expectedMinor).toBe(640_000);

    const noSale = await cashier
      .post(`/api/v1/cash-drawers/${drawer.id}/no-sale`)
      .send({ reason: 'Kusur' });
    expect(noSale.body.error.code).toBe('APPROVAL_INVALID');
    const token = await approval('cash_drawer.open_no_sale', 'cash_drawer', drawer.id);
    await cashier
      .post(`/api/v1/cash-drawers/${drawer.id}/no-sale`)
      .send({ reason: 'Kusur', approvalToken: token })
      .expect(200);

    // Counted: 6 × 1 000 + 3 × 100 + 5 × 20 = 6 400 L... minus one 100 L coin → −100 L difference.
    const counts = { '1000': 6, '100': 2, '20': 5 };
    const needsOk = await cashier.post(`/api/v1/cash-drawers/${drawer.id}/close`).send({ counts });
    expect(needsOk.body.error.code).toBe('APPROVAL_INVALID');
    const closeToken = await approval('cash_drawer.close', 'cash_drawer', drawer.id);
    const closed: CashDrawer = (
      await cashier
        .post(`/api/v1/cash-drawers/${drawer.id}/close`)
        .send({ counts, approvalToken: closeToken })
    ).body;
    expect(closed).toMatchObject({
      status: 'closed',
      expectedMinor: 640_000,
      countedMinor: 630_000,
      differenceMinor: -10_000,
    });
    const kinds = (await db('fiscal_invoices').select('kind')).map((r) => r.kind).sort();
    expect(kinds).toEqual(['cash_deposit', 'invoice', 'withdrawal']);
  });
});

describe('end of day (Z report)', () => {
  it('reconciles with the payments, refuses open tables and drawers, then locks the day', async () => {
    const order = await fixtureOrder();
    const drawer = await openDrawer(100_000);
    await cashier.post(`/api/v1/orders/${order.id}/split`).send({ type: 'equal', parts: 2 });
    const bills = (await bill(order.id)).bills;
    await cashier.post(`/api/v1/orders/${order.id}/payments`).send({
      billId: bills[0]!.id,
      uuid: randomUUID(),
      method: 'cash',
      amountMinor: 70_500,
      tipMinor: 4_500,
    });
    await cashier
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({ billId: bills[1]!.id, ...payment(70_500) });

    let z: ZReport = (await manager.get('/api/v1/business-days/current/report')).body;
    expect(z).toMatchObject({
      closed: false,
      orders: 1,
      grossSalesMinor: 141_000,
      netSalesMinor: 141_000,
      paymentsTotalMinor: 141_000,
      tipsMinor: 4_500,
    });
    expect(z.payments).toEqual([
      { method: 'cash', count: 1, amountMinor: 70_500 },
      { method: 'card', count: 1, amountMinor: 70_500 },
    ]);
    const paymentsSum = Number((await db('payments').sum({ s: 'amount_minor' }).first())!.s);
    expect(z.paymentsTotalMinor).toBe(paymentsSum);
    expect(z.tax).toEqual([
      { rateBp: 2000, grossMinor: 141_000, taxMinor: 23_500, netMinor: 117_500 },
    ]);
    expect(z.items.map((i) => [i.name, i.qty])).toEqual([
      ['Tavë kosi', 1],
      ['Kapuçino', 2],
      ['Birrë', 1],
    ]);
    expect(z.waiters).toEqual([
      { name: `Test waiter`, orders: 1, salesMinor: 141_000, tipsMinor: 4_500 },
    ]);
    expect(z.cash).toMatchObject({
      floatMinor: 100_000,
      salesMinor: 75_000,
      expectedMinor: 175_000,
    });

    const tables = await manager.post('/api/v1/business-days/close');
    expect(tables.body.error.code).toBe('DAY_HAS_OPEN_TABLES');
    const session = await db('table_sessions').where({ table_id: tableId }).first();
    await waiter.post(`/api/v1/table-sessions/${session.id}/close`).expect(200);
    const drawerOpen = await manager.post('/api/v1/business-days/close');
    expect(drawerOpen.body.error.code).toBe('CASH_DRAWER_OPEN');
    await manager
      .post(`/api/v1/cash-drawers/${drawer.id}/close`)
      .send({ counts: { '1000': 1, '500': 1, '200': 1, '50': 1 } })
      .expect(200);
    expect((await cashier.post('/api/v1/business-days/close')).status).toBe(403);

    z = (await manager.post('/api/v1/business-days/close')).body;
    expect(z).toMatchObject({ closed: true, paymentsTotalMinor: 141_000 });
    expect(z.cash.countedMinor).toBe(175_000);
    expect((await manager.post('/api/v1/business-days/close')).body.error.code).toBe(
      'BUSINESS_DAY_CLOSED',
    );
    // Locked: no new orders or drawers today.
    const late = await waiter
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId: table2, guestCount: 2 });
    const lateSession = (late.body as FloorState).tables.find((t) => t.id === table2)!.session!.id;
    const res = await waiter
      .post(`/api/v1/table-sessions/${lateSession}/items`)
      .send({ items: [line(m.coffee)], send: true });
    expect(res.body.error.code).toBe('BUSINESS_DAY_CLOSED');
    expect(
      (await cashier.post('/api/v1/cash-drawers').send({ floatMinor: 0 })).body.error.code,
    ).toBe('BUSINESS_DAY_CLOSED');
  });
});

describe('fiscal queue', () => {
  it('a failed registration stays pending and is retried until it succeeds', async () => {
    fiscal.failNext(1);
    const order = await fixtureOrder();
    await cashier.post(`/api/v1/orders/${order.id}/payments`).send(payment(141_000)).expect(201);
    const first = await waitFor(
      () => db('fiscal_invoices').first(),
      (r) => Number(r?.attempts) === 1,
    );
    expect(first).toMatchObject({ status: 'pending', last_error: 'Mock DPT service unavailable' });
    expect((await bill(order.id)).bills[0]!.fiscal!.status).toBe('pending');
    await db('fiscal_invoices').update({ next_attempt_at: new Date(Date.now() - 1000) });
    expect(await retryDue()).toBe(1);
    expect(await db('fiscal_invoices').first()).toMatchObject({
      status: 'registered',
      attempts: 2,
    });
  });
});

describe('guests after paying', () => {
  it('see their digital receipt and can leave one review per visit', async () => {
    const order = await fixtureOrder();
    const token = (await db('tables').where({ id: tableId }).first('qr_token')).qr_token;
    const phone = request.agent(app);
    await phone.get(`/api/v1/guest/t/${token}/state`).expect(200);
    const early = await phone.post(`/api/v1/guest/t/${token}/review`).send({ rating: 5 });
    expect(early.status).toBe(409);

    await cashier.post(`/api/v1/orders/${order.id}/payments`).send(payment(141_000)).expect(201);
    let state = (await phone.get(`/api/v1/guest/t/${token}/state`)).body;
    expect(state.review).toBe('available');
    expect(state.receipts).toHaveLength(1);
    const receipt = await waitFor(
      async () =>
        (await request(app).get(`/api/v1/guest/receipts/${state.receipts[0].token}`)).body,
      (r) => r.fiscal?.status === 'registered',
    );
    const text = receipt.document.lines
      .filter((l: { kind: string }) => l.kind === 'text')
      .map((l: { text: string }) => l.text)
      .join('\n');
    expect(text).toContain('Tavë kosi');
    expect(text).toContain('1 410 L');
    expect(receipt.qrSvg).toContain('<svg');

    // The table closes; the phone can still review its visit.
    const session = await db('table_sessions').where({ table_id: tableId }).first();
    await waiter.post(`/api/v1/table-sessions/${session.id}/close`).expect(200);
    state = (
      await phone
        .post(`/api/v1/guest/t/${token}/review`)
        .send({ rating: 4, comment: 'Shumë e mirë' })
    ).body;
    expect(state.review).toBe('done');
    expect((await phone.post(`/api/v1/guest/t/${token}/review`).send({ rating: 1 })).status).toBe(
      409,
    );
    expect((await manager.get('/api/v1/reviews')).body).toMatchObject([
      { rating: 4, tableName: '5' },
    ]);
  });
});
