import { describe, expect, it } from 'vitest';
import {
  canCloseSession,
  canTransitionSession,
  deriveTableStatus,
  rectInGrid,
  rectsOverlap,
  tableInputSchema,
  transferSchema,
} from './floor.js';

describe('table session state machine', () => {
  it.each([
    ['open', 'bill_requested', true],
    ['bill_requested', 'open', true],
    ['bill_requested', 'paid', true],
    ['paid', 'closed', true],
    ['closed', 'open', false],
    ['open', 'paid', false],
  ] as const)('%s → %s is %s', (from, to, ok) => {
    expect(canTransitionSession(from, to)).toBe(ok);
  });

  it('closes only with nothing owed (business rule 4)', () => {
    expect(canCloseSession('open', 0)).toBe(true);
    expect(canCloseSession('open', 1)).toBe(false);
    expect(canCloseSession('paid', 0)).toBe(true);
    expect(canCloseSession('closed', 0)).toBe(false);
  });
});

describe('deriveTableStatus', () => {
  it('free, needs cleaning, reserved without a session', () => {
    expect(deriveTableStatus({ needsCleaning: false, session: null })).toBe('free');
    expect(deriveTableStatus({ needsCleaning: true, session: null })).toBe('needs_cleaning');
    expect(deriveTableStatus({ needsCleaning: false, session: null, reservedSoon: true })).toBe(
      'reserved',
    );
  });

  it('session states win over cleaning', () => {
    expect(deriveTableStatus({ needsCleaning: true, session: { status: 'open' } })).toBe(
      'occupied',
    );
    expect(
      deriveTableStatus({ needsCleaning: false, session: { status: 'open', hasOrders: true } }),
    ).toBe('ordered');
    expect(
      deriveTableStatus({
        needsCleaning: false,
        session: { status: 'open', hasOrders: true, hasReadyItems: true },
      }),
    ).toBe('food_ready');
    expect(deriveTableStatus({ needsCleaning: false, session: { status: 'bill_requested' } })).toBe(
      'bill_requested',
    );
  });
});

describe('layout geometry', () => {
  it('detects overlap but allows touching edges', () => {
    const a = { x: 0, y: 0, w: 3, h: 3 };
    expect(rectsOverlap(a, { x: 2, y: 2, w: 3, h: 3 })).toBe(true);
    expect(rectsOverlap(a, { x: 3, y: 0, w: 3, h: 3 })).toBe(false);
  });

  it('keeps tables inside the 48×32 grid', () => {
    expect(rectInGrid({ x: 45, y: 29, w: 3, h: 3 })).toBe(true);
    expect(rectInGrid({ x: 46, y: 0, w: 3, h: 3 })).toBe(false);
    expect(
      tableInputSchema.safeParse({ areaId: 1, name: '1', x: 46, y: 0, w: 3, h: 3 }).success,
    ).toBe(false);
  });
});

describe('transferSchema', () => {
  it('needs exactly one target', () => {
    expect(transferSchema.safeParse({ toTableId: 1 }).success).toBe(true);
    expect(transferSchema.safeParse({ toWaiterId: 2 }).success).toBe(true);
    expect(transferSchema.safeParse({}).success).toBe(false);
    expect(transferSchema.safeParse({ toTableId: 1, toWaiterId: 2 }).success).toBe(false);
  });
});
