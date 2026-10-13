import { describe, expect, it } from 'vitest';
import {
  consumption,
  countVariance,
  fromMilli,
  margin,
  recipeCost,
  stockValue,
  toMilli,
  weightedAverageCost,
} from './inventory-math.js';

describe('quantities in thousandths', () => {
  it('parses database decimals and form input exactly', () => {
    expect(toMilli('12.500')).toBe(12_500);
    expect(toMilli('0.018')).toBe(18);
    expect(toMilli('0,25')).toBe(250);
    expect(toMilli('-1.2')).toBe(-1_200);
    expect(toMilli('0.0185')).toBe(19);
    expect(toMilli(0.1 + 0.2)).toBe(300);
    expect(toMilli('abc')).toBeNaN();
    expect(fromMilli(18)).toBe('0.018');
    expect(fromMilli(-1_200)).toBe('-1.200');
  });

  it('ten cappuccinos use exactly 180 g of coffee and 1.5 l of milk (no float drift)', () => {
    let coffee = toMilli('2.000');
    let milk = toMilli('10.000');
    for (let i = 0; i < 10; i++) {
      coffee -= 18;
      milk -= 150;
    }
    expect(fromMilli(coffee)).toBe('1.820');
    expect(fromMilli(milk)).toBe('8.500');
  });
});

describe('recipes', () => {
  const COFFEE = 1;
  const MILK = 2;
  const SMALL = 10;
  const LARGE = 11;
  const lines = [
    { ingredientId: COFFEE, qtyMilli: 18, variantId: null },
    { ingredientId: MILK, qtyMilli: 150, variantId: null },
    { ingredientId: MILK, qtyMilli: 250, variantId: LARGE },
  ];

  it('uses the size-specific line instead of the general one', () => {
    expect([...consumption(2, lines, SMALL, [])]).toEqual([
      [COFFEE, 36],
      [MILK, 300],
    ]);
    expect([...consumption(1, lines, LARGE, [])]).toEqual([
      [COFFEE, 18],
      [MILK, 250],
    ]);
  });

  it('adds the options (an extra shot)', () => {
    const shot = [{ ingredientId: COFFEE, qtyMilli: 9, variantId: null }];
    expect(consumption(3, lines, null, shot).get(COFFEE)).toBe(3 * 18 + 3 * 9);
  });

  it('food cost and margin on the price without VAT', () => {
    // 18 g coffee at 2 500 L/kg = 45 L; 150 ml milk at 120 L/l = 18 L.
    const cost = recipeCost([
      { qtyMilli: 18, costPerUnitMinor: 250_000 },
      { qtyMilli: 150, costPerUnitMinor: 12_000 },
    ]);
    expect(cost).toBe(6_300);
    // 180 L incl. 20% VAT = 150 L net; margin 87 L = 58%.
    expect(margin(18_000, 2000, cost)).toEqual({
      netMinor: 15_000,
      marginMinor: 8_700,
      marginBp: 5800,
    });
  });
});

describe('purchases and counts', () => {
  it('weighted average cost when receiving', () => {
    // 2 kg at 2 400 L + 3 kg at 2 600 L → 2 520 L/kg
    expect(weightedAverageCost(2_000, 240_000, 3_000, 260_000)).toBe(252_000);
    // Negative stock counts as none.
    expect(weightedAverageCost(-500, 240_000, 1_000, 260_000)).toBe(260_000);
  });

  it('variance in quantity and lek', () => {
    // Expected 8.5 l milk, counted 8.2 l at 120 L/l → −0.3 l = −36 L
    expect(countVariance(8_500, 8_200, 12_000)).toEqual({
      varianceMilli: -300,
      varianceMinor: -3_600,
    });
    expect(stockValue(1_820, 250_000)).toBe(455_000);
  });
});
