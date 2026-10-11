import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RoleKey } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, PASSWORD, resetAndSeed, type Fixture } from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeed();
});

async function asRole(role: RoleKey) {
  return as(app, await login(app, fx.users[role].email), fx.locationId);
}

describe('permission denial', () => {
  it.each(['waiter', 'cashier', 'kitchen'] as const)('%s cannot list staff (403)', async (role) => {
    const res = await (await asRole(role)).get('/api/v1/staff');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.details.missing).toEqual(['staff.view']);
  });

  it.each(['waiter', 'cashier', 'kitchen'] as const)(
    '%s cannot create staff (403)',
    async (role) => {
      const res = await (
        await asRole(role)
      )
        .post('/api/v1/staff')
        .send({ name: 'Sneaky', roleKey: 'manager' });
      expect(res.status).toBe(403);
      expect(await db('users').where({ name: 'Sneaky' }).first()).toBeUndefined();
    },
  );

  it('requires X-Location-Id on location-scoped routes', async () => {
    const session = await login(app, fx.users.manager.email);
    const res = await as(app, session).get('/api/v1/staff');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
  });

  it('unknown routes still return 404, not 401', async () => {
    await request(app).get('/api/v1/nothing-here').expect(404);
  });
});

describe('staff management', () => {
  it('manager lists staff of the location', async () => {
    const res = await (await asRole('manager')).get('/api/v1/staff');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body[0]).toMatchObject({ roleKey: 'owner', hasPin: true, hasPassword: true });
    expect(res.body[0]).not.toHaveProperty('password_hash');
  });

  it('manager creates a waiter with a PIN, and it is audited', async () => {
    const res = await (
      await asRole('manager')
    )
      .post('/api/v1/staff')
      .send({ name: 'Ilir Gashi', roleKey: 'waiter', pin: '7777', email: '' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Ilir Gashi',
      roleKey: 'waiter',
      email: null,
      hasPin: true,
      hasPassword: false,
      active: true,
    });
    const audit = await db('audit_logs')
      .where({ action: 'staff.created', entity_id: String(res.body.id) })
      .first();
    expect(audit.user_id).toBe(fx.users.manager.id);
    expect(JSON.stringify(audit.after)).not.toContain('7777');
  });

  it('manager cannot create an owner (no privilege escalation)', async () => {
    const res = await (
      await asRole('manager')
    )
      .post('/api/v1/staff')
      .send({ name: 'New Boss', roleKey: 'owner' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_NOT_GRANTABLE');
  });

  it('manager cannot edit the owner', async () => {
    const res = await (
      await asRole('manager')
    )
      .patch(`/api/v1/staff/${fx.users.owner.id}`)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(403);
  });

  it('owner can promote a waiter to manager; the role change is audited separately', async () => {
    const res = await (
      await asRole('owner')
    )
      .patch(`/api/v1/staff/${fx.users.waiter.id}`)
      .send({ roleKey: 'manager' });
    expect(res.status).toBe(200);
    expect(res.body.roleKey).toBe('manager');
    const audit = await db('audit_logs').where({ action: 'staff.role_changed' }).first();
    expect(audit).toMatchObject({
      entity_id: String(fx.users.waiter.id),
      before: { roleKey: 'waiter' },
      after: { roleKey: 'manager' },
    });
  });

  it('nobody can change their own role or deactivate themselves', async () => {
    const owner = await asRole('owner');
    const role = await owner
      .patch(`/api/v1/staff/${fx.users.owner.id}`)
      .send({ roleKey: 'waiter' });
    expect(role.body.error.code).toBe('CANNOT_CHANGE_SELF');
    const off = await owner.patch(`/api/v1/staff/${fx.users.owner.id}`).send({ active: false });
    expect(off.body.error.code).toBe('CANNOT_CHANGE_SELF');
  });

  it('deactivating someone ends their sessions', async () => {
    const waiterSession = await login(app, fx.users.waiter.email);
    await (
      await asRole('manager')
    )
      .patch(`/api/v1/staff/${fx.users.waiter.id}`)
      .send({ active: false })
      .expect(200);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', waiterSession.cookie).expect(401);
  });

  it('rejects a duplicate email', async () => {
    const res = await (
      await asRole('manager')
    )
      .post('/api/v1/staff')
      .send({ name: 'Copy', roleKey: 'waiter', email: fx.users.cashier.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns field-level validation errors', async () => {
    const res = await (
      await asRole('manager')
    )
      .post('/api/v1/staff')
      .send({ name: 'A', roleKey: 'chef', pin: '12' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'roleKey', 'pin']));
  });

  it('setting a new PIN clears a lockout', async () => {
    await db('users')
      .where({ id: fx.users.waiter.id })
      .update({ pin_locked_until: new Date(Date.now() + 300_000) });
    const res = await (
      await asRole('manager')
    )
      .post(`/api/v1/staff/${fx.users.waiter.id}/credentials`)
      .send({ pin: '9090' });
    expect(res.status).toBe(200);
    expect(res.body.pinLocked).toBe(false);
  });

  it('resetting a password signs the person out elsewhere', async () => {
    const cashierSession = await login(app, fx.users.cashier.email);
    await (
      await asRole('manager')
    )
      .post(`/api/v1/staff/${fx.users.cashier.id}/credentials`)
      .send({ password: 'NewPassword1!' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cashierSession.cookie)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: fx.users.cashier.email, password: PASSWORD })
      .expect(401);
  });

  it('credentials need a password or a PIN', async () => {
    const res = await (
      await asRole('manager')
    )
      .post(`/api/v1/staff/${fx.users.waiter.id}/credentials`)
      .send({});
    expect(res.status).toBe(400);
  });
});
