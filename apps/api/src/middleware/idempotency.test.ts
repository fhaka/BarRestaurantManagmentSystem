import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/knex.js';
import { as, login, resetAndSeed, type Fixture } from '../test/fixtures.js';

const app = createApp();
let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeed();
});

describe('Idempotency-Key', () => {
  it('replays the first response and does not create a duplicate', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const body = { name: 'Replay Waiter', roleKey: 'waiter' };

    const first = await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'key-abc-123')
      .send(body);
    const second = await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'key-abc-123')
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await db('users').where({ name: 'Replay Waiter' })).toHaveLength(1);
  });

  it('rejects the same key with a different body', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'key-xyz-789')
      .send({ name: 'One', roleKey: 'waiter' })
      .expect(201);
    const res = await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'key-xyz-789')
      .send({ name: 'Two', roleKey: 'waiter' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('keys are scoped per user', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const owner = as(app, await login(app, fx.users.owner.email), fx.locationId);
    await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'shared-key-1')
      .send({ name: 'By Manager', roleKey: 'waiter' })
      .expect(201);
    await owner
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'shared-key-1')
      .send({ name: 'By Owner', roleKey: 'waiter' })
      .expect(201);
  });

  it('also replays error responses (deterministic 4xx)', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const body = { name: 'Boss', roleKey: 'owner' };
    const first = await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'err-key-01')
      .send(body);
    const second = await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'err-key-01')
      .send(body);
    expect(first.status).toBe(403);
    expect(second.status).toBe(403);
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects malformed keys', async () => {
    const manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
    const res = await manager
      .post('/api/v1/staff')
      .set('Idempotency-Key', 'bad key!')
      .send({ name: 'X Y', roleKey: 'waiter' });
    expect(res.status).toBe(400);
  });
});
