import { describe, expect, it } from 'vitest';
import { formatMoney, lekToMinor, minorToLek, roundToLek } from './money.js';

const nb = (s: string) => s.replace(/ /g, ' ');

describe('lekToMinor / minorToLek', () => {
  it('converts lek to integer minor units without float drift', () => {
    expect(lekToMinor(1200)).toBe(120_000);
    expect(lekToMinor(0.1 + 0.2)).toBe(30);
    expect(lekToMinor(19.99)).toBe(1999);
  });

  it('round-trips', () => {
    expect(minorToLek(lekToMinor(345))).toBe(345);
  });

  it('rejects non-integer minor amounts', () => {
    expect(() => minorToLek(10.5)).toThrow(TypeError);
  });

  it('rejects non-finite lek amounts', () => {
    expect(() => lekToMinor(Number.NaN)).toThrow(TypeError);
  });
});

describe('roundToLek', () => {
  it.each([
    [12_345, 12_300],
    [12_349, 12_300],
    [12_350, 12_400],
    [12_399, 12_400],
    [0, 0],
    [-150, -200],
    [-149, -100],
  ])('%i → %i', (input, expected) => {
    expect(roundToLek(input)).toBe(expected);
  });
});

describe('formatMoney', () => {
  it('formats with space thousands separator and L suffix', () => {
    expect(formatMoney(120_000)).toBe(nb('1 200 L'));
    expect(formatMoney(10_000)).toBe(nb('100 L'));
    expect(formatMoney(123_456_700)).toBe(nb('1 234 567 L'));
  });

  it('supports the ALL suffix', () => {
    expect(formatMoney(120_000, { currency: 'ALL' })).toBe(nb('1 200 ALL'));
  });

  it('rounds to whole lek by default', () => {
    expect(formatMoney(12_350)).toBe(nb('124 L'));
  });

  it('can show decimals', () => {
    expect(formatMoney(12_345, { showDecimals: true })).toBe(nb('123,45 L'));
    expect(formatMoney(12_300, { showDecimals: true })).toBe(nb('123 L'));
  });

  it('formats negatives with a minus sign', () => {
    expect(formatMoney(-50_000)).toBe(nb('−500 L'));
  });

  it('formats zero', () => {
    expect(formatMoney(0)).toBe(nb('0 L'));
  });
});
