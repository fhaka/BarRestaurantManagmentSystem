import { MINOR_PER_LEK, roundToLek } from './money.js';

/*
 * Bill arithmetic (business rule 2), without schemas so every app can use it.
 *
 *   line      = (unit price + modifier deltas) × qty, rounded per line to whole lek
 *   then      item discounts → bill discount → service charge → tax
 *
 * Prices are tax-inclusive: VAT is extracted from the final amounts per rate, never added.
 * Every total that a guest pays is a whole lek; allocations behind the scenes (a bill discount
 * spread over lines, service charge per line) are exact to the qindarka so sums always match.
 */

export type DiscountKind = 'percent' | 'fixed';

export interface TotalsLineInput {
  id: number;
  /** The line total already rounded to lek (see lineTotal). */
  grossMinor: number;
  /** VAT rate in basis points (2000 = 20%). */
  taxRateBp: number;
}

export interface DiscountInput {
  /** Null for a discount on the whole bill. */
  orderItemId: number | null;
  type: DiscountKind;
  /** Basis points for percent (1000 = 10%), minor units for fixed. */
  value: number;
}

export interface TotalsLine {
  id: number;
  grossMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  serviceMinor: number;
  /** What this line finally costs: gross − discounts + its share of the service charge. */
  finalMinor: number;
  taxRateBp: number;
}

export interface TaxLine {
  rateBp: number;
  /** Tax-inclusive amount at this rate. */
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
}

export interface OrderTotals {
  subtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  discountMinor: number;
  serviceMinor: number;
  totalMinor: number;
  taxMinor: number;
  tax: TaxLine[];
  lines: TotalsLine[];
}

/**
 * Splits `total` over `weights` in proportion, in whole units of `step` minor units, using the
 * largest-remainder method so the parts always add up exactly. With no weight, parts are equal.
 */
export function allocate(total: number, weights: readonly number[], step = 1): number[] {
  if (!weights.length) return [];
  const units = Math.round(total / step);
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares =
    sum > 0 ? weights.map((w) => (units * w) / sum) : weights.map(() => units / weights.length);
  const parts = shares.map((s) => Math.floor(s));
  let left = units - parts.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, rest: s - Math.floor(s) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts.map((p) => p * step);
}

/** Discount amount on a base, in whole lek, never more than the base. */
export function discountAmount(base: number, type: DiscountKind, value: number): number {
  if (base <= 0) return 0;
  const raw =
    type === 'percent' ? roundToLek(Math.round((base * value) / 10_000)) : roundToLek(value);
  return Math.max(0, Math.min(base, raw));
}

/** VAT contained in a tax-inclusive amount, to the qindarka. */
export function extractTax(grossMinor: number, rateBp: number): number {
  return Math.round((grossMinor * rateBp) / (10_000 + rateBp));
}

function taxByRate(parts: { rateBp: number; amount: number }[]): TaxLine[] {
  const byRate = new Map<number, number>();
  for (const p of parts) byRate.set(p.rateBp, (byRate.get(p.rateBp) ?? 0) + p.amount);
  return [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rateBp, grossMinor]) => {
      const taxMinor = extractTax(grossMinor, rateBp);
      return { rateBp, grossMinor, taxMinor, netMinor: grossMinor - taxMinor };
    });
}

