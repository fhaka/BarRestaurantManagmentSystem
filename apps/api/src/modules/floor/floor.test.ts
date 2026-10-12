import { beforeEach, describe, expect, it } from 'vitest';
import type { FloorState } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;
let areaId: number;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
  areaId = (await manager.post('/api/v1/areas').send({ name: 'Salla' })).body.id;
});

const table = (overrides: Record<string, unknown> = {}) => ({
  areaId,
  name: '1',
  seats: 4,
  shape: 'square',
  x: 0,
  y: 0,
  w: 3,
  h: 3,
  ...overrides,
});

describe('areas & tables', () => {
  it('creates tables and returns them on the floor with status free', async () => {
    const res = await manager.post('/api/v1/tables').send(table());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: '1',
      status: 'free',
      session: null,
      needsCleaning: false,
    });
    const floor: FloorState = (await manager.get('/api/v1/floor')).body;
    expect(floor.areas.map((a) => a.name)).toEqual(['Salla']);
    expect(floor.tables).toHaveLength(1);
  });

  it('refuses overlapping tables in the same area, but allows them in another area', async () => {
    await manager.post('/api/v1/tables').send(table());
    const clash = await manager.post('/api/v1/tables').send(table({ name: '2', x: 2, y: 2 }));
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: 'TABLE_OVERLAP', details: { tableName: '1' } });

    const terrace = (await manager.post('/api/v1/areas').send({ name: 'Tarraca' })).body.id;
    await manager
      .post('/api/v1/tables')
      .send(table({ areaId: terrace, name: 'T1' }))
      .expect(201);
  });

  it('refuses tables outside the floor grid', async () => {
    const res = await manager.post('/api/v1/tables').send(table({ x: 46 }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].message).toBe('outsideFloor');
  });

  it('saves a whole layout at once and rejects one that overlaps', async () => {
    const a = (await manager.post('/api/v1/tables').send(table())).body.id;
    const b = (await manager.post('/api/v1/tables').send(table({ name: '2', x: 5 }))).body.id;
    const ok = await manager.post('/api/v1/tables/layout').send({
      areaId,
      tables: [
        { id: a, x: 10, y: 10, w: 3, h: 3, rotation: 45 },
        { id: b, x: 20, y: 10, w: 4, h: 4, rotation: 0 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.tables.find((t: { id: number }) => t.id === a)).toMatchObject({
      x: 10,
      y: 10,
      rotation: 45,
    });

    const bad = await manager.post('/api/v1/tables/layout').send({
      areaId,
      tables: [{ id: b, x: 11, y: 11, w: 3, h: 3, rotation: 0 }],
    });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('TABLE_OVERLAP');
  });

  it('cannot delete an area that still has tables, or a table with guests', async () => {
    const t = (await manager.post('/api/v1/tables').send(table())).body.id;
    expect((await manager.delete(`/api/v1/areas/${areaId}`)).body.error.code).toBe(
      'AREA_NOT_EMPTY',
    );
    await manager
      .post('/api/v1/table-sessions')
      .send({ uuid: crypto.randomUUID(), tableId: t, guestCount: 2 })
      .expect(201);
    expect((await manager.delete(`/api/v1/tables/${t}`)).body.error.code).toBe('TABLE_OCCUPIED');
  });

  it('only floor editors can change the layout', async () => {
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    await waiter.get('/api/v1/floor').expect(200);
    await waiter.post('/api/v1/tables').send(table()).expect(403);
    await waiter.post('/api/v1/areas').send({ name: 'VIP' }).expect(403);
  });
});

describe('QR codes', () => {
  it('returns an SVG QR pointing at the guest app, and rotation changes it', async () => {
    const t = (await manager.post('/api/v1/tables').send(table())).body.id;
    const qr = await manager.get(`/api/v1/tables/${t}/qr`);
    expect(qr.body.url).toMatch(/^http:\/\/localhost:5181\/t\/[A-Za-z0-9_-]{22}$/);
    expect(qr.body.svg).toMatch(/^<svg/);

    const svg = await manager.get(`/api/v1/tables/${t}/qr`).set('Accept', 'image/svg+xml');
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);

    const rotated = await manager.post(`/api/v1/tables/${t}/qr/rotate`);
    expect(rotated.body.url).not.toBe(qr.body.url);
    expect(await db('audit_logs').where({ action: 'table.qr_rotated' })).toHaveLength(1);
  });

  it('builds a printable sheet for an area', async () => {
    await manager.post('/api/v1/tables').send(table());
    await manager.post('/api/v1/tables').send(table({ name: '2', x: 5 }));
    const sheet = await manager.get(`/api/v1/areas/${areaId}/qr-sheet`);
    expect(sheet.body.map((q: { tableName: string }) => q.tableName)).toEqual(['1', '2']);
  });
});
