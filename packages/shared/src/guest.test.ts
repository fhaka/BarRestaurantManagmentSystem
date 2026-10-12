import { describe, expect, it } from 'vitest';
import { canTransitionItem } from './orders.js';
import { GUEST_ORDERS_PER_MINUTE, guestOrderSchema, serviceRequestSchema } from './guest.js';

const UUID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

describe('guest ordering', () => {
  it('a guest line waits for a waiter, who sends it or turns it down', () => {
    expect(canTransitionItem('pending_confirmation', 'sent')).toBe(true);
    expect(canTransitionItem('pending_confirmation', 'voided')).toBe(true);
    expect(canTransitionItem('pending_confirmation', 'ready')).toBe(false);
  });

  it('business rule 8 limit is 5 orders a minute', () => {
    expect(GUEST_ORDERS_PER_MINUTE).toBe(5);
  });

  it('accepts 1–30 items and rejects an empty order', () => {
    expect(guestOrderSchema.safeParse({ items: [{ uuid: UUID, menuItemId: 1 }] }).success).toBe(
      true,
    );
    expect(guestOrderSchema.safeParse({ items: [] }).success).toBe(false);
    const many = Array.from({ length: 31 }, () => ({ uuid: UUID, menuItemId: 1 }));
    expect(guestOrderSchema.safeParse({ items: many }).success).toBe(false);
  });

  it('knows the three requests', () => {
    for (const type of ['call_waiter', 'bill_cash', 'bill_card']) {
      expect(serviceRequestSchema.safeParse({ type }).success).toBe(true);
    }
    expect(serviceRequestSchema.safeParse({ type: 'free_drinks' }).success).toBe(false);
  });
});
