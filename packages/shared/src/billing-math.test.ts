import { describe, expect, it } from 'vitest';
import {
  allocate,
  billTax,
  changeDue,
  computeTotals,
  countDenominations,
  discountAmount,
  extractTax,
  splitByGroups,
  splitEqually,
} from './billing-math.js';

/*
 * Fixtures calculated by hand (Phase 6 "done when"). Amounts in minor units: 1 lek = 100.
 *
 * Table of four: 2× Kapuçino 180 L = 360 L, Tavë kosi 850 L, Birra Korça at happy hour
 * (250 L − 20% = 200 L). All at VAT 20%. Subtotal 1 410 L.
 */
const lines = [
  { id: 1, grossMinor: 36_000, taxRateBp: 2000 },
  { id: 2, grossMinor: 85_000, taxRateBp: 2000 },
  { id: 3, grossMinor: 20_000, taxRateBp: 2000 },
];

describe('computeTotals — hand-calculated fixtures', () => {
  it('A: no discounts, no service: VAT 20% extracted from 1 410 L', () => {
    const t = computeTotals({ lines, discounts: [], serviceChargeBp: 0 });
    // 141 000 × 2000 / 12 000 = 23 500 → VAT 235,00 L, net 1 175,00 L.
    expect(t).toMatchObject({
      subtotalMinor: 141_000,
      discountMinor: 0,
      serviceMinor: 0,
      totalMinor: 141_000,
      taxMinor: 23_500,
    });
    expect(t.tax).toEqual([
      { rateBp: 2000, grossMinor: 141_000, taxMinor: 23_500, netMinor: 117_500 },
    ]);
  });

  it('B: 10% off the tavë, 100 L off the bill, 10% service', () => {
    const t = computeTotals({
      lines,
      discounts: [
        { orderItemId: 2, type: 'percent', value: 1000 },
        { orderItemId: null, type: 'fixed', value: 10_000 },
      ],
      serviceChargeBp: 1000,
    });
    // Item: 850 × 10% = 85 L → 1 325 L. Bill: −100 L → 1 225 L.
    // Service: 10% of 1 225 = 122,5 → rounds half up to 123 L. Total 1 348 L.
    expect(t.itemDiscountMinor).toBe(8_500);
    expect(t.orderDiscountMinor).toBe(10_000);
    expect(t.serviceMinor).toBe(12_300);
    expect(t.totalMinor).toBe(134_800);
    // The 100 L bill discount over 360 / 765 / 200 L (sum 1 325):
    // 27.17 / 57.74 / 15.09 → largest remainders give 2 717, 5 774, 1 509 qindarka.
    expect(t.lines.map((l) => l.orderDiscountMinor)).toEqual([2_717, 5_774, 1_509]);
    // VAT: 134 800 × 2000 / 12 000 = 22 466,67 → 22 467.
    expect(t.taxMinor).toBe(22_467);
    expect(t.lines.reduce((s, l) => s + l.finalMinor, 0)).toBe(134_800);
  });

  it('C: two VAT rates are extracted separately', () => {
    const t = computeTotals({
      lines: [
        { id: 1, grossMinor: 100_000, taxRateBp: 2000 },
        { id: 2, grossMinor: 50_000, taxRateBp: 600 },
      ],
      discounts: [],
      serviceChargeBp: 0,
    });
    // 20%: 100 000 × 2000 / 12 000 = 16 666,67 → 16 667. 6%: 50 000 × 600 / 10 600 = 2 830,19 → 2 830.
    expect(t.tax).toEqual([
      { rateBp: 2000, grossMinor: 100_000, taxMinor: 16_667, netMinor: 83_333 },
      { rateBp: 600, grossMinor: 50_000, taxMinor: 2_830, netMinor: 47_170 },
    ]);
    expect(t.taxMinor).toBe(19_497);
  });

  it('D: percent bill discount and a discount larger than the line', () => {
    const t = computeTotals({
      lines,
      discounts: [
        { orderItemId: 3, type: 'fixed', value: 50_000 }, // capped at the beer's 200 L
        { orderItemId: null, type: 'percent', value: 1500 }, // 15% of 1 210 = 181,5 → 182 L
      ],
      serviceChargeBp: 0,
    });
    expect(t.itemDiscountMinor).toBe(20_000);
    expect(t.orderDiscountMinor).toBe(18_200);
    expect(t.totalMinor).toBe(102_800);
  });
});

describe('splits', () => {
  it('equal split of 1 348 L by 3 → 450 + 449 + 449', () => {
    expect(splitEqually(134_800, 3)).toEqual([45_000, 44_900, 44_900]);
  });

  it('by groups: whole lek bills that add up to the total', () => {
    // Fixture B lines finals grouped: seat 1 has line 1, seat 2 has lines 2 + 3.
    const t = computeTotals({
      lines,
      discounts: [{ orderItemId: null, type: 'fixed', value: 10_000 }],
      serviceChargeBp: 0,
    });
    const seat1 = t.lines[0]!.finalMinor;
    const seat2 = t.lines[1]!.finalMinor + t.lines[2]!.finalMinor;
    const bills = splitByGroups(t.totalMinor, [seat1, seat2]);
    expect(bills.reduce((a, b) => a + b, 0)).toBe(t.totalMinor);
    expect(bills.every((b) => b % 100 === 0)).toBe(true);
  });

  it('VAT of one bill follows its own mix of rates', () => {
    const tax = billTax(45_000, [
      { rateBp: 2000, amount: 100_000 },
      { rateBp: 600, amount: 50_000 },
    ]);
    // 450 L split 2:1 → 300 L at 20% (50,00 VAT) and 150 L at 6% (8,49 VAT).
    expect(tax).toEqual([
      { rateBp: 2000, grossMinor: 30_000, taxMinor: 5_000, netMinor: 25_000 },
      { rateBp: 600, grossMinor: 15_000, taxMinor: 849, netMinor: 14_151 },
    ]);
  });
});

describe('helpers', () => {
  it('allocate keeps the exact sum', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(300, [0, 0, 0], 100)).toEqual([100, 100, 100]);
  });

  it('discounts are whole lek and never exceed the base', () => {
    expect(discountAmount(85_000, 'percent', 1000)).toBe(8_500);
    expect(discountAmount(18_000, 'percent', 333)).toBe(600); // 59,94 → 60 L
    expect(discountAmount(10_000, 'fixed', 99_999)).toBe(10_000);
  });

  it('tax extraction', () => {
    expect(extractTax(120_000, 2000)).toBe(20_000);
    expect(extractTax(0, 2000)).toBe(0);
  });

  it('cash change and counting', () => {
    expect(changeDue(200_000, 134_800)).toBe(65_200);
    expect(changeDue(100_000, 134_800)).toBe(0);
    expect(countDenominations({ 5000: 2, 1000: 3, 100: 4, 1: 7 })).toBe(1_340_700);
  });
});
