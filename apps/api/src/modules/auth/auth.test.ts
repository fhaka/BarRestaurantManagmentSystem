import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ROLE_PERMISSIONS } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import {
  as,
  createLocation,
  login,
  PASSWORD,
  refreshCookie,
  resetAndSeed,
  type Fixture,
} from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeed();
});

describe('POST /auth/login', () => {
  it('returns an access token, the user with locations, and an httpOnly refresh cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'MANAGER@test.test', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user).toMatchObject({
      id: fx.users.manager.id,
      locations: [{ id: fx.locationId, roleKey: 'manager' }],
    });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/tav_rt=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('registers the device when one is sent', async () => {
    const uuid = randomUUID();
    await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: fx.users.waiter.email,
        password: PASSWORD,
        device: { uuid, name: 'Tablet 1' },
      })
      .expect(200);
    const device = await db('devices').where({ uuid }).first();
    expect(device).toMatchObject({ name: 'Tablet 1', account_id: fx.accountId });
  });

  it('rejects a wrong password with a generic error', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: fx.users.owner.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives the same error for an unknown email (no account enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.test', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects deactivated users', async () => {
    await db('users').where({ id: fx.users.cashier.id }).update({ active: false });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: fx.users.cashier.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const session = await login(app, fx.users.owner.email);
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    const next = refreshCookie(res);
    expect(next).toMatch(/^tav_rt=/);
    expect(next).not.toBe(session.cookie);

    // The new token works.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', next).expect(200);
  });

  it('treats reuse of an old token after the grace window as theft and revokes the family', async () => {
    const session = await login(app, fx.users.owner.email);
    const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie);
    const current = refreshCookie(first);

    // Age the rotation beyond the grace window.
    await db('refresh_tokens')
      .where({ revoked_reason: 'rotated' })
      .update({ revoked_at: new Date(Date.now() - 60_000) });

    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('SESSION_EXPIRED');

    // The legitimate latest token is now revoked too.
    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', current);
    expect(after.status).toBe(401);
  });

  it('asks the client to retry when two tabs race to rotate the same token', async () => {
    const session = await login(app, fx.users.owner.email);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
    const race = await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie);
    expect(race.status).toBe(401);
    expect(race.body.error.details).toEqual({ retry: true });
  });

  it('fails without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('ends the session when the user is deactivated', async () => {
    const session = await login(app, fx.users.waiter.email);
    await db('users').where({ id: fx.users.waiter.id }).update({ active: false });
    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token', async () => {
    const session = await login(app, fx.users.owner.email);
    await request(app).post('/api/v1/auth/logout').set('Cookie', session.cookie).expect(204);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
  });
});

describe('access token & location scope', () => {
  it('GET /me without a token is 401', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered token', async () => {
    const session = await login(app, fx.users.owner.email);
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.token.slice(0, -2)}xx`);
    expect(res.status).toBe(401);
  });

  it('GET /me returns permissions for the selected location', async () => {
    const session = await login(app, fx.users.waiter.email);
    const res = await as(app, session, fx.locationId).get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body.location.roleKey).toBe('waiter');
    expect([...res.body.location.permissions].sort()).toEqual([...ROLE_PERMISSIONS.waiter].sort());
  });

  it('GET /me without a location returns no permissions', async () => {
    const session = await login(app, fx.users.waiter.email);
    const res = await as(app, session).get('/api/v1/me');
    expect(res.body.location).toBeNull();
  });

  it('refuses a location the user has no access to', async () => {
    const otherLocation = await createLocation(fx.accountId, 'Other branch');
    const session = await login(app, fx.users.manager.email);
    const res = await as(app, session, otherLocation).get('/api/v1/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
  });

  it('refuses a location from another account', async () => {
    const [otherAccount] = await db('owners_accounts').insert({ company_name: 'Elsewhere' });
    const foreign = await createLocation(otherAccount!, 'Foreign');
    const session = await login(app, fx.users.owner.email);
    const res = await as(app, session, foreign).get('/api/v1/staff');
    expect(res.status).toBe(403);
  });

  it('a deactivated user loses access immediately, even with a valid token', async () => {
    const session = await login(app, fx.users.manager.email);
    await db('users').where({ id: fx.users.manager.id }).update({ active: false });
    await as(app, session, fx.locationId).get('/api/v1/me').expect(401);
  });
});
