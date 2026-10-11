import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeed();
});

describe('locations', () => {
  it('owner creates a location and gets owner access to it', async () => {
    const owner = as(app, await login(app, fx.users.owner.email), fx.locationId);
    const res = await owner
      .post('/api/v1/locations')
      .send({ name: 'Las Vegas Durrës', address: 'Shëtitorja, Durrës', nipt: 'l12345678b' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Las Vegas Durrës',
      nipt: 'L12345678B',
      timezone: 'Europe/Tirane',
      currency: 'ALL',
    });
    expect(res.body.settings.guestOrdersRequireConfirmation).toBe(true);

    const list = await owner.get('/api/v1/locations');
    expect(list.body.map((l: { name: string }) => l.name)).toEqual([
      'Las Vegas Durrës',
      'Test Bar Tirana',
    ]);
    // The manager of the first location does not get the new one automatically.
    const manager = as(app, await login(app, fx.users.manager.email));
    expect((await manager.get('/api/v1/locations')).body).toHaveLength(1);
  });

  it('manager cannot create locations', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const res = await manager.post('/api/v1/locations').send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('manager edits settings of the current location; keys are merged and audited', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const res = await manager
      .patch(`/api/v1/locations/${fx.locationId}`)
      .send({ settings: { serviceChargeBp: 1000 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.serviceChargeBp).toBe(1000);
    expect(res.body.settings.defaultLang).toBe('sq');
    expect(await db('audit_logs').where({ action: 'location.updated' }).first()).toBeTruthy();
  });

  it('rejects invalid settings with field errors', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const res = await manager
      .patch(`/api/v1/locations/${fx.locationId}`)
      .send({ settings: { serviceChargeBp: -5 }, nipt: '123' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['settings.serviceChargeBp', 'nipt']));
  });

  it('waiter cannot edit settings', async () => {
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    const res = await waiter.patch(`/api/v1/locations/${fx.locationId}`).send({ name: 'Mine' });
    expect(res.status).toBe(403);
  });

  it('GET /locations/current returns settings for any member', async () => {
    const kitchen = as(app, await login(app, fx.users.kitchen.email), fx.locationId);
    const res = await kitchen.get('/api/v1/locations/current');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(fx.locationId);
  });
});
