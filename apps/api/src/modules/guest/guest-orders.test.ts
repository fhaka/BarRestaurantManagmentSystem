import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  localParts,
  type FloorState,
  type GuestMenu,
  type GuestTableState,
  type Order,
} from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let kitchen: ReturnType<typeof as>;
let m: { kitchenId: number; tave: number; salad: number; hidden: number; breakfast: number };
let tableId: number;
let token: string;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  kitchen = as(app, await login(app, fx.users.kitchen.email), fx.locationId);
  const kitchenId = (await manager.post('/api/v1/stations').send({ name: 'Kuzhina' })).body.id;
  const food = (await manager.post('/api/v1/menu/categories').send({ name: 'Gatime' })).body.id;
  // A category that is never open today (every weekday except today's, Tirana time).
  const today = localParts(new Date(), 'Europe/Tirane').weekday;
  const closed = (
    await manager
      .post('/api/v1/menu/categories')
      .send({ name: 'Mëngjes', weekdayMask: 0b1111111 & ~(1 << today) })
  ).body.id;
  const item = async (body: Record<string, unknown>) =>
    (await manager.post('/api/v1/menu/items').send({ stationId: kitchenId, ...body })).body.id;
  m = {
    kitchenId,
    tave: await item({ categoryId: food, name: 'Tavë kosi', priceMinor: 90_000 }),
    salad: await item({ categoryId: food, name: 'Sallatë', priceMinor: 45_000 }),
    hidden: await item({
      categoryId: food,
      name: 'Pjata e stafit',
      priceMinor: 10_000,
      guestVisible: false,
    }),
    breakfast: await item({ categoryId: closed, name: 'Byrek', priceMinor: 15_000 }),
  };
  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  tableId = (
    await manager.post('/api/v1/tables').send({ areaId, name: '4', x: 0, y: 0, w: 3, h: 3 })
  ).body.id;
  token = (await db('tables').where({ id: tableId }).first('qr_token')).qr_token;
});

const line = (menuItemId: number, extra: Record<string, unknown> = {}) => ({
  uuid: randomUUID(),
  menuItemId,
  ...extra,
});

/** A guest's phone: keeps its cookie between requests. */
const phone = () => request.agent(app);
const url = (path = '') => `/api/v1/guest/t/${token}${path}`;

async function guestOrder(agent = phone(), items = [line(m.tave), line(m.salad)]) {
  const res = await agent.post(url('/orders')).send({ items });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { agent, state: res.body as GuestTableState };
}

const floorTable = async (session = waiter) =>
  ((await session.get('/api/v1/floor')).body as FloorState).tables.find((t) => t.id === tableId)!;

async function setSettings(settings: Record<string, unknown>) {
  await db('locations')
    .where({ id: fx.locationId })
    .update({ settings: JSON.stringify(settings) });
}

describe('QR page', () => {
  it('knows the table, the location and the ordering settings; bad tokens are refused', async () => {
    const res = await request(app).get(url());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      table: { id: tableId, name: '4' },
      orderingEnabled: true,
      requiresConfirmation: true,
    });
    expect((await request(app).get('/api/v1/guest/t/not-a-real-token')).status).toBe(404);
  });

  it('serves the guest menu without hidden items', async () => {
    const menu: GuestMenu = (await request(app).get(url('/menu?lang=sq'))).body;
    const names = menu.categories.flatMap((c) => c.items.map((i) => i.name));
    expect(names).toContain('Tavë kosi');
    expect(names).not.toContain('Pjata e stafit');
  });
});

