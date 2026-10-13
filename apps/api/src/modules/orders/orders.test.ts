import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FloorState, KdsBoard, Order, OrderItem } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, PINS, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let kitchen: ReturnType<typeof as>;
let m: {
  kitchenId: number;
  barId: number;
  coffee: number;
  fanta: number;
  tave: number;
  salad: number;
  beer: number;
  milkGroup: number;
  oat: number;
  whole: number;
  beerSmall: number;
  beerLarge: number;
  drinksCat: number;
};
let tables: number[];

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  kitchen = as(app, await login(app, fx.users.kitchen.email), fx.locationId);

  const kitchenId = (
    await manager.post('/api/v1/stations').send({ name: 'Kuzhina', type: 'kitchen' })
  ).body.id;
  const barId = (await manager.post('/api/v1/stations').send({ name: 'Bar', type: 'bar' })).body.id;
  const drinksCat = (await manager.post('/api/v1/menu/categories').send({ name: 'Pije' })).body.id;
  const foodCat = (await manager.post('/api/v1/menu/categories').send({ name: 'Gatime' })).body.id;
  const group = (
    await manager.post('/api/v1/menu/modifier-groups').send({
      name: 'Qumështi',
      minSelect: 1,
      maxSelect: 1,
      required: true,
      modifiers: [
        { name: 'I plotë', priceDeltaMinor: 0 },
        { name: 'Tërshërë', priceDeltaMinor: 5_000 },
      ],
    })
  ).body;
  const item = async (body: Record<string, unknown>) =>
    (await manager.post('/api/v1/menu/items').send(body)).body;
  const coffee = await item({
    categoryId: drinksCat,
    stationId: barId,
    name: 'Kapuçino',
    priceMinor: 18_000,
    modifierGroupIds: [group.id],
  });
  const fanta = await item({
    categoryId: drinksCat,
    stationId: null,
    name: 'Fanta',
    priceMinor: 20_000,
  });
  const beer = await item({
    categoryId: drinksCat,
    stationId: barId,
    name: 'Birrë',
    priceMinor: 25_000,
    variants: [
      { name: '0.33', priceMinor: 25_000 },
      { name: '0.5', priceMinor: 35_000 },
    ],
  });
  const tave = await item({
    categoryId: foodCat,
    stationId: kitchenId,
    name: 'Tavë kosi',
    priceMinor: 90_000,
  });
  const salad = await item({
    categoryId: foodCat,
    stationId: kitchenId,
    name: 'Sallatë',
    priceMinor: 45_000,
  });
  m = {
    kitchenId,
    barId,
    coffee: coffee.id,
    fanta: fanta.id,
    tave: tave.id,
    salad: salad.id,
    beer: beer.id,
    milkGroup: group.id,
    whole: group.modifiers[0].id,
    oat: group.modifiers[1].id,
    beerSmall: beer.variants[0].id,
    beerLarge: beer.variants[1].id,
    drinksCat,
  };

  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  tables = [];
  for (let i = 0; i < 3; i++) {
    tables.push(
      (
        await manager
          .post('/api/v1/tables')
          .send({ areaId, name: String(i + 1), x: i * 4, y: 0, w: 3, h: 3 })
      ).body.id,
    );
  }
});

async function openTable(tableId = tables[0]!, session = waiter) {
  const res = await session
    .post('/api/v1/table-sessions')
    .send({ uuid: randomUUID(), tableId, guestCount: 2 });
  expect(res.status).toBe(201);
  return (res.body as FloorState).tables.find((t) => t.id === tableId)!.session!.id;
}

const line = (menuItemId: number, extra: Record<string, unknown> = {}) => ({
  uuid: randomUUID(),
  menuItemId,
  ...extra,
});

