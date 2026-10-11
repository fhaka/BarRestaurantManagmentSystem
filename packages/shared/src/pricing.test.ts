import { describe, expect, it } from 'vitest';
import { applyRule, effectivePrice, type PriceRuleLike } from './pricing.js';

const TZ = 'Europe/Tirane';
const WEEKDAYS = 0b0011111; // Mon–Fri

const happyHour: PriceRuleLike = {
  id: 1,
  scope: 'category',
  scopeId: 10, // Birra
  type: 'percent',
  value: 2000, // 20% off
  weekdayMask: WEEKDAYS,
  timeFrom: '17:00',
  timeTo: '19:00',
  dateFrom: null,
  dateTo: null,
  active: true,
};

const korca = { itemId: 100, categoryIds: [10] };
const BEER = 25_000; // 250 L

// Wednesday 2026-07-15. Tirana is UTC+2 in July.
const wed = (localTime: string) => new Date(`2026-07-15T${localTime}:00+02:00`);

describe('applyRule', () => {
  it('percent off, rounded to whole lek', () => {
    expect(applyRule(BEER, { type: 'percent', value: 2000 })).toBe(20_000);
    expect(applyRule(18_000, { type: 'percent', value: 1500 })).toBe(15_300);
    // 333 L - 10% = 299.7 L → 300 L
    expect(applyRule(33_300, { type: 'percent', value: 1000 })).toBe(30_000);
  });

  it('fixed amount off, never below zero', () => {
    expect(applyRule(BEER, { type: 'fixed', value: 5_000 })).toBe(20_000);
    expect(applyRule(BEER, { type: 'fixed', value: 99_999 })).toBe(0);
  });
});

describe('effectivePrice — happy hour', () => {
  it('applies inside the window on a weekday', () => {
    expect(effectivePrice(BEER, korca, [happyHour], wed('17:00'), TZ)).toEqual({
      priceMinor: 20_000,
      ruleId: 1,
    });
    expect(effectivePrice(BEER, korca, [happyHour], wed('18:59'), TZ).priceMinor).toBe(20_000);
  });

  it('does not apply before, at the end, or after the window', () => {
    expect(effectivePrice(BEER, korca, [happyHour], wed('16:59'), TZ).priceMinor).toBe(BEER);
    expect(effectivePrice(BEER, korca, [happyHour], wed('19:00'), TZ).priceMinor).toBe(BEER);
  });

  it('uses Tirana time, not UTC', () => {
    // 15:30 UTC = 17:30 in Tirana → happy hour.
    expect(
      effectivePrice(BEER, korca, [happyHour], new Date('2026-07-15T15:30:00Z'), TZ).priceMinor,
    ).toBe(20_000);
  });

  it('does not apply on Saturday', () => {
    const sat = new Date('2026-07-18T17:30:00+02:00');
    expect(effectivePrice(BEER, korca, [happyHour], sat, TZ).priceMinor).toBe(BEER);
  });

  it('only applies to items in scope (including subcategories)', () => {
    const coffee = { itemId: 200, categoryIds: [20] };
    expect(effectivePrice(BEER, coffee, [happyHour], wed('17:30'), TZ).priceMinor).toBe(BEER);
    const craft = { itemId: 300, categoryIds: [11, 10] }; // subcategory of Birra
    expect(effectivePrice(BEER, craft, [happyHour], wed('17:30'), TZ).priceMinor).toBe(20_000);
  });

  it('ignores inactive rules and respects date ranges', () => {
    expect(
      effectivePrice(BEER, korca, [{ ...happyHour, active: false }], wed('17:30'), TZ).priceMinor,
    ).toBe(BEER);
    const summerOnly = { ...happyHour, dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    expect(effectivePrice(BEER, korca, [summerOnly], wed('17:30'), TZ).priceMinor).toBe(BEER);
  });

  it('picks the lowest price when rules overlap (no stacking)', () => {
    const itemDeal: PriceRuleLike = {
      ...happyHour,
      id: 2,
      scope: 'item',
      scopeId: 100,
      type: 'fixed',
      value: 10_000, // 100 L off → 150 L
    };
    expect(effectivePrice(BEER, korca, [happyHour, itemDeal], wed('17:30'), TZ)).toEqual({
      priceMinor: 15_000,
      ruleId: 2,
    });
  });
});
