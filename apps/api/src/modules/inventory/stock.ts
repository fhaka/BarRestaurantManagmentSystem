import type { Knex } from 'knex';
import {
  consumption,
  fromMilli,
  recipeCost,
  toMilli,
  type RecipeLineInput,
  type StockLowData,
  type StockMovementType,
  type StockUnit,
} from '@tavolina/shared';
import { emit } from '../../realtime/server.js';

type Tx = Knex | Knex.Transaction;
const num = (v: unknown) => Number(v);

/**
 * The stock ledger (plan §7): every change to an ingredient's stock is a stock_movements row, and
 * ingredients.stock_qty moves with it in the same transaction, so the two always agree.
 */
export async function moveStock(
  trx: Tx,
  move: {
    locationId: number;
    ingredientId: number;
    qtyMilli: number;
    type: StockMovementType;
    unitCostMinor?: number;
    refType?: string | null;
    refId?: number | null;
    reason?: string | null;
    userId?: number | null;
  },
): Promise<StockLowData | null> {
  if (move.qtyMilli === 0) return null;
  const ingredient = await trx('ingredients')
    .where({ id: move.ingredientId, location_id: move.locationId })
    .forUpdate()
    .first('id', 'name', 'unit', 'stock_qty', 'min_qty', 'cost_per_unit_minor');
  if (!ingredient) return null;
  const before = toMilli(String(ingredient.stock_qty));
  const after = before + move.qtyMilli;
  await trx('stock_movements').insert({
    location_id: move.locationId,
    ingredient_id: move.ingredientId,
    type: move.type,
    qty: fromMilli(move.qtyMilli),
    unit_cost_minor: move.unitCostMinor ?? num(ingredient.cost_per_unit_minor),
    ref_type: move.refType ?? null,
    ref_id: move.refId ?? null,
    reason: move.reason ?? null,
    user_id: move.userId ?? null,
  });
  await trx('ingredients')
    .where({ id: move.ingredientId })
    .update({ stock_qty: fromMilli(after) });
  // Alert when stock drops below the minimum (only on the movement that crosses it).
  const min = toMilli(String(ingredient.min_qty));
  if (min > 0 && after < min && before >= min) {
    return {
      ingredientId: num(ingredient.id),
      name: String(ingredient.name),
      stockMilli: after,
      minMilli: min,
      unit: ingredient.unit as StockUnit,
    };
  }
  return null;
}

export function emitLowStock(locationId: number, alerts: (StockLowData | null)[]) {
  for (const alert of alerts) if (alert) emit('stock.low', locationId, { ...alert });
}

interface RecipeIndex {
  items: Map<number, RecipeLineInput[]>;
  modifiers: Map<number, RecipeLineInput[]>;
}

export async function loadRecipes(
  trx: Tx,
  menuItemIds: number[],
  modifierIds: number[],
): Promise<RecipeIndex> {
  const rows =
    menuItemIds.length || modifierIds.length
      ? await trx('recipe_lines')
          .where((q) => {
            if (menuItemIds.length) q.orWhereIn('menu_item_id', menuItemIds);
            if (modifierIds.length) q.orWhereIn('modifier_id', modifierIds);
          })
          .select('menu_item_id', 'variant_id', 'modifier_id', 'ingredient_id', 'qty')
      : [];
  const index: RecipeIndex = { items: new Map(), modifiers: new Map() };
  for (const r of rows) {
    const line: RecipeLineInput = {
      ingredientId: num(r.ingredient_id),
      qtyMilli: toMilli(String(r.qty)),
      variantId: r.variant_id === null ? null : num(r.variant_id),
    };
    const [map, key] =
      r.menu_item_id !== null
        ? [index.items, num(r.menu_item_id)]
        : [index.modifiers, num(r.modifier_id)];
    map.set(key, [...(map.get(key) ?? []), line]);
  }
  return index;
}

/**
 * Business rule 7: books out the ingredients of sent (or paid) dishes, in the caller's
 * transaction. Each dish is booked once (order_items.stock_deducted). Set menus are booked through
 * their dishes. Returns low-stock alerts to send after commit.
 */
