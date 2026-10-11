import { roundToLek } from './money.js';
import { inTimeWindow, localParts, weekdayInMask, type LocalParts } from './time.js';

/** The fields of a price rule that decide when and how it applies. */
export interface PriceRuleLike {
  id: number;
  scope: 'item' | 'category';
  scopeId: number;
  type: 'percent' | 'fixed';
  value: number;
  weekdayMask: number;
  timeFrom: string | null;
  timeTo: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  active: boolean;
}

export interface PricingTarget {
  itemId: number;
  /** The item's category and its ancestors (a category rule covers subcategories). */
  categoryIds: readonly number[];
}

/** Whether a rule is in effect for this item at this local time. */
export function ruleApplies(
  rule: PriceRuleLike,
  target: PricingTarget,
  local: LocalParts,
): boolean {
  if (!rule.active) return false;
  const inScope =
    rule.scope === 'item'
      ? rule.scopeId === target.itemId
      : target.categoryIds.includes(rule.scopeId);
  if (!inScope) return false;
  if (rule.dateFrom && local.date < rule.dateFrom) return false;
  if (rule.dateTo && local.date > rule.dateTo) return false;
  if (!weekdayInMask(local.weekday, rule.weekdayMask)) return false;
  return inTimeWindow(local.minutes, rule.timeFrom, rule.timeTo);
}

/** Price after one rule, rounded to whole lek and never below zero. */
export function applyRule(priceMinor: number, rule: Pick<PriceRuleLike, 'type' | 'value'>): number {
  const discounted =
    rule.type === 'percent'
      ? priceMinor - (priceMinor * rule.value) / 10_000
      : priceMinor - rule.value;
  return Math.max(0, roundToLek(Math.round(discounted)));
}

export interface EffectivePrice {
  priceMinor: number;
  /** The rule that set the price, when one lowered it. */
  ruleId: number | null;
}

/**
 * The price a guest pays at `at` (business rule 6: happy hour is judged in Europe/Tirane time,
 * at the moment the item is added). Rules do not stack: the lowest resulting price wins.
 * Modifier price deltas are never discounted.
 */
export function effectivePrice(
  basePriceMinor: number,
  target: PricingTarget,
  rules: readonly PriceRuleLike[],
  at: Date,
  timeZone: string,
): EffectivePrice {
  const local = localParts(at, timeZone);
  let best: EffectivePrice = { priceMinor: basePriceMinor, ruleId: null };
  for (const rule of rules) {
    if (!ruleApplies(rule, target, local)) continue;
    const price = applyRule(basePriceMinor, rule);
    if (price < best.priceMinor) best = { priceMinor: price, ruleId: rule.id };
  }
  return best;
}
