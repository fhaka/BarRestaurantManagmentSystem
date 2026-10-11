import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { db } from '../../db/knex.js';
import { as, login, PINS, resetAndSeed, type Fixture } from '../../test/fixtures.js';
import { consumeApproval } from './service.js';

const app = createApp();
let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeed();
});

async function requestApproval(approverId: number, pin: string, entityId = '42') {
  const waiter = as(app, await login(app, fx.users.waiter.email), fx.locationId);
  return waiter.post('/api/v1/approvals').send({
    approverId,
    pin,
    action: 'order_item.void',
    entityType: 'order_item',
    entityId,
  });
}

const match = (token: string | undefined, overrides: Partial<{ entityId: string }> = {}) => ({
  token,
  locationId: fx.locationId,
  action: 'order_item.void' as const,
  entityType: 'order_item',
  entityId: '42',
  ...overrides,
});

describe('POST /approvals', () => {
  it('manager PIN returns a 60-second single-use token, logged with both users', async () => {
    const res = await requestApproval(fx.users.manager.id, PINS.manager);
    expect(res.status).toBe(201);
    expect(res.body.approverId).toBe(fx.users.manager.id);
    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);

    const audit = await db('audit_logs').where({ action: 'approval.granted' }).first();
    expect(audit).toMatchObject({
      user_id: fx.users.waiter.id,
      approved_by: fx.users.manager.id,
      entity_id: '42',
    });
  });

  it('a cashier cannot approve, even with the right PIN', async () => {
    const res = await requestApproval(fx.users.cashier.id, PINS.cashier);
    expect(res.status).toBe(403);
  });

  it('wrong manager PIN counts towards the lockout', async () => {
    const res = await requestApproval(fx.users.manager.id, '0000');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_PIN');
    const manager = await db('users').where({ id: fx.users.manager.id }).first();
    expect(manager.pin_failed_attempts).toBe(1);
  });
});

describe('consumeApproval', () => {
  it('returns the approver once, then rejects reuse', async () => {
    const { body } = await requestApproval(fx.users.manager.id, PINS.manager);
    expect(await consumeApproval(db, match(body.approvalToken))).toBe(fx.users.manager.id);
    await expect(consumeApproval(db, match(body.approvalToken))).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    });
  });

  it('is bound to the entity it was granted for', async () => {
    const { body } = await requestApproval(fx.users.manager.id, PINS.manager);
    await expect(
      consumeApproval(db, match(body.approvalToken, { entityId: '43' })),
    ).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
  });

  it('expires after 60 seconds', async () => {
    const { body } = await requestApproval(fx.users.manager.id, PINS.manager);
    await db('approvals').update({ expires_at: new Date(Date.now() - 1000) });
    await expect(consumeApproval(db, match(body.approvalToken))).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    });
  });

  it('requires a token', async () => {
    await expect(consumeApproval(db, match(undefined))).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    });
  });
});
