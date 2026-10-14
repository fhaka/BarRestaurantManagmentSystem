import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditLogPage } from '@tavolina/shared';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import {
  as,
  createLocation,
  login,
  PASSWORD,
  resetAndSeed,
  type Fixture,
} from '../../test/fixtures.js';

const app = createApp();
let fx: Fixture;
let manager: ReturnType<typeof as>;

beforeEach(async () => {
  fx = await resetAndSeed();
  manager = as(app, await login(app, fx.users.manager.email), fx.locationId);
});

describe('audit log (plan §5.14)', () => {
  it('records sign-ins and failed passwords, and the viewer lists them newest first', async () => {
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: fx.users.waiter.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    await login(app, fx.users.waiter.email, PASSWORD);

    const page: AuditLogPage = (await manager.get('/api/v1/audit-logs?action=auth.')).body;
    expect(page.rows.map((r) => [r.action, r.userName])).toEqual([
      ['auth.login', 'Test waiter'],
      ['auth.login_failed', 'Test waiter'],
      ['auth.login', 'Test manager'],
    ]);
    // The password is never stored.
    expect(JSON.stringify(page)).not.toContain('wrong-password');
    expect(page.rows[0]).toMatchObject({
      entityType: 'user',
      entityId: String(fx.users.waiter.id),
      ip: expect.any(String),
    });
  });

  it('filters by action, person, approval and entity; pages with a cursor', async () => {
    // Twelve price changes by the manager, one of them on a single item to look up.
    const categoryId = (await manager.post('/api/v1/menu/categories').send({ name: 'Pije' })).body
      .id;
    const itemId = (
      await manager
        .post('/api/v1/menu/items')
        .send({ categoryId, stationId: null, name: 'Kafe', priceMinor: 10_000 })
    ).body.id;
    for (let i = 1; i <= 12; i++) {
      await manager
        .patch(`/api/v1/menu/items/${itemId}`)
        .send({ priceMinor: 10_000 + i * 1_000 })
        .expect(200);
    }
    const first: AuditLogPage = (
      await manager.get('/api/v1/audit-logs?action=menu.price_changed&limit=5')
    ).body;
    expect(first.rows).toHaveLength(5);
    expect(first.rows[0]!.after).toMatchObject({ priceMinor: 22_000 });
    expect(first.rows[0]!.before).toMatchObject({ priceMinor: 21_000 });
    const second: AuditLogPage = (
      await manager.get(
        `/api/v1/audit-logs?action=menu.price_changed&limit=5&before=${first.nextCursor}`,
      )
    ).body;
    expect(second.rows[0]!.id).toBeLessThan(first.rows.at(-1)!.id);
    const last: AuditLogPage = (
      await manager.get(
        `/api/v1/audit-logs?action=menu.price_changed&limit=5&before=${second.nextCursor}`,
      )
    ).body;
    expect(last.rows).toHaveLength(2);
    expect(last.nextCursor).toBeNull();

    const byEntity: AuditLogPage = (
      await manager.get(`/api/v1/audit-logs?entityType=menu_item&entityId=${itemId}&limit=200`)
    ).body;
    expect(byEntity.rows.every((r) => r.entityId === String(itemId))).toBe(true);
    const byUser: AuditLogPage = (
      await manager.get(`/api/v1/audit-logs?userId=${fx.users.waiter.id}`)
    ).body;
    expect(byUser.rows).toEqual([]);
    const approved: AuditLogPage = (await manager.get('/api/v1/audit-logs?approved=true')).body;
    expect(approved.rows).toEqual([]);

    const facets = (await manager.get('/api/v1/audit-logs/facets')).body;
    expect(facets.actions).toContain('menu.price_changed');
    expect(facets.users).toContainEqual({ id: fx.users.manager.id, name: 'Test manager' });
  });

  it('is read-only, needs audit.view and never shows another location', async () => {
    const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
    expect((await waiter.get('/api/v1/audit-logs')).status).toBe(403);
    const row = await db('audit_logs').first('id');
    expect((await manager.delete(`/api/v1/audit-logs/${row.id}`)).status).toBe(404);
    expect((await manager.patch(`/api/v1/audit-logs/${row.id}`).send({ action: 'x' })).status).toBe(
      404,
    );

    // A row of another location of the account stays there.
    const other = await createLocation(fx.accountId, 'Las Vegas Durrës');
    await db('audit_logs').insert({
      account_id: fx.accountId,
      location_id: other,
      user_id: fx.users.manager.id,
      action: 'test.elsewhere',
      entity_type: 'test',
    });
    const page: AuditLogPage = (await manager.get('/api/v1/audit-logs?action=test.elsewhere')).body;
    expect(page.rows).toEqual([]);
  });
});