export function computeTotals(input: {
  lines: TotalsLineInput[];
  discounts: DiscountInput[];
  serviceChargeBp: number;
}): OrderTotals {
  const { lines, discounts, serviceChargeBp } = input;
  // 1. Item discounts (one per line; a later one replaces an earlier one).
  const itemDiscount = new Map<number, number>();
  for (const d of discounts) {
    if (d.orderItemId === null) continue;
    const line = lines.find((l) => l.id === d.orderItemId);
    if (line) itemDiscount.set(line.id, discountAmount(line.grossMinor, d.type, d.value));
  }
  const afterItem = lines.map((l) => l.grossMinor - (itemDiscount.get(l.id) ?? 0));
  const afterItemTotal = afterItem.reduce((a, b) => a + b, 0);

  // 2. Bill discount on what is left, spread over the lines for the tax breakdown.
  const orderDiscount = discounts.find((d) => d.orderItemId === null);
  const orderDiscountMinor = orderDiscount
    ? discountAmount(afterItemTotal, orderDiscount.type, orderDiscount.value)
    : 0;
  const orderShares = allocate(orderDiscountMinor, afterItem);
  const discounted = afterItem.map((a, i) => a - orderShares[i]!);
  const discountedTotal = afterItemTotal - orderDiscountMinor;

  // 3. Service charge on the discounted amount, rounded to lek, spread the same way.
  const serviceMinor =
    serviceChargeBp > 0 ? roundToLek(Math.round((discountedTotal * serviceChargeBp) / 10_000)) : 0;
  const serviceShares = allocate(serviceMinor, discounted);

  const totalsLines: TotalsLine[] = lines.map((l, i) => ({
    id: l.id,
    grossMinor: l.grossMinor,
    itemDiscountMinor: itemDiscount.get(l.id) ?? 0,
    orderDiscountMinor: orderShares[i]!,
    serviceMinor: serviceShares[i]!,
    finalMinor: discounted[i]! + serviceShares[i]!,
    taxRateBp: l.taxRateBp,
  }));
  const tax = taxByRate(totalsLines.map((l) => ({ rateBp: l.taxRateBp, amount: l.finalMinor })));
  const itemDiscountMinor = [...itemDiscount.values()].reduce((a, b) => a + b, 0);
  return {
    subtotalMinor: lines.reduce((a, l) => a + l.grossMinor, 0),
    itemDiscountMinor,
    orderDiscountMinor,
    discountMinor: itemDiscountMinor + orderDiscountMinor,
    serviceMinor,
    totalMinor: discountedTotal + serviceMinor,
    taxMinor: tax.reduce((a, t) => a + t.taxMinor, 0),
    tax,
    lines: totalsLines,
  };
}

// ---- Splitting ---------------------------------------------------------------------------------

/** N equal parts in whole lek; the first parts take the leftover lek. */
export function splitEqually(totalMinor: number, n: number): number[] {
  return allocate(
    totalMinor,
    Array.from({ length: n }, () => 1),
    MINOR_PER_LEK,
  );
}

/**
 * Turns groups of lines into bill amounts in whole lek that add up exactly to the order total
 * (line amounts can carry qindarka after a bill discount is spread over them).
 */
export function splitByGroups(totalMinor: number, groupAmounts: readonly number[]): number[] {
  return allocate(totalMinor, groupAmounts, MINOR_PER_LEK);
}

/**
 * The VAT breakdown of one bill: the bill's own lines decide the mix of rates (by item / by seat),
 * otherwise the whole order's mix is used (equal or custom splits), scaled to the bill's amount.
 */
export function billTax(
  billTotalMinor: number,
  mix: readonly { rateBp: number; amount: number }[],
): TaxLine[] {
  const grouped = taxByRate(mix.map((m) => ({ rateBp: m.rateBp, amount: m.amount })));
  const scaled = allocate(
    billTotalMinor,
    grouped.map((g) => g.grossMinor),
  );
  return grouped.map((g, i) => {
    const grossMinor = scaled[i]!;
    const taxMinor = extractTax(grossMinor, g.rateBp);
    return { rateBp: g.rateBp, grossMinor, taxMinor, netMinor: grossMinor - taxMinor };
  });
}

/** Cash change, never negative. */
export function changeDue(tenderedMinor: number, dueMinor: number): number {
  return Math.max(0, tenderedMinor - dueMinor);
}

/** Albanian lek notes and coins for counting a drawer, in lek. */
export const ALL_DENOMINATIONS = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

export function countDenominations(counts: Partial<Record<number, number>>): number {
  return ALL_DENOMINATIONS.reduce((sum, d) => sum + d * MINOR_PER_LEK * (counts[d] ?? 0), 0);
}
