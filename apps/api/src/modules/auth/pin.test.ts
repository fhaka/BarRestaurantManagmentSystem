import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PIN_MAX_ATTEMPTS } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import {
  login,
  PINS,
  refreshCookie,
  resetAndSeed,
  type Fixture,
  type Session,
} from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let device: Session;

beforeEach(async () => {
  fx = await resetAndSeed();
  // A manager signs the device in; staff then switch with PINs.
  device = await login(app, fx.users.manager.email);
});

function pin(userId: number, value: string, cookie = device.cookie) {
  return request(app)
    .post('/api/v1/auth/pin')
    .set('Cookie', cookie)
    .send({ userId, pin: value, locationId: fx.locationId });
}

describe('GET /auth/pin-users', () => {
  it('lists staff with a PIN at the location, most senior first', async () => {
    const res = await request(app)
      .get('/api/v1/auth/pin-users')
      .query({ locationId: fx.locationId })
      .set('Cookie', device.cookie);
    expect(res.status).toBe(200);
    expect(res.body.map((u: { roleKey: string }) => u.roleKey)).toEqual([
      'owner',
      'manager',
      'cashier',
      'waiter',
      'kitchen',
    ]);
  });

  it('requires a device session', async () => {
    const res = await request(app)
      .get('/api/v1/auth/pin-users')
      .query({ locationId: fx.locationId });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/pin', () => {
  it('switches the device session to the PIN owner', async () => {
    const res = await pin(fx.users.waiter.id, PINS.waiter);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(fx.users.waiter.id);

    // The old device cookie is revoked; the new one belongs to the waiter.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', device.cookie).expect(401);
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(res));
    expect(refreshed.body.user.id).toBe(fx.users.waiter.id);

    const audit = await db('audit_logs').where({ action: 'auth.pin_switch' }).first();
    expect(audit).toMatchObject({ user_id: fx.users.waiter.id, location_id: fx.locationId });
  });

  it('rejects a wrong PIN and reports attempts left', async () => {
    const res = await pin(fx.users.waiter.id, '0000');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_PIN');
    expect(res.body.error.details.attemptsLeft).toBe(PIN_MAX_ATTEMPTS - 1);
  });

  it(`locks the PIN after ${PIN_MAX_ATTEMPTS} wrong tries, even for the right PIN`, async () => {
    for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
      const res = await pin(fx.users.waiter.id, '0000');
      expect(res.status).toBe(401);
      expect(res.body.error.details.attemptsLeft).toBe(PIN_MAX_ATTEMPTS - i);
    }
    const locking = await pin(fx.users.waiter.id, '0000');
    expect(locking.status).toBe(423);
    expect(locking.body.error.code).toBe('PIN_LOCKED');
    const lockedUntil = new Date(locking.body.error.details.lockedUntil).getTime();
    expect(lockedUntil - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(lockedUntil - Date.now()).toBeLessThanOrEqual(5 * 60_000);

    const correct = await pin(fx.users.waiter.id, PINS.waiter);
    expect(correct.status).toBe(423);

    // Other people are not affected.
    await pin(fx.users.cashier.id, PINS.cashier).expect(200);
  });

  it('unlocks after the lock expires and resets the counter on success', async () => {
    await db('users')
      .where({ id: fx.users.waiter.id })
      .update({ pin_locked_until: new Date(Date.now() - 1000), pin_failed_attempts: 0 });
    await pin(fx.users.waiter.id, PINS.waiter).expect(200);
    const user = await db('users').where({ id: fx.users.waiter.id }).first();
    expect(user.pin_locked_until).toBeNull();
  });

  it('a successful PIN resets the failure counter', async () => {
    await pin(fx.users.waiter.id, '0000').expect(401);
    await pin(fx.users.waiter.id, '0000').expect(401);
    const ok = await pin(fx.users.waiter.id, PINS.waiter);
    expect(ok.status).toBe(200);
    const user = await db('users').where({ id: fx.users.waiter.id }).first();
    expect(user.pin_failed_attempts).toBe(0);
  });

  it('refuses staff who do not work at the location', async () => {
    const [otherUser] = await db('users').insert({
      account_id: fx.accountId,
      name: 'No access',
      pin_hash: (await db('users').where({ id: fx.users.waiter.id }).first()).pin_hash,
    });
    const res = await pin(otherUser!, PINS.waiter);
    expect(res.status).toBe(403);
  });

  it('requires a device session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/pin')
      .send({ userId: fx.users.waiter.id, pin: PINS.waiter, locationId: fx.locationId });
    expect(res.status).toBe(401);
  });

  it('validates the PIN format', async () => {
    const res = await pin(fx.users.waiter.id, '12');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
