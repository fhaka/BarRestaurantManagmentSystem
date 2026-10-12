import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { RealtimeEnvelope } from '@tavolina/shared';
import { createApp } from '../app.js';
import {
  as,
  createLocation,
  login,
  resetAndSeed,
  type Fixture,
  type Session,
} from '../test/fixtures.js';
import { attachRealtime, closeRealtime } from './server.js';

const app = createApp();
let server: Server;
let url: string;
let fx: Fixture;
let manager: Session;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = createServer(app);
  attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await closeRealtime();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = await login(app, fx.users.manager.email);
});

function socketFor(auth: Record<string, unknown>): Promise<Socket> {
  const socket = connect(url, {
    path: '/socket.io',
    auth,
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

describe('Socket.IO', () => {
  it('a signed-in client receives table.updated when another device opens a table', async () => {
    const watcher = await socketFor({ token: manager.token, locationId: fx.locationId });
    const api = as(app, manager, fx.locationId);
    const areaId = (await api.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
    const tableId = (
      await api.post('/api/v1/tables').send({ areaId, name: '1', x: 0, y: 0, w: 3, h: 3 })
    ).body.id;

    const received = new Promise<RealtimeEnvelope<{ tableIds: number[]; layout: boolean }>>(
      (resolve) => {
        watcher.on('table.updated', (e) => {
          if (!e.data.layout) resolve(e);
        });
      },
    );
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    await waiter
      .post('/api/v1/table-sessions')
      .send({ uuid: randomUUID(), tableId, guestCount: 2 })
      .expect(201);

    const event = await received;
    expect(event).toMatchObject({
      type: 'table.updated',
      locationId: fx.locationId,
      data: { tableIds: [tableId] },
    });
  });

  it('rejects a bad token', async () => {
    await expect(socketFor({ token: 'nope', locationId: fx.locationId })).rejects.toThrow(
      'unauthorized',
    );
  });

  it('rejects a location the user cannot access', async () => {
    const other = await createLocation(fx.accountId, 'Other branch');
    await expect(socketFor({ token: manager.token, locationId: other })).rejects.toThrow(
      'forbidden',
    );
  });

  it('does not send one location’s events to another location', async () => {
    const owner = await login(app, fx.users.owner.email);
    const other = await createLocation(fx.accountId, 'Other branch');
    await import('../db/knex.js').then(({ db }) =>
      db('user_locations').insert({
        user_id: fx.users.owner.id,
        location_id: other,
        role_id: db('roles').where({ key: 'owner' }).select('id'),
      }),
    );
    const elsewhere = await socketFor({ token: owner.token, locationId: other });
    let leaked = false;
    elsewhere.on('table.updated', () => {
      leaked = true;
    });
    await as(app, manager, fx.locationId).post('/api/v1/areas').send({ name: 'Salla' }).expect(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
  });

  it('kitchen screens join a station room; waiters hear when food is ready', async () => {
    const api = as(app, manager, fx.locationId);
    const stationId = (
      await api.post('/api/v1/stations').send({ name: 'Kuzhina', type: 'kitchen' })
    ).body.id;
    const categoryId = (await api.post('/api/v1/menu/categories').send({ name: 'Gatime' })).body.id;
    const itemId = (
      await api
        .post('/api/v1/menu/items')
        .send({ categoryId, stationId, name: 'Tavë', priceMinor: 90_000 })
    ).body.id;
    const areaId = (await api.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
    const tableId = (
      await api.post('/api/v1/tables').send({ areaId, name: '1', x: 0, y: 0, w: 3, h: 3 })
    ).body.id;

    const kitchenSession = await login(app, fx.users.kitchen.email);
    const screen = await socketFor({ token: kitchenSession.token, locationId: fx.locationId });
    const joined = await new Promise<boolean>((resolve) =>
      screen.emit('station:join', { stationId }, resolve),
    );
    expect(joined).toBe(true);
    const refused = await new Promise<boolean>((resolve) =>
      screen.emit('station:join', { stationId: 999_999 }, resolve),
    );
    expect(refused).toBe(false);

    const waiterSession = await login(app, fx.users.waiter.email);
    const phone = await socketFor({ token: waiterSession.token, locationId: fx.locationId });
    const waiter = as(app, waiterSession, fx.locationId);
    const sent = new Promise<RealtimeEnvelope<{ stationIds: number[] }>>((resolve) =>
      screen.on('order.items_sent', resolve),
    );
    const sessionId = (
      await waiter
        .post('/api/v1/table-sessions')
        .send({ uuid: randomUUID(), tableId, guestCount: 2 })
    ).body.tables.find((t: { id: number }) => t.id === tableId).session.id;
    await waiter
      .post(`/api/v1/table-sessions/${sessionId}/items`)
      .send({ items: [{ uuid: randomUUID(), menuItemId: itemId }], send: true })
      .expect(201);
    expect((await sent).data.stationIds).toEqual([stationId]);

    const ready = new Promise<RealtimeEnvelope<{ waiterId: number; items: { status: string }[] }>>(
      (resolve) => phone.on('order_item.status_changed', resolve),
    );
    const bumped = new Promise<RealtimeEnvelope<{ status: string }>>((resolve) =>
      screen.on('kds.ticket_bumped', resolve),
    );
    const kitchen = as(app, kitchenSession, fx.locationId);
    const board = (await kitchen.get(`/api/v1/kds/stations/${stationId}/board`)).body;
    await kitchen.post(`/api/v1/kds/tickets/${board.tickets[0].id}/bump`).expect(200);
    const event = await ready;
    expect(event.data.waiterId).toBe(fx.users.waiter.id);
    expect(event.data.items[0]!.status).toBe('ready');
    expect((await bumped).data.status).toBe('ready');
  });
});