export async function deductForItems(
  trx: Tx,
  locationId: number,
  itemIds: number[],
  userId: number | null,
): Promise<(StockLowData | null)[]> {
  if (!itemIds.length) return [];
  const items = await trx('order_items')
    .whereIn('id', itemIds)
    .where('stock_deducted', false)
    .whereNotNull('menu_item_id')
    .select('id', 'menu_item_id', 'variant_id', 'qty');
  if (!items.length) return [];
  const mods = await trx('order_item_modifiers')
    .whereIn(
      'order_item_id',
      items.map((i) => i.id),
    )
    .whereNotNull('modifier_id')
    .select('order_item_id', 'modifier_id');
  const recipes = await loadRecipes(
    trx,
    [...new Set(items.map((i) => num(i.menu_item_id)))],
    [...new Set(mods.map((m) => num(m.modifier_id)))],
  );
  const alerts: (StockLowData | null)[] = [];
  for (const item of items) {
    const modifierLines = mods
      .filter((m) => num(m.order_item_id) === num(item.id))
      .flatMap((m) => recipes.modifiers.get(num(m.modifier_id)) ?? []);
    const used = consumption(
      num(item.qty),
      recipes.items.get(num(item.menu_item_id)) ?? [],
      item.variant_id === null ? null : num(item.variant_id),
      modifierLines,
    );
    for (const [ingredientId, milli] of used) {
      alerts.push(
        await moveStock(trx, {
          locationId,
          ingredientId,
          qtyMilli: -milli,
          type: 'sale',
          refType: 'order_item',
          refId: num(item.id),
          userId,
        }),
      );
    }
  }
  await trx('order_items')
    .whereIn(
      'id',
      items.map((i) => i.id),
    )
    .update({ stock_deducted: true });
  return alerts;
}

/**
 * A voided dish gives its ingredients back, unless the kitchen had started it and the location
 * counts such voids as waste (business rule 3): then the sale is turned into waste.
 */
export async function reverseForItems(
  trx: Tx,
  locationId: number,
  itemIds: number[],
  asWaste: boolean,
  reason: string,
  userId: number,
) {
  for (const itemId of itemIds) {
    const moves = await trx('stock_movements')
      .where({ ref_type: 'order_item', ref_id: itemId })
      .groupBy('ingredient_id')
      .select('ingredient_id', trx.raw('SUM(qty) as qty'));
    for (const m of moves) {
      const booked = -toMilli(String(m.qty));
      if (booked <= 0) continue;
      const base = {
        locationId,
        ingredientId: num(m.ingredient_id),
        refType: 'order_item',
        refId: itemId,
        userId,
      };
      await moveStock(trx, { ...base, qtyMilli: booked, type: 'sale_reversal', reason });
      if (asWaste) await moveStock(trx, { ...base, qtyMilli: -booked, type: 'waste', reason });
    }
  }
  if (itemIds.length)
    await trx('order_items').whereIn('id', itemIds).update({ stock_deducted: false });
}

/**
 * Food cost per menu item from its general recipe (sizes have their own costs in the costing
 * view); stored in menu_items.cost_minor so the menu editor shows it. Called after recipe or
 * cost changes.
 */
export async function refreshItemCosts(trx: Tx, menuItemIds: number[]) {
  if (!menuItemIds.length) return;
  const rows = await trx('recipe_lines as r')
    .join('ingredients as i', 'i.id', 'r.ingredient_id')
    .whereIn('r.menu_item_id', menuItemIds)
    .whereNull('r.variant_id')
    .select('r.menu_item_id', 'r.qty', 'i.cost_per_unit_minor');
  for (const id of menuItemIds) {
    const lines = rows.filter((r) => num(r.menu_item_id) === id);
    await trx('menu_items')
      .where({ id })
      .update({
        cost_minor: lines.length
          ? recipeCost(
              lines.map((l) => ({
                qtyMilli: toMilli(String(l.qty)),
                costPerUnitMinor: num(l.cost_per_unit_minor),
              })),
            )
          : null,
      });
  }
}

/** Menu items whose recipes use these ingredients (to refresh costs after a purchase). */
export async function itemsUsing(trx: Tx, ingredientIds: number[]): Promise<number[]> {
  if (!ingredientIds.length) return [];
  return (
    await trx('recipe_lines')
      .whereIn('ingredient_id', ingredientIds)
      .whereNotNull('menu_item_id')
      .distinct('menu_item_id')
  ).map((r) => num(r.menu_item_id));
}
