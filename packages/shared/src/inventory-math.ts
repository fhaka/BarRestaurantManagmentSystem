/*
 * Inventory arithmetic without schemas. Quantities are exact integers in thousandths of the
 * ingredient's unit ("milli": 1 kg = 1000, 18 g of coffee in a kg-based ingredient = 18), so
 * repeated sales never drift the way floating point would. Costs are minor units per whole unit.
 */

export const STOCK_UNITS = ['kg', 'g', 'l', 'ml', 'piece'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const MILLI = 1000;

/** "0.018" / 0.018 / "18" (from the database or a form) → exact thousandths. */
export function toMilli(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * MILLI);
  const trimmed = value.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return Number.NaN;
  const negative = trimmed.startsWith('-');
  const [whole, frac = ''] = trimmed.replace('-', '').split('.');
  const milli =
    Number(whole) * MILLI +
    Number((frac + '000').slice(0, 3)) +
    (Number(frac[3] ?? 0) >= 5 ? 1 : 0);
  return negative ? -milli : milli;
}

/** Thousandths → a decimal string for the database ("0.018"). */
export function fromMilli(milli: number): string {
  const negative = milli < 0;
  const abs = Math.abs(Math.round(milli));
  const whole = Math.floor(abs / MILLI);
  const frac = String(abs % MILLI).padStart(3, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Value of a quantity at a cost per whole unit, rounded to the qindarka. */
export function stockValue(milli: number, costPerUnitMinor: number): number {
  return Math.round((milli * costPerUnitMinor) / MILLI);
}

/**
 * Weighted average cost after receiving goods (plan §5.9). Stock below zero (sold before it was
 * booked in) does not drag the average: it counts as zero.
 */
export function weightedAverageCost(
  stockMilli: number,
  costMinor: number,
  receivedMilli: number,
  receivedCostMinor: number,
): number {
  const before = Math.max(0, stockMilli);
  const total = before + receivedMilli;
  if (total <= 0) return receivedCostMinor;
  return Math.round((before * costMinor + receivedMilli * receivedCostMinor) / total);
}

export interface RecipeLineInput {
  ingredientId: number;
  /** Thousandths of the ingredient's unit, per one dish. */
  qtyMilli: number;
  /** Lines for one size only (e.g. the large cappuccino's milk); null = every size. */
  variantId: number | null;
}

/** What one sold dish uses: its recipe for the chosen size plus its options' recipes. */
export function consumption(
  qty: number,
  itemLines: readonly RecipeLineInput[],
  variantId: number | null,
  modifierLines: readonly RecipeLineInput[],
): Map<number, number> {
  const out = new Map<number, number>();
  const add = (l: RecipeLineInput) =>
    out.set(l.ingredientId, (out.get(l.ingredientId) ?? 0) + l.qtyMilli * qty);
  const sized = itemLines.some((l) => l.variantId !== null && l.variantId === variantId);
  for (const l of itemLines) {
    // A size-specific line replaces the general line for the same ingredient.
    if (
      l.variantId === null &&
      sized &&
      itemLines.some((s) => s.variantId === variantId && s.ingredientId === l.ingredientId)
    )
      continue;
    if (l.variantId === null || l.variantId === variantId) add(l);
  }
  for (const l of modifierLines) add(l);
  return out;
}

/** Food cost of one dish from its recipe and the current ingredient costs. */
export function recipeCost(
  lines: readonly { qtyMilli: number; costPerUnitMinor: number }[],
): number {
  return lines.reduce((sum, l) => sum + stockValue(l.qtyMilli, l.costPerUnitMinor), 0);
}

/** Margin on the price without VAT (prices are tax-inclusive). */
export function margin(priceMinor: number, taxRateBp: number, costMinor: number) {
  const netMinor = Math.round((priceMinor * 10_000) / (10_000 + taxRateBp));
  const marginMinor = netMinor - costMinor;
  return {
    netMinor,
    marginMinor,
    marginBp: netMinor > 0 ? Math.round((marginMinor * 10_000) / netMinor) : 0,
  };
}

/** Stock count result for one ingredient (plan §5.9: variance in quantity and in lek). */
export function countVariance(
  expectedMilli: number,
  countedMilli: number,
  costPerUnitMinor: number,
) {
  const varianceMilli = countedMilli - expectedMilli;
  return { varianceMilli, varianceMinor: stockValue(varianceMilli, costPerUnitMinor) };
}
