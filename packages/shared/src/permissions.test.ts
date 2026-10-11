import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_KEYS, ROLE_PERMISSIONS, canGrantRole } from './permissions.js';

describe('role permission defaults', () => {
  it('owner has every permission', () => {
    expect(new Set(ROLE_PERMISSIONS.owner)).toEqual(new Set(PERMISSIONS));
  });

  it('manager has everything except account and location management', () => {
    expect(ROLE_PERMISSIONS.manager).not.toContain('account.manage');
    expect(ROLE_PERMISSIONS.manager).not.toContain('location.manage');
    expect(ROLE_PERMISSIONS.manager).toContain('staff.manage');
    expect(ROLE_PERMISSIONS.manager).toContain('approval.grant');
  });

  it('only owner and manager can grant approvals or manage staff', () => {
    for (const role of ROLE_KEYS) {
      const senior = role === 'owner' || role === 'manager';
      expect(ROLE_PERMISSIONS[role].includes('approval.grant')).toBe(senior);
      expect(ROLE_PERMISSIONS[role].includes('staff.manage')).toBe(senior);
    }
  });

  it('kitchen only works the KDS', () => {
    expect([...ROLE_PERMISSIONS.kitchen].sort()).toEqual(
      ['kds.bump', 'kds.view', 'menu.availability', 'time.clock'].sort(),
    );
  });

  it('every mapped permission exists', () => {
    for (const role of ROLE_KEYS) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });
});

describe('canGrantRole', () => {
  it('owner can grant any role', () => {
    for (const role of ROLE_KEYS) expect(canGrantRole(ROLE_PERMISSIONS.owner, role)).toBe(true);
  });

  it('manager can grant manager and below, but not owner', () => {
    const manager = new Set(ROLE_PERMISSIONS.manager);
    expect(canGrantRole(manager, 'owner')).toBe(false);
    expect(canGrantRole(manager, 'manager')).toBe(true);
    expect(canGrantRole(manager, 'waiter')).toBe(true);
    expect(canGrantRole(manager, 'kitchen')).toBe(true);
  });

  it('waiter cannot grant cashier (cashier has permissions waiters lack)', () => {
    expect(canGrantRole(ROLE_PERMISSIONS.waiter, 'cashier')).toBe(false);
  });
});