async function order(
  sessionId: number,
  items: unknown[],
  send = true,
  session = waiter,
): Promise<Order> {
  const res = await session.post(`/api/v1/table-sessions/${sessionId}/items`).send({ items, send });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

const byName = (o: Order, name: string): OrderItem => o.items.find((i) => i.name === name)!;
const board = async (stationId: number): Promise<KdsBoard> =>
  (await kitchen.get(`/api/v1/kds/stations/${stationId}/board`)).body;
const floorStatus = async (tableId = tables[0]!) =>
  ((await waiter.get('/api/v1/floor')).body as FloorState).tables.find((t) => t.id === tableId)!
    .status;

describe('ordering at a table', () => {
  it('first round creates the order, routes items to their stations and prices them', async () => {
    const sessionId = await openTable();
    const o = await order(sessionId, [
      line(m.coffee, { modifierIds: [m.oat] }),
      line(m.tave, { qty: 2 }),
      line(m.salad),
    ]);
    expect(o.number).toBe(1);
    expect(o.tableNames).toEqual(['1']);
    expect(byName(o, 'Kapuçino')).toMatchObject({
      status: 'sent',
      stationId: m.barId,
      lineTotalMinor: 23_000,
    });
    expect(byName(o, 'Tavë kosi')).toMatchObject({ qty: 2, lineTotalMinor: 180_000 });
    expect(o.totalMinor).toBe(23_000 + 180_000 + 45_000);

    const bar = await board(m.barId);
    expect(bar.tickets).toHaveLength(1);
    expect(bar.tickets[0]!.items.map((i) => i.name)).toEqual(['Kapuçino']);
    expect(bar.tickets[0]!.items[0]!.modifiers).toEqual(['Tërshërë']);
    const kitchenBoard = await board(m.kitchenId);
    expect(kitchenBoard.tickets[0]!.items.map((i) => i.name)).toEqual(['Tavë kosi', 'Sallatë']);
    expect(kitchenBoard.tickets[0]!).toMatchObject({
      orderNumber: 1,
      tableNames: ['1'],
      status: 'new',
    });

    expect(await floorStatus()).toBe('ordered');
    const floor = (await waiter.get('/api/v1/floor')).body as FloorState;
    expect(floor.tables.find((t) => t.id === tables[0])!.session!.totalMinor).toBe(o.totalMinor);
  });

  it('second round adds to the same order; numbers are daily per location', async () => {
    const s1 = await openTable(tables[0]);
    const s2 = await openTable(tables[1]);
    const first = await order(s1, [line(m.tave)]);
    await order(s1, [line(m.salad)]);
    const other = await order(s2, [line(m.salad)]);
    expect(await db('orders')).toHaveLength(2);
    expect(other.number).toBe(first.number + 1);
    const tickets = await db('kds_tickets').orderBy('id');
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 3]);
  });

  it('snapshots name and price: later menu edits do not change the order', async () => {
    const sessionId = await openTable();
    await order(sessionId, [line(m.tave)]);
    await manager
      .patch(`/api/v1/menu/items/${m.tave}`)
      .send({ name: 'Tavë e re', priceMinor: 99_000 });
    const o: Order = (await waiter.get(`/api/v1/table-sessions/${sessionId}/order`)).body.order;
    expect(o.items[0]).toMatchObject({ name: 'Tavë kosi', unitPriceMinor: 90_000 });
  });

  it('applies the active happy-hour price at the moment of adding', async () => {
    await manager.post('/api/v1/menu/price-rules').send({
      name: 'Gjithmonë',
      scope: 'category',
      scopeId: m.drinksCat,
      type: 'percent',
      value: 5000,
    });
    const o = await order(await openTable(), [line(m.beer, { variantId: m.beerLarge })]);
    expect(o.items[0]).toMatchObject({ variantName: '0.5', unitPriceMinor: 17_500 });
  });

  it('replaying the same items (offline queue) adds nothing new', async () => {
    const sessionId = await openTable();
    const items = [line(m.tave), line(m.salad)];
    await order(sessionId, items);
    const again = await order(sessionId, items);
    expect(again.items).toHaveLength(2);
    expect(await db('kds_tickets')).toHaveLength(1);
  });

  it('items without a station are ready straight away', async () => {
    const o = await order(await openTable(), [line(m.fanta)]);
    expect(o.items[0]!.status).toBe('ready');
    expect(await db('kds_tickets')).toHaveLength(0);
    expect(await floorStatus()).toBe('food_ready');
  });

  it.each([
    ['missing required modifier', () => line(m.coffee), 'MODIFIERS_INVALID'],
    [
      'two choices in a pick-one group',
      () => line(m.coffee, { modifierIds: [m.oat, m.whole] }),
      'MODIFIERS_INVALID',
    ],
    ['missing size', () => line(m.beer), 'MODIFIERS_INVALID'],
  ])('rejects %s', async (_label, make, code) => {
    const res = await waiter
      .post(`/api/v1/table-sessions/${await openTable()}/items`)
      .send({ items: [make()], send: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(await db('order_items')).toHaveLength(0);
  });

  it('refuses items that are 86 (out of stock)', async () => {
    await kitchen.post(`/api/v1/menu/items/${m.tave}/out-of-stock`).send({ mode: 'today' });
    const res = await waiter
      .post(`/api/v1/table-sessions/${await openTable()}/items`)
      .send({ items: [line(m.tave)], send: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
  });

  it("a waiter cannot order on another waiter's table", async () => {
    const sessionId = await openTable(tables[0], manager);
    const res = await waiter
      .post(`/api/v1/table-sessions/${sessionId}/items`)
      .send({ items: [line(m.tave)] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_YOUR_TABLE');
  });

  it('kitchen staff cannot take orders', async () => {
    const sessionId = await openTable();
    const res = await kitchen
      .post(`/api/v1/table-sessions/${sessionId}/items`)
      .send({ items: [line(m.tave)] });
    expect(res.status).toBe(403);
  });
});

describe('drafts', () => {
  it('can be edited and removed until sent; then they are locked', async () => {
    const sessionId = await openTable();
    let o = await order(sessionId, [line(m.tave), line(m.salad)], false);
    expect(o.items.every((i) => i.status === 'draft')).toBe(true);
    expect(o.totalMinor).toBe(0);
    expect(await db('kds_tickets')).toHaveLength(0);

    o = (
      await waiter
        .patch(`/api/v1/order-items/${byName(o, 'Tavë kosi').id}`)
        .send({ qty: 3, notes: 'pa kripë' })
    ).body;
    expect(byName(o, 'Tavë kosi')).toMatchObject({ qty: 3, notes: 'pa kripë' });
    o = (await waiter.delete(`/api/v1/order-items/${byName(o, 'Sallatë').id}`)).body;
    expect(o.items).toHaveLength(1);

    o = (await waiter.post(`/api/v1/orders/${o.id}/send`).send({})).body;
    expect(o.items[0]!.status).toBe('sent');
    expect(o.totalMinor).toBe(270_000);

    const edit = await waiter.patch(`/api/v1/order-items/${o.items[0]!.id}`).send({ qty: 1 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('ORDER_ITEM_ALREADY_SENT');
    const del = await waiter.delete(`/api/v1/order-items/${o.items[0]!.id}`);
    expect(del.body.error.code).toBe('ORDER_ITEM_ALREADY_SENT');
  });
});

describe('courses', () => {
  it('later courses are held until fired', async () => {
    const o = await order(await openTable(), [
      line(m.salad, { course: 1 }),
      line(m.tave, { course: 2 }),
    ]);
    expect(byName(o, 'Tavë kosi').held).toBe(true);
    expect(o.heldCourses).toEqual([2]);
    const before = await board(m.kitchenId);
    expect(before.tickets[0]!.items.find((i) => i.name === 'Tavë kosi')!.held).toBe(true);

    // Bumping only finishes the fired course.
    await kitchen.post(`/api/v1/kds/tickets/${before.tickets[0]!.id}/bump`).expect(200);
    let after: Order = (await waiter.get(`/api/v1/orders/${o.id}`)).body;
    expect(byName(after, 'Sallatë').status).toBe('ready');
    expect(byName(after, 'Tavë kosi').status).toBe('sent');
    expect((await board(m.kitchenId)).tickets[0]!.status).toBe('ready');

    after = (await waiter.post(`/api/v1/orders/${o.id}/fire`).send({ course: 2 })).body;
    expect(after.heldCourses).toEqual([]);
    expect((await board(m.kitchenId)).tickets[0]!.status).toBe('in_progress');
    const again = await waiter.post(`/api/v1/orders/${o.id}/fire`).send({ course: 2 });
    expect(again.status).toBe(409);
  });
});

describe('kitchen flow', () => {
  it('start → ready → served moves the ticket through its columns and the table colours', async () => {
    const o = await order(await openTable(), [line(m.tave), line(m.salad)]);
    const [tave, salad] = [byName(o, 'Tavë kosi'), byName(o, 'Sallatë')];

    await kitchen
      .patch(`/api/v1/order-items/${tave.id}/status`)
      .send({ status: 'preparing' })
      .expect(204);
    let b = await board(m.kitchenId);
    expect(b.tickets[0]!.status).toBe('in_progress');

    await kitchen
      .patch(`/api/v1/order-items/${tave.id}/status`)
      .send({ status: 'ready' })
      .expect(204);
    expect((await board(m.kitchenId)).tickets[0]!.status).toBe('in_progress');
    expect(await floorStatus()).toBe('food_ready');

    await kitchen
      .patch(`/api/v1/order-items/${salad.id}/status`)
      .send({ status: 'ready' })
      .expect(204);
    b = await board(m.kitchenId);
    expect(b.tickets[0]!.status).toBe('ready');
    expect(b.tickets[0]!.bumpedAt).not.toBeNull();

    const bad = await kitchen
      .patch(`/api/v1/order-items/${salad.id}/status`)
      .send({ status: 'preparing' });
    expect(bad.status).toBe(204); // ready → preparing is allowed (sent back)
    await kitchen
      .patch(`/api/v1/order-items/${salad.id}/status`)
      .send({ status: 'ready' })
      .expect(204);

    const served: Order = (await waiter.post(`/api/v1/orders/${o.id}/serve`).send({})).body;
    expect(served.items.every((i) => i.status === 'served')).toBe(true);
    b = await board(m.kitchenId);
    expect(b.tickets).toHaveLength(0);
    expect(b.recent).toHaveLength(1);
    expect(await floorStatus()).toBe('ordered');
  });

  it('rejects impossible transitions', async () => {
    const o = await order(await openTable(), [line(m.tave)]);
    await waiter.post(`/api/v1/orders/${o.id}/serve`).send({});
    const after: Order = (await waiter.get(`/api/v1/orders/${o.id}`)).body;
    expect(after.items[0]!.status).toBe('sent'); // nothing ready, nothing served
    await kitchen.patch(`/api/v1/order-items/${o.items[0]!.id}/status`).send({ status: 'ready' });
    await waiter.post(`/api/v1/order-items/${o.items[0]!.id}/serve`).expect(200);
    const res = await kitchen
      .patch(`/api/v1/order-items/${o.items[0]!.id}/status`)
      .send({ status: 'preparing' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_ITEM_STATE');
  });

  it('bump and recall', async () => {
    await order(await openTable(), [line(m.tave), line(m.salad)]);
    const ticket = (await board(m.kitchenId)).tickets[0]!;
    const bumped = (await kitchen.post(`/api/v1/kds/tickets/${ticket.id}/bump`)).body;
    expect(bumped.status).toBe('ready');
    expect(bumped.items.every((i: { status: string }) => i.status === 'ready')).toBe(true);

    const recalled = (await kitchen.post(`/api/v1/kds/tickets/${ticket.id}/recall`)).body;
    expect(recalled.status).toBe('in_progress');
    expect(recalled.items.every((i: { status: string }) => i.status === 'preparing')).toBe(true);

    const waiterTry = await waiter.post(`/api/v1/kds/tickets/${ticket.id}/bump`);
    expect(waiterTry.status).toBe(403);
  });

  it('a station board only shows its own tickets', async () => {
    await order(await openTable(), [line(m.coffee, { modifierIds: [m.whole] }), line(m.tave)]);
    expect((await board(m.barId)).tickets.flatMap((t) => t.items.map((i) => i.name))).toEqual([
      'Kapuçino',
    ]);
    const stations = (await kitchen.get('/api/v1/kds/stations')).body;
    expect(stations.map((s: { name: string }) => s.name)).toEqual(['Kuzhina', 'Bar']);
    const missing = await kitchen.get('/api/v1/kds/stations/999999/board');
    expect(missing.status).toBe(404);
  });
});

describe('void', () => {
  async function sentTave() {
    const o = await order(await openTable(), [line(m.tave), line(m.salad)]);
    return { o, item: byName(o, 'Tavë kosi') };
  }

  it('needs a manager approval token when the location requires it', async () => {
    const { item } = await sentTave();
    const without = await waiter
      .post(`/api/v1/order-items/${item.id}/void`)
      .send({ reason: 'Klienti ndryshoi mendje' });
    expect(without.status).toBe(403);
    expect(without.body.error.code).toBe('APPROVAL_INVALID');

    const approvers = (await waiter.get('/api/v1/approvers')).body as { id: number }[];
    expect(approvers.map((a) => a.id)).toContain(fx.users.manager.id);
    const approval = await waiter.post('/api/v1/approvals').send({
      approverId: fx.users.manager.id,
      pin: PINS.manager,
      action: 'order_item.void',
      entityType: 'order_item',
      entityId: String(item.id),
    });
    expect(approval.status).toBe(201);
    const res = await waiter
      .post(`/api/v1/order-items/${item.id}/void`)
      .send({ reason: 'Klienti ndryshoi mendje', approvalToken: approval.body.approvalToken });
    expect(res.status).toBe(200);
    const o: Order = res.body;
    expect(byName(o, 'Tavë kosi')).toMatchObject({
      status: 'voided',
      voidReason: 'Klienti ndryshoi mendje',
      lineTotalMinor: 0,
    });
    expect(o.totalMinor).toBe(45_000);

    const row = await db('order_items').where({ id: item.id }).first();
    expect(row).toMatchObject({
      voided_by: fx.users.waiter.id,
      void_approved_by: fx.users.manager.id,
    });
    const audit = await db('audit_logs').where({ action: 'order_item.voided' }).first();
    expect(audit).toMatchObject({ user_id: fx.users.waiter.id, approved_by: fx.users.manager.id });

    // Single use: the token cannot void anything else.
    const salad = byName(o, 'Sallatë');
    const reuse = await waiter
      .post(`/api/v1/order-items/${salad.id}/void`)
      .send({ reason: 'Provë', approvalToken: approval.body.approvalToken });
    expect(reuse.status).toBe(403);
  });

  it('a manager approves their own void', async () => {
    const sessionId = await openTable(tables[0], manager);
    const o = await order(sessionId, [line(m.tave)], true, manager);
    const res = await manager
      .post(`/api/v1/order-items/${o.items[0]!.id}/void`)
      .send({ reason: 'Gabim' });
    expect(res.status).toBe(200);
    expect(await db('order_items').where({ id: o.items[0]!.id }).first()).toMatchObject({
      void_approved_by: fx.users.manager.id,
    });
  });

  it('needs a reason; drafts cannot be voided; the ticket drops the item', async () => {
    const { item } = await sentTave();
    const noReason = await manager.post(`/api/v1/order-items/${item.id}/void`).send({ reason: '' });
    expect(noReason.status).toBe(400);

    await manager
      .post(`/api/v1/order-items/${item.id}/void`)
      .send({ reason: 'Ra në tokë' })
      .expect(200);
    const ticket = (await board(m.kitchenId)).tickets[0]!;
    expect(ticket.items.find((i) => i.name === 'Tavë kosi')!.status).toBe('voided');

    const draft = await order(await openTable(tables[1]), [line(m.salad)], false);
    const res = await manager
      .post(`/api/v1/order-items/${draft.items[0]!.id}/void`)
      .send({ reason: 'Gabim' });
    expect(res.status).toBe(409);
  });

  it('works without approval when the location does not require it', async () => {
    await db('locations')
      .where({ id: fx.locationId })
      .update({ settings: JSON.stringify({ voidRequiresApproval: false }) });
    const { item } = await sentTave();
    const res = await waiter.post(`/api/v1/order-items/${item.id}/void`).send({ reason: 'Gabim' });
    expect(res.status).toBe(200);
  });
});

describe('same again', () => {
  it('copies items with options and sends them', async () => {
    const o = await order(await openTable(), [line(m.coffee, { modifierIds: [m.oat] })]);
    const res = await waiter
      .post(`/api/v1/orders/${o.id}/repeat`)
      .send({ itemRefs: [o.items[0]!.id], uuids: [randomUUID()] });
    expect(res.status).toBe(201);
    const after: Order = res.body;
    expect(after.items).toHaveLength(2);
    expect(after.items[1]).toMatchObject({
      name: 'Kapuçino',
      status: 'sent',
      lineTotalMinor: 23_000,
    });
    expect(after.items[1]!.modifiers.map((x) => x.name)).toEqual(['Tërshërë']);
  });
});

describe('combos', () => {
  async function lunch() {
    const res = await manager.post('/api/v1/menu/combos').send({
      name: 'Menu dreke',
      priceMinor: 90_000,
      categoryId: m.drinksCat,
      slots: [
        {
          name: 'Pjata',
          items: [{ menuItemId: m.tave }, { menuItemId: m.salad, priceDeltaMinor: 0 }],
        },
        {
          name: 'Pija',
          items: [{ menuItemId: m.fanta }, { menuItemId: m.beer, priceDeltaMinor: 10_000 }],
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: number; slots: { id: number }[] };
  }

  it('one priced line; its dishes go to their stations for free', async () => {
    const combo = await lunch();
    const o = await order(await openTable(), [
      {
        uuid: randomUUID(),
        comboId: combo.id,
        comboSelections: [
          { slotId: combo.slots[0]!.id, menuItemId: m.tave },
          { slotId: combo.slots[1]!.id, menuItemId: m.beer, variantId: m.beerSmall },
        ],
      },
    ]);
    const parent = byName(o, 'Menu dreke');
    expect(parent).toMatchObject({ unitPriceMinor: 100_000, status: 'sent', stationId: null });
    const children = o.items.filter((i) => i.parentItemId === parent.id);
    expect(children.map((c) => [c.name, c.unitPriceMinor, c.stationId])).toEqual([
      ['Tavë kosi', 0, m.kitchenId],
      ['Birrë', 0, m.barId],
    ]);
    expect(o.totalMinor).toBe(100_000);
    expect((await board(m.kitchenId)).tickets[0]!.items[0]!.comboName).toBe('Menu dreke');

    // The combo line follows its dishes.
    for (const c of children)
      await kitchen.patch(`/api/v1/order-items/${c.id}/status`).send({ status: 'ready' });
    const ready: Order = (await waiter.get(`/api/v1/orders/${o.id}`)).body;
    expect(byName(ready, 'Menu dreke').status).toBe('ready');

    // Repeat it.
    const again: Order = (
      await waiter
        .post(`/api/v1/orders/${o.id}/repeat`)
        .send({ itemRefs: [parent.id], uuids: [randomUUID()] })
    ).body;
    expect(again.items.filter((i) => i.comboId !== null)).toHaveLength(2);
    expect(again.totalMinor).toBe(200_000);
  });

  it('every slot must be chosen from its list', async () => {
    const combo = await lunch();
    const sessionId = await openTable();
    const missing = await waiter.post(`/api/v1/table-sessions/${sessionId}/items`).send({
      items: [
        {
          uuid: randomUUID(),
          comboId: combo.id,
          comboSelections: [{ slotId: combo.slots[0]!.id, menuItemId: m.tave }],
        },
      ],
    });
    expect(missing.body.error.code).toBe('COMBO_INVALID');
    const wrong = await waiter.post(`/api/v1/table-sessions/${sessionId}/items`).send({
      items: [
        {
          uuid: randomUUID(),
          comboId: combo.id,
          comboSelections: [
            { slotId: combo.slots[0]!.id, menuItemId: m.coffee },
            { slotId: combo.slots[1]!.id, menuItemId: m.fanta },
          ],
        },
      ],
    });
    expect(wrong.body.error.code).toBe('COMBO_INVALID');
  });

  it('voiding the combo voids its dishes', async () => {
    const combo = await lunch();
    const o = await order(
      await openTable(tables[0], manager),
      [
        {
          uuid: randomUUID(),
          comboId: combo.id,
          comboSelections: [
            { slotId: combo.slots[0]!.id, menuItemId: m.salad },
            { slotId: combo.slots[1]!.id, menuItemId: m.fanta },
          ],
        },
      ],
      true,
      manager,
    );
    const parent = byName(o, 'Menu dreke');
    const after: Order = (
      await manager.post(`/api/v1/order-items/${parent.id}/void`).send({ reason: 'Gabim' })
    ).body;
    expect(after.items.filter((i) => i.status !== 'voided').map((i) => i.name)).toEqual([]);
    expect(after.totalMinor).toBe(0);
  });
});

describe('takeaway and delivery', () => {
  it('creates numbered orders without a table and lists them', async () => {
    const cashier = as(app, await login(app, fx.users.cashier.email), fx.locationId);
    const uuid = randomUUID();
    const created = await cashier
      .post('/api/v1/orders')
      .send({ uuid, type: 'takeaway', customerName: 'Arben' });
    expect(created.status).toBe(201);
    const replay = await cashier
      .post('/api/v1/orders')
      .send({ uuid, type: 'takeaway', customerName: 'Arben' });
    expect(replay.body.id).toBe(created.body.id);
    const noAddress = await cashier
      .post('/api/v1/orders')
      .send({ uuid: randomUUID(), type: 'delivery' });
    expect(noAddress.status).toBe(400);

    await cashier
      .post(`/api/v1/orders/${uuid}/items`)
      .send({ items: [line(m.tave)], send: true })
      .expect(201);
    const list = (await cashier.get('/api/v1/orders')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      customerName: 'Arben',
      itemCount: 1,
      totalMinor: 90_000,
      tableNames: [],
    });
  });
});

describe('floor integration', () => {
  it('merging tables moves the other order into this one', async () => {
    const s1 = await openTable(tables[0]);
    const s2 = await openTable(tables[1]);
    await order(s1, [line(m.tave)]);
    await order(s2, [line(m.salad)]);
    await waiter
      .post(`/api/v1/table-sessions/${s1}/merge`)
      .send({ tableId: tables[1] })
      .expect(200);
    const merged: Order = (await waiter.get(`/api/v1/table-sessions/${s1}/order`)).body.order;
    expect(merged.items.map((i) => i.name).sort()).toEqual(['Sallatë', 'Tavë kosi']);
    expect(merged.totalMinor).toBe(135_000);
    expect(merged.tableNames).toEqual(['1', '2']);
    expect(await db('orders').where({ status: 'cancelled' })).toHaveLength(1);
  });

  it('a table closes only when paid, and its order closes with it', async () => {
    const s1 = await openTable();
    const o = await order(s1, [line(m.tave)]);
    await waiter.post(`/api/v1/table-sessions/${s1}/request-bill`).expect(200);
    // Business rule 4: not while something is owed.
    expect((await waiter.post(`/api/v1/table-sessions/${s1}/close`)).body.error.code).toBe(
      'BALANCE_DUE',
    );
    await waiter
      .post(`/api/v1/orders/${o.id}/payments`)
      .send({ uuid: randomUUID(), method: 'card', amountMinor: o.totalMinor, reference: 'T1' })
      .expect(201);
    await waiter.post(`/api/v1/table-sessions/${s1}/close`).expect(200);
    expect(await db('orders').where({ id: o.id }).first()).toMatchObject({ status: 'closed' });
    const res = await waiter.post(`/api/v1/orders/${o.id}/items`).send({ items: [line(m.salad)] });
    expect(res.status).toBe(409);
  });
});
