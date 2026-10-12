import { roundToLek } from './money.js';

/*
 * Order arithmetic without schemas (no zod), shared by the API and the browser apps.
 */

// ---- Money ---------------------------------------------------------------------------------------

/**
 * Business rule 2 (first step): line = (unit price + modifier deltas) × qty, rounded per line to
 * whole lek. Discounts, service and tax are applied on top in Phase 6.
 */
export function lineTotal(
  unitPriceMinor: number,
  modifierDeltasMinor: readonly number[],
  qty: number,
): number {
  const unit = unitPriceMinor + modifierDeltasMinor.reduce((sum, d) => sum + d, 0);
  return roundToLek(unit * qty);
}

// ---- Modifier choices ----------------------------------------------------------------------------

export interface ModifierGroupRule {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  modifierIds: number[];
}

export type ModifierProblem =
  | { code: 'unknownModifier'; modifierId: number }
  | { code: 'tooFew'; groupId: number; groupName: string; min: number }
  | { code: 'tooMany'; groupId: number; groupName: string; max: number };

/** Checks a selection against the item's modifier groups (min/max/required, known ids). */
export function checkModifierSelection(
  groups: readonly ModifierGroupRule[],
  selected: readonly number[],
): ModifierProblem[] {
  const problems: ModifierProblem[] = [];
  const allowed = new Map<number, number>();
  for (const g of groups) for (const id of g.modifierIds) allowed.set(id, g.id);
  for (const id of selected)
    if (!allowed.has(id)) problems.push({ code: 'unknownModifier', modifierId: id });
  for (const g of groups) {
    const count = selected.filter((id) => allowed.get(id) === g.id).length;
    const min = g.required ? Math.max(1, g.minSelect) : g.minSelect;
    if (count < min) problems.push({ code: 'tooFew', groupId: g.id, groupName: g.name, min });
    if (count > g.maxSelect)
      problems.push({ code: 'tooMany', groupId: g.id, groupName: g.name, max: g.maxSelect });
  }
  return problems;
}
