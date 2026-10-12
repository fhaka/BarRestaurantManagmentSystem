import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FloorState, FloorTable } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let waiter: ReturnType<typeof as>;
let tables: number[];

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  const areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
  tables = [];
  for (let i = 0; i < 4; i++) {
    const res = await manager
      .post('/api/v1/tables')
      .send({ areaId, name: String(i + 1), x: i * 4, y: 0, w: 3, h: 3 });
    tables.push(res.body.id);
  }
});

const tableIn = (floor: FloorState, id: number): FloorTable =>
  floor.tables.find((t) => t.id === id)!;

async function open(tableId: number, as_ = waiter, guestCount = 2) {
  const res = await as_
    .post('/api/v1/table-sessions')
    .send({ uuid: randomUUID(), tableId, guestCount });
  expect(res.status).toBe(201);
  return tableIn(res.body, tableId).session!;
}

describe('open', () => {
  it('seats guests: the table becomes occupied by this waiter', async () => {
    const session = await open(tables[0]!);
    expect(session).toMatchObject({
      status: 'open',
      guestCount: 2,
      waiterId: fx.users.waiter.id,
      mine: true,
    });
    const floor: FloorState = (await manager.get('/api/v1/floor')).body;
    expect(tableIn(floor, tables[0]!).status).toBe('occupied');
  });

  it('refuses a table that already has guests', async () => {
    await open(tables[0]!);
    const res = await manager
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId: tables[0], guestCount: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_OCCUPIED');
  });

  it('is idempotent on the client uuid (offline replay)', async () => {
    const body = { uuid: randomUUID(), tableId: tables[0], guestCount: 3 };
    await waiter.post('/api/v1/table-sessions').send(body).expect(201);
    await waiter.post('/api/v1/table-sessions').send(body).expect(201);
    expect(await db('table_sessions')).toHaveLength(1);
  });

  it('two waiters opening the same table at once: exactly one wins', async () => {
    const results = await Promise.all([
      waiter
        .post('/api/v1/table-sessions')
        .send({ uuid: randomUUID(), tableId: tables[1], guestCount: 2 }),
      manager
        .post('/api/v1/table-sessions')
        .send({ uuid: randomUUID(), tableId: tables[1], guestCount: 2 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('own tables only (plan §4)', () => {
  it('a waiter cannot act on another waiter’s table unless the setting allows it', async () => {
    const session = await open(tables[0]!, manager);
    const floor: FloorState = (await waiter.get('/api/v1/floor')).body;
    expect(floor.canActOnAllTables).toBe(false);
    expect(tableIn(floor, tables[0]!).session!.mine).toBe(false);

    const res = await waiter.post(`/api/v1/table-sessions/${session.id}/request-bill`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_YOUR_TABLE');

    await db('locations')
      .where({ id: fx.locationId })
      .update({ settings: JSON.stringify({ waitersSeeAllTables: true }) });
    await waiter.post(`/api/v1/table-sessions/${session.id}/request-bill`).expect(200);
  });
});

describe('transfer', () => {
  it('moves guests to a free table; the old table needs cleaning; audited', async () => {
    const session = await open(tables[0]!);
    const res = await waiter
      .post(`/api/v1/table-sessions/${session.id}/transfer`)
      .send({ toTableId: tables[1] });
    expect(res.status).toBe(200);
    expect(tableIn(res.body, tables[1]!).session!.id).toBe(session.id);
    expect(tableIn(res.body, tables[0]!).status).toBe('needs_cleaning');
    expect(await db('audit_logs').where({ action: 'table_session.table_changed' })).toHaveLength(1);
  });

  it('refuses a table that is taken', async () => {
    const a = await open(tables[0]!);
    await open(tables[1]!);
    const res = await waiter
      .post(`/api/v1/table-sessions/${a.id}/transfer`)
      .send({ toTableId: tables[1] });
    expect(res.body.error.code).toBe('TABLE_OCCUPIED');
  });

  it('hands a table to another waiter', async () => {
    const session = await open(tables[0]!);
    const res = await waiter
      .post(`/api/v1/table-sessions/${session.id}/transfer`)
      .send({ toWaiterId: fx.users.manager.id });
    expect(tableIn(res.body, tables[0]!).session!.waiterId).toBe(fx.users.manager.id);
    // The kitchen role cannot take tables.
    const bad = await manager
      .post(`/api/v1/table-sessions/${session.id}/transfer`)
      .send({ toWaiterId: fx.users.kitchen.id });
    expect(bad.status).toBe(400);
  });
});

describe('merge & split', () => {
  it('merges a free table into the session', async () => {
    const session = await open(tables[0]!);
    const res = await waiter
      .post(`/api/v1/table-sessions/${session.id}/merge`)
      .send({ tableId: tables[1] });
    expect(tableIn(res.body, tables[1]!).session!.id).toBe(session.id);
    expect(tableIn(res.body, tables[0]!).session!.tableIds.sort()).toEqual(
      [tables[0], tables[1]].sort(),
    );
  });

  it('merging an occupied table moves its guests and closes its session as merged', async () => {
    const a = await open(tables[0]!, waiter, 2);
    const b = await open(tables[1]!, waiter, 3);
    const res = await waiter
      .post(`/api/v1/table-sessions/${a.id}/merge`)
      .send({ tableId: tables[1] });
    expect(tableIn(res.body, tables[0]!).session!.guestCount).toBe(5);
    const merged = await db('table_sessions').where({ id: b.id }).first();
    expect(merged).toMatchObject({ status: 'closed', merged_into_id: a.id });
  });

  it('splits a table back out of the group; it becomes free', async () => {
    const session = await open(tables[0]!);
    await waiter.post(`/api/v1/table-sessions/${session.id}/merge`).send({ tableId: tables[1] });
    // Splitting the main table moves the session to the remaining one.
    const res = await waiter
      .post(`/api/v1/table-sessions/${session.id}/split`)
      .send({ tableId: tables[0] });
    expect(tableIn(res.body, tables[0]!).status).toBe('free');
    expect(tableIn(res.body, tables[1]!).session).toMatchObject({
      id: session.id,
      primaryTableId: tables[1],
    });

    const single = await waiter
      .post(`/api/v1/table-sessions/${session.id}/split`)
      .send({ tableId: tables[1] });
    expect(single.body.error.code).toBe('SESSION_STATE');
  });
});

describe('bill & close', () => {
  it('request bill → reopen → close; tables need cleaning, then are cleaned', async () => {
    const session = await open(tables[0]!);
    let res = await waiter.post(`/api/v1/table-sessions/${session.id}/request-bill`);
    expect(tableIn(res.body, tables[0]!).status).toBe('bill_requested');
    res = await waiter.post(`/api/v1/table-sessions/${session.id}/reopen`);
    expect(tableIn(res.body, tables[0]!).status).toBe('occupied');

    res = await waiter.post(`/api/v1/table-sessions/${session.id}/close`);
    expect(tableIn(res.body, tables[0]!)).toMatchObject({
      status: 'needs_cleaning',
      session: null,
    });
    expect(await db('audit_logs').where({ action: 'table_session.closed' })).toHaveLength(1);

    res = await waiter.post(`/api/v1/tables/${tables[0]}/clean`);
    expect(tableIn(res.body, tables[0]!).status).toBe('free');
  });

  it('rejects invalid transitions', async () => {
    const session = await open(tables[0]!);
    const res = await waiter.post(`/api/v1/table-sessions/${session.id}/reopen`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_STATE');
  });

  it('a cashier can close a table but not open one', async () => {
    const cashier = as(app, await login(app, fx.users.cashier.email), fx.locationId);
    await cashier
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId: tables[2], guestCount: 2 })
      .expect(403);
    const session = await open(tables[0]!);
    await cashier.post(`/api/v1/table-sessions/${session.id}/close`).expect(200);
  });

  it('closed sessions cannot be changed', async () => {
    const session = await open(tables[0]!);
    await waiter.post(`/api/v1/table-sessions/${session.id}/close`).expect(200);
    await waiter.patch(`/api/v1/table-sessions/${session.id}`).send({ guestCount: 4 }).expect(404);
  });
});
