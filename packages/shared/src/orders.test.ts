import { describe, expect, it } from 'vitest';
import {
  ORDER_ITEM_STATUSES,
  businessDate,
  canTransitionItem,
  checkModifierSelection,
  createOrderSchema,
  lineTotal,
  newOrderItemSchema,
  type OrderItemStatus,
} from './orders.js';

describe('order item state machine (every transition)', () => {
  const allowed: Record<OrderItemStatus, OrderItemStatus[]> = {
    draft: ['sent'],
    pending_confirmation: ['sent'],
    sent: ['preparing', 'ready', 'voided'],
    preparing: ['ready', 'voided'],
    ready: ['served', 'preparing', 'voided'],
    served: [],
    voided: [],
  };
  for (const from of ORDER_ITEM_STATUSES) {
    for (const to of ORDER_ITEM_STATUSES) {
      const expected = allowed[from].includes(to);
      it(`${from} → ${to}: ${expected ? 'allowed' : 'rejected'}`, () => {
        expect(canTransitionItem(from, to)).toBe(expected);
      });
    }
  }
});

describe('lineTotal (business rule 2)', () => {
  it('adds modifiers to the unit price and multiplies by quantity', () => {
    expect(lineTotal(18_000, [5_000, 0], 2)).toBe(46_000);
  });

  it('rounds each line to whole lek', () => {
    expect(lineTotal(12_345, [], 1)).toBe(12_300);
    expect(lineTotal(12_350, [], 1)).toBe(12_400);
  });

  it('handles negative modifier deltas', () => {
    expect(lineTotal(65_000, [-5_000], 1)).toBe(60_000);
  });
});

describe('businessDate', () => {
  const TZ = 'Europe/Tirane';
  it('counts a 01:30 order as the previous business day', () => {
    // 2026-07-16 01:30 in Tirana
    expect(businessDate(new Date('2026-07-15T23:30:00Z'), TZ)).toBe('2026-07-15');
  });
  it('starts a new day at 04:00 local', () => {
    expect(businessDate(new Date('2026-07-16T01:59:00Z'), TZ)).toBe('2026-07-15'); // 03:59
    expect(businessDate(new Date('2026-07-16T02:00:00Z'), TZ)).toBe('2026-07-16'); // 04:00
  });
});

describe('checkModifierSelection', () => {
  const milk = {
    id: 1,
    name: 'Milk',
    minSelect: 1,
    maxSelect: 1,
    required: true,
    modifierIds: [10, 11],
  };
  const extras = {
    id: 2,
    name: 'Extras',
    minSelect: 0,
    maxSelect: 2,
    required: false,
    modifierIds: [20, 21, 22],
  };

  it('accepts a valid selection', () => {
    expect(checkModifierSelection([milk, extras], [10, 20])).toEqual([]);
  });

  it('reports a missing required choice, too many, and unknown ids', () => {
    expect(checkModifierSelection([milk, extras], [20, 21, 22, 99])).toEqual([
      { code: 'unknownModifier', modifierId: 99 },
      { code: 'tooFew', groupId: 1, groupName: 'Milk', min: 1 },
      { code: 'tooMany', groupId: 2, groupName: 'Extras', max: 2 },
    ]);
  });
});

describe('schemas', () => {
  it('dine-in orders need a table session; others must not have one', () => {
    const uuid = '7d9f2c1e-4b8a-4e2d-9c3f-1a2b3c4d5e6f';
    expect(createOrderSchema.safeParse({ uuid, type: 'dine_in' }).success).toBe(false);
    expect(createOrderSchema.safeParse({ uuid, type: 'dine_in', tableSessionRef: 5 }).success).toBe(
      true,
    );
    expect(
      createOrderSchema.safeParse({ uuid, type: 'takeaway', customerName: 'Arta' }).success,
    ).toBe(true);
    expect(createOrderSchema.safeParse({ uuid, type: 'delivery' }).success).toBe(false);
  });

  it('an order line is either a menu item or a combo', () => {
    const uuid = '7d9f2c1e-4b8a-4e2d-9c3f-1a2b3c4d5e6f';
    expect(newOrderItemSchema.safeParse({ uuid, menuItemId: 1 }).success).toBe(true);
    expect(newOrderItemSchema.safeParse({ uuid, comboId: 1 }).success).toBe(true);
    expect(newOrderItemSchema.safeParse({ uuid }).success).toBe(false);
    expect(newOrderItemSchema.safeParse({ uuid, menuItemId: 1, comboId: 1 }).success).toBe(false);
  });
});