describe('guest orders with waiter confirmation (default)', () => {
  it('opens a free table, waits for a waiter, then goes to the kitchen', async () => {
    const { agent, state } = await guestOrder();
    expect(state.session?.status).toBe('open');
    expect(state.lines.map((l) => [l.name, l.status, l.mine])).toEqual([
      ['Tavë kosi', 'pending_confirmation', true],
      ['Sallatë', 'pending_confirmation', true],
    ]);
    expect(state.totalMinor).toBe(135_000);
    expect(await db('kds_tickets')).toHaveLength(0);

    // Nobody has taken the table yet: every waiter may act on it.
    const table = await floorTable();
    expect(table.session).toMatchObject({ waiterId: null, mine: true, pendingGuestItems: 2 });

    const orderRes = await waiter.get(`/api/v1/table-sessions/${table.session!.id}/order`);
    const order: Order = orderRes.body.order;
    expect(order.items.every((i) => i.source === 'guest')).toBe(true);
    const confirmed: Order = (
      await waiter.post(`/api/v1/orders/${order.id}/guest-items/confirm`).send({})
    ).body;
    expect(confirmed.items.map((i) => i.status)).toEqual(['sent', 'sent']);
    expect(await db('kds_tickets')).toHaveLength(1);
    // The waiter who confirmed now owns the table.
    expect((await floorTable()).session).toMatchObject({
      waiterId: fx.users.waiter.id,
      pendingGuestItems: 0,
    });

    // The kitchen bumps; the guest sees it ready.
    const board = (await kitchen.get(`/api/v1/kds/stations/${m.kitchenId}/board`)).body;
    await kitchen.post(`/api/v1/kds/tickets/${board.tickets[0].id}/bump`).expect(200);
    const after: GuestTableState = (await agent.get(url('/state'))).body;
    expect(after.lines.map((l) => l.status)).toEqual(['ready', 'ready']);
  });

  it('a waiter can turn guest lines down', async () => {
    const { agent } = await guestOrder();
    const sessionId = (await floorTable()).session!.id;
    const order: Order = (await waiter.get(`/api/v1/table-sessions/${sessionId}/order`)).body.order;
    const rejected: Order = (
      await waiter
        .post(`/api/v1/orders/${order.id}/guest-items/reject`)
        .send({ itemRefs: [order.items[0]!.id], reason: 'Gabim' })
    ).body;
    expect(rejected.items.map((i) => i.status)).toEqual(['voided', 'pending_confirmation']);
    const state: GuestTableState = (await agent.get(url('/state'))).body;
    expect(state.lines[0]).toMatchObject({ status: 'voided', lineTotalMinor: 0 });
    expect(state.totalMinor).toBe(45_000);
  });

  it('phones at one table share the order but know which lines are theirs', async () => {
    const first = await guestOrder(phone(), [line(m.tave)]);
    const second = await guestOrder(phone(), [line(m.salad, { qty: 2 })]);
    expect(second.state.lines.map((l) => [l.name, l.mine])).toEqual([
      ['Tavë kosi', false],
      ['Sallatë', true],
    ]);
    expect(second.state.myTotalMinor).toBe(90_000);
    expect(second.state.totalMinor).toBe(180_000);
    const firstView: GuestTableState = (await first.agent.get(url('/state'))).body;
    expect(firstView.lines.map((l) => l.mine)).toEqual([true, false]);
    expect(await db('table_sessions')).toHaveLength(1);
  });

  it('guests join the table a waiter already opened, and see staff lines too', async () => {
    const opened: FloorState = (
      await waiter
        .post('/api/v1/table-sessions')
        .send({ uuid: randomUUID(), tableId, guestCount: 2 })
    ).body;
    const sessionId = opened.tables.find((t) => t.id === tableId)!.session!.id;
    await waiter
      .post(`/api/v1/table-sessions/${sessionId}/items`)
      .send({ items: [line(m.salad)], send: true })
      .expect(201);
    const { state } = await guestOrder(phone(), [line(m.tave)]);
    expect(state.lines.map((l) => [l.name, l.byStaff, l.status])).toEqual([
      ['Sallatë', true, 'sent'],
      ['Tavë kosi', false, 'pending_confirmation'],
    ]);
    // The waiter is still the owner and is told about the guest order.
    expect((await floorTable()).session).toMatchObject({ waiterId: fx.users.waiter.id });
  });

  it('a different waiter cannot touch a table once someone has taken it', async () => {
    await guestOrder();
    const sessionId = (await floorTable()).session!.id;
    const order: Order = (await waiter.get(`/api/v1/table-sessions/${sessionId}/order`)).body.order;
    await waiter.post(`/api/v1/orders/${order.id}/guest-items/confirm`).send({}).expect(200);
    const db2 = await db('users').insert({
      account_id: fx.accountId,
      name: 'Waiter Two',
      email: 'w2@test.test',
      password_hash: (await db('users').where({ id: fx.users.waiter.id }).first()).password_hash,
    });
    await db('user_locations').insert({
      user_id: db2[0],
      location_id: fx.locationId,
      role_id: db('roles').where({ key: 'waiter' }).select('id'),
    });
    const other = as(app, await login(app, 'w2@test.test'), fx.locationId);
    const res = await other.post(`/api/v1/orders/${order.id}/guest-items/confirm`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_YOUR_TABLE');
  });
});

describe('settings', () => {
  it('straight to the kitchen when confirmation is off', async () => {
    await setSettings({ guestOrdersRequireConfirmation: false });
    const { state } = await guestOrder();
    expect(state.lines.map((l) => l.status)).toEqual(['sent', 'sent']);
    expect(await db('kds_tickets')).toHaveLength(1);
  });

  it('ordering can be turned off (the menu still works)', async () => {
    await setSettings({ guestOrderingEnabled: false });
    expect((await request(app).get(url())).body.orderingEnabled).toBe(false);
    const res = await phone()
      .post(url('/orders'))
      .send({ items: [line(m.tave)] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GUEST_ORDERING_DISABLED');
  });
});

describe('what guests may order', () => {
  it.each([
    ['an item hidden from guests', () => m.hidden, 'ITEM_UNAVAILABLE'],
    ['an item outside its serving hours', () => m.breakfast, 'ITEM_NOT_AVAILABLE_NOW'],
  ])('refuses %s', async (_label, id, code) => {
    const res = await phone()
      .post(url('/orders'))
      .send({ items: [line(id())] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(code);
    expect(await db('order_items')).toHaveLength(0);
  });

  it('ignores seats and courses sent by a guest', async () => {
    await guestOrder(phone(), [line(m.tave, { seat: 3, course: 2 })]);
    expect(await db('order_items').first()).toMatchObject({ seat: null, course: null, held: 0 });
  });
});

describe('anti-abuse', () => {
  it('business rule 8: at most 5 orders a minute from one phone', async () => {
    const agent = phone();
    for (let i = 0; i < 5; i++) await guestOrder(agent, [line(m.salad)]);
    const res = await agent.post(url('/orders')).send({ items: [line(m.salad)] });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ORDERS');
    // Another phone at the table is not affected.
    await guestOrder(phone(), [line(m.salad)]);
  });

  it('a waiter can block one phone', async () => {
    const { agent } = await guestOrder();
    const sessionId = (await floorTable()).session!.id;
    const guests = (await waiter.get(`/api/v1/table-sessions/${sessionId}/guests`)).body;
    expect(guests).toHaveLength(1);
    expect(guests[0]).toMatchObject({ blocked: false, itemCount: 2 });
    await waiter
      .post(`/api/v1/guest-sessions/${guests[0].id}/block`)
      .send({ blocked: true })
      .expect(204);

    const res = await agent.post(url('/orders')).send({ items: [line(m.salad)] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GUEST_BLOCKED');
    expect(((await agent.get(url('/state'))).body as GuestTableState).blocked).toBe(true);
    expect(await db('audit_logs').where({ action: 'guest.blocked' })).toHaveLength(1);
  });

  it("the previous party's phone cannot order on the next party's bill", async () => {
    const { agent } = await guestOrder();
    const sessionId = (await floorTable()).session!.id;
    const order: Order = (await waiter.get(`/api/v1/table-sessions/${sessionId}/order`)).body.order;
    await waiter.post(`/api/v1/orders/${order.id}/guest-items/confirm`).send({});
    await waiter.post(`/api/v1/table-sessions/${sessionId}/close`).expect(200);

    const view: GuestTableState = (await agent.get(url('/state'))).body;
    expect(view.session).toBeNull();
    expect(view.lines).toHaveLength(0);
    // Ordering again starts a new party with a new guest session.
    const { state } = await guestOrder(agent, [line(m.salad)]);
    expect(state.lines.map((l) => [l.name, l.mine])).toEqual([['Sallatë', true]]);
    expect(await db('guest_sessions')).toHaveLength(2);
  });
});

describe('call waiter and bill requests', () => {
  it('call waiter works on a free table; a bill needs an order', async () => {
    const agent = phone();
    await agent.post(url('/requests')).send({ type: 'call_waiter' }).expect(201);
    await agent.post(url('/requests')).send({ type: 'call_waiter' }).expect(201);
    expect(await db('service_requests')).toHaveLength(1);
    const bill = await agent.post(url('/requests')).send({ type: 'bill_card' });
    expect(bill.status).toBe(409);

    const requests = (await waiter.get('/api/v1/service-requests')).body;
    expect(requests).toMatchObject([{ type: 'call_waiter', tableName: '4' }]);
    expect((await floorTable()).requests).toHaveLength(1);
    await waiter.post(`/api/v1/service-requests/${requests[0].id}/handle`).expect(204);
    expect((await waiter.get('/api/v1/service-requests')).body).toHaveLength(0);
  });

  it('asking for the bill marks the table and is settled when the table closes', async () => {
    const { agent } = await guestOrder();
    const state: GuestTableState = (await agent.post(url('/requests')).send({ type: 'bill_cash' }))
      .body;
    expect(state.openRequests.map((r) => r.type)).toEqual(['bill_cash']);
    const table = await floorTable();
    expect(table.status).toBe('bill_requested');
    expect(table.requests.map((r) => r.type)).toEqual(['bill_cash']);
    await waiter.post(`/api/v1/table-sessions/${table.session!.id}/close`).expect(200);
    expect(await db('service_requests').where({ status: 'open' })).toHaveLength(0);
  });
});
