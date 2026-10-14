import type { Knex } from 'knex';
import {
  consumption,
  countVariance,
  fromMilli,
  ingredientCreateSchema,
  ingredientInputSchema,
  margin,
  purchaseOrderSchema,
  receiveSchema,
  recipeCost,
  recipeSchema,
  stockCountCreateSchema,
  stockCountLinesSchema,
  stockValue,
  supplierInputSchema,
  toMilli,
  wasteSchema,
  weightedAverageCost,
  type Ingredient,
  type ItemCosting,
  type Permission,
  type PurchaseOrder,
  type RecipeLine,
  type StockCount,
  type StockMovement,
  type StockMovementType,
  type StockUnit,
  type Supplier,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { transactionWithRetry } from '../../lib/transaction.js';
import { defaultTaxRate } from '../billing/totals.js';
import { emitLowStock, itemsUsing, loadRecipes, moveStock, refreshItemCosts } from './stock.js';

export interface InventoryActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Tx = Knex | Knex.Transaction;
/** A raw row from a knex query (untyped by knex; fields are converted where used). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;
const num = (v: unknown) => Number(v);
const milli = (v: unknown) => toMilli(String(v));
const iso = (v: unknown) => (v ? (v as Date).toISOString() : null);
const invalidRef = (field: string) =>
  new AppError(400, 'INVALID_REFERENCE', 'Choose something from this location.', { field });

// ---- Suppliers ---------------------------------------------------------------------------------

const toSupplier = (r: Record<string, unknown>): Supplier => ({
  id: num(r.id),
  name: String(r.name),
  contact: (r.contact as string | null) ?? null,
  phone: (r.phone as string | null) ?? null,
  email: (r.email as string | null) ?? null,
  notes: (r.notes as string | null) ?? null,
  active: Boolean(r.active),
});

export async function listSuppliers(actor: InventoryActor): Promise<Supplier[]> {
  return (
    await db('suppliers')
      .where({ location_id: actor.locationId })
      .whereNull('deleted_at')
      .orderBy('name')
  ).map(toSupplier);
}

export async function saveSupplier(
  actor: InventoryActor,
  id: number | null,
  raw: unknown,
): Promise<Supplier> {
  const input = supplierInputSchema.parse(raw);
  const row = {
    name: input.name,
    contact: input.contact ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    notes: input.notes ?? null,
    active: input.active,
  };
  let supplierId = id;
  if (id === null) {
    supplierId = num((await db('suppliers').insert({ location_id: actor.locationId, ...row }))[0]);
  } else {
    const updated = await db('suppliers')
      .where({ id, location_id: actor.locationId })
      .whereNull('deleted_at')
      .update(row);
    if (!updated) throw AppError.notFound('Supplier not found');
  }
  return toSupplier(await db('suppliers').where({ id: supplierId }).first());
}

export async function deleteSupplier(actor: InventoryActor, id: number) {
  const updated = await db('suppliers')
    .where({ id, location_id: actor.locationId })
    .whereNull('deleted_at')
    .update({ deleted_at: db.fn.now(3), active: false });
  if (!updated) throw AppError.notFound('Supplier not found');
}

// ---- Ingredients -------------------------------------------------------------------------------

function toIngredient(r: Record<string, unknown>): Ingredient {
  const stock = milli(r.stock_qty);
  const min = milli(r.min_qty);
  const cost = num(r.cost_per_unit_minor);
  return {
    id: num(r.id),
    name: String(r.name),
    unit: r.unit as StockUnit,
    category: String(r.category ?? ''),
    stockMilli: stock,
    minMilli: min,
    costPerUnitMinor: cost,
    valueMinor: stockValue(Math.max(0, stock), cost),
    supplierId: r.supplier_id === null ? null : num(r.supplier_id),
    supplierName: (r.supplier_name as string | null) ?? null,
    active: Boolean(r.active),
    low: min > 0 && stock < min,
  };
}

const ingredientQuery = (trx: Tx, locationId: number) =>
  trx('ingredients as i')
    .leftJoin('suppliers as s', 's.id', 'i.supplier_id')
    .where('i.location_id', locationId)
    .whereNull('i.deleted_at')
    .select('i.*', 's.name as supplier_name');

export async function listIngredients(actor: InventoryActor): Promise<Ingredient[]> {
  return (await ingredientQuery(db, actor.locationId).orderBy(['i.category', 'i.name'])).map(
    toIngredient,
  );
}

export async function lowStock(actor: InventoryActor): Promise<Ingredient[]> {
  return (await listIngredients(actor)).filter((i) => i.active && i.low);
}

async function ownSupplier(trx: Tx, locationId: number, supplierId: number | null | undefined) {
  if (!supplierId) return null;
  const s = await trx('suppliers')
    .where({ id: supplierId, location_id: locationId })
    .whereNull('deleted_at')
    .first('id');
  if (!s) throw invalidRef('supplierId');
  return supplierId;
}

export async function createIngredient(actor: InventoryActor, raw: unknown): Promise<Ingredient> {
  const input = ingredientCreateSchema.parse(raw);
  const id = await db.transaction(async (trx) => {
    const supplierId = await ownSupplier(trx, actor.locationId, input.supplierId);
    const [newId] = await trx('ingredients').insert({
      location_id: actor.locationId,
      name: input.name,
      unit: input.unit,
      category: input.category,
      min_qty: fromMilli(input.minQty),
      cost_per_unit_minor: input.costPerUnitMinor,
      supplier_id: supplierId,
      active: input.active,
    });
    // Opening stock goes through the ledger like everything else.
    if (input.stockQty > 0) {
      await moveStock(trx, {
        locationId: actor.locationId,
        ingredientId: num(newId),
        qtyMilli: input.stockQty,
        type: 'count_adjust',
        // System movements carry a reference, not text, so the UI shows them in its language.
        refType: 'opening',
        userId: actor.userId,
      });
    }
    await writeAudit(
      actor,
      {
        action: 'ingredient.created',
        entityType: 'ingredient',
        entityId: num(newId),
        after: { name: input.name },
      },
      trx,
    );
    return num(newId);
  });
  return toIngredient(await ingredientQuery(db, actor.locationId).where('i.id', id).first());
}

/** Name, unit, minimum, cost, supplier. Stock itself only changes through movements. */
export async function updateIngredient(
  actor: InventoryActor,
  id: number,
  raw: unknown,
): Promise<Ingredient> {
  const input = ingredientInputSchema.parse(raw);
  await db.transaction(async (trx) => {
    const before = await trx('ingredients')
      .where({ id, location_id: actor.locationId })
      .whereNull('deleted_at')
      .forUpdate()
      .first();
    if (!before) throw AppError.notFound('Ingredient not found');
    const supplierId = await ownSupplier(trx, actor.locationId, input.supplierId);
    await trx('ingredients')
      .where({ id })
      .update({
        name: input.name,
        unit: input.unit,
        category: input.category,
        min_qty: fromMilli(input.minQty),
        cost_per_unit_minor: input.costPerUnitMinor,
        supplier_id: supplierId,
        active: input.active,
      });
    if (num(before.cost_per_unit_minor) !== input.costPerUnitMinor) {
      await refreshItemCosts(trx, await itemsUsing(trx, [id]));
      await writeAudit(
        actor,
        {
          action: 'ingredient.cost_changed',
          entityType: 'ingredient',
          entityId: id,
          before: { costPerUnitMinor: num(before.cost_per_unit_minor) },
          after: { costPerUnitMinor: input.costPerUnitMinor },
        },
        trx,
      );
    }
  });
  return toIngredient(await ingredientQuery(db, actor.locationId).where('i.id', id).first());
}

export async function deleteIngredient(actor: InventoryActor, id: number) {
  const used = await db('recipe_lines').where({ ingredient_id: id }).first('id');
  if (used)
    throw AppError.conflict(
      'CONFLICT',
      'This ingredient is used in recipes. Remove it from them first.',
    );
  const updated = await db('ingredients')
    .where({ id, location_id: actor.locationId })
    .whereNull('deleted_at')
    .update({ deleted_at: db.fn.now(3), active: false });
  if (!updated) throw AppError.notFound('Ingredient not found');
}

// ---- Recipes, food cost and margins ------------------------------------------------------------

/** Plan §5.9: food cost and margin per item from recipe × current ingredient cost. */
export async function costing(actor: InventoryActor): Promise<ItemCosting[]> {
  const items = await db('menu_items as m')
    .leftJoin('menu_categories as c', 'c.id', 'm.category_id')
    .leftJoin('tax_rates as t', 't.id', 'm.tax_rate_id')
    .where('m.location_id', actor.locationId)
    .whereNull('m.deleted_at')
    .orderBy([{ column: 'c.sort' }, { column: 'm.sort' }])
    .select('m.id', 'm.name', 'm.price_minor', 'c.name as category_name', 't.rate_bp');
  const variants = items.length
    ? await db('menu_item_variants')
        .whereIn(
          'item_id',
          items.map((i) => i.id),
        )
        .orderBy('sort')
    : [];
  const modifiers = await db('modifiers as md')
    .join('modifier_groups as g', 'g.id', 'md.group_id')
    .where('g.location_id', actor.locationId)
    .whereNull('g.deleted_at')
    .select('md.id', 'md.name', 'md.price_delta_minor', 'g.name as group_name');
  const recipes = await loadRecipes(
    db,
    items.map((i) => num(i.id)),
    modifiers.map((m) => num(m.id)),
  );
  const ingredients = new Map(
    (await db('ingredients').where({ location_id: actor.locationId })).map((i) => [num(i.id), i]),
  );
  const fallbackRate = await defaultTaxRate(db, actor.locationId);
  const toLines = (
    lines: { ingredientId: number; qtyMilli: number; variantId: number | null }[],
  ): RecipeLine[] =>
    lines.map((l) => {
      const ing = ingredients.get(l.ingredientId);
      const cost = num(ing?.cost_per_unit_minor ?? 0);
      return {
        ingredientId: l.ingredientId,
        ingredientName: String(ing?.name ?? '?'),
        unit: (ing?.unit ?? 'piece') as StockUnit,
        qtyMilli: l.qtyMilli,
        variantId: l.variantId,
        costMinor: stockValue(l.qtyMilli, cost),
      };
    });
  const costOf = (used: Map<number, number>) =>
    recipeCost(
      [...used].map(([id, q]) => ({
        qtyMilli: q,
        costPerUnitMinor: num(ingredients.get(id)?.cost_per_unit_minor ?? 0),
      })),
    );

  const out: ItemCosting[] = items.map((item) => {
    const lines = recipes.items.get(num(item.id)) ?? [];
    const rate = item.rate_bp === null ? fallbackRate : num(item.rate_bp);
    const cost = costOf(consumption(1, lines, null, []));
    const m = margin(num(item.price_minor), rate, cost);
    return {
      kind: 'item',
      id: num(item.id),
      name: String(item.name),
      categoryName: item.category_name ?? null,
      priceMinor: num(item.price_minor),
      taxRateBp: rate,
      lines: toLines(lines),
      costMinor: cost,
      ...m,
      variants: variants
        .filter((v) => num(v.item_id) === num(item.id))
        .map((v) => {
          const vCost = costOf(consumption(1, lines, num(v.id), []));
          return {
            id: num(v.id),
            name: String(v.name),
            priceMinor: num(v.price_minor),
            costMinor: vCost,
            marginBp: margin(num(v.price_minor), rate, vCost).marginBp,
          };
        }),
    };
  });
  for (const mod of modifiers) {
    const lines = recipes.modifiers.get(num(mod.id)) ?? [];
    const cost = costOf(consumption(1, lines, null, []));
    out.push({
      kind: 'modifier',
      id: num(mod.id),
      name: String(mod.name),
      categoryName: String(mod.group_name),
      priceMinor: num(mod.price_delta_minor),
      taxRateBp: fallbackRate,
      lines: toLines(lines),
      costMinor: cost,
      ...margin(num(mod.price_delta_minor), fallbackRate, cost),
      variants: [],
    });
  }
  return out;
}

/** Replaces the recipe of a menu item or a modifier (e.g. "extra shot"). */
export async function saveRecipe(
  actor: InventoryActor,
  kind: 'item' | 'modifier',
  id: number,
  raw: unknown,
) {
  const input = recipeSchema.parse(raw);
  await db.transaction(async (trx) => {
    if (kind === 'item') {
      const item = await trx('menu_items')
        .where({ id, location_id: actor.locationId })
        .whereNull('deleted_at')
        .first('id');
      if (!item) throw AppError.notFound('Menu item not found');
      const variantIds = new Set(
        (await trx('menu_item_variants').where({ item_id: id }).select('id')).map((v) => num(v.id)),
      );
      if (input.lines.some((l) => l.variantId && !variantIds.has(l.variantId)))
        throw invalidRef('variantId');
    } else {
      const mod = await trx('modifiers as m')
        .join('modifier_groups as g', 'g.id', 'm.group_id')
        .where({ 'm.id': id, 'g.location_id': actor.locationId })
        .first('m.id');
      if (!mod) throw AppError.notFound('Option not found');
      if (input.lines.some((l) => l.variantId)) throw invalidRef('variantId');
    }
    const ingredientIds = [...new Set(input.lines.map((l) => l.ingredientId))];
    if (ingredientIds.length) {
      const found = await trx('ingredients')
        .where({ location_id: actor.locationId })
        .whereNull('deleted_at')
        .whereIn('id', ingredientIds)
        .count({ n: '*' })
        .first();
      if (num(found?.n) !== ingredientIds.length) throw invalidRef('ingredientId');
    }
    const column = kind === 'item' ? 'menu_item_id' : 'modifier_id';
    await trx('recipe_lines')
      .where({ [column]: id })
      .delete();
    if (input.lines.length) {
      await trx('recipe_lines').insert(
        input.lines.map((l) => ({
          [column]: id,
          variant_id: l.variantId ?? null,
          ingredient_id: l.ingredientId,
          qty: fromMilli(l.qty),
        })),
      );
    }
    if (kind === 'item') await refreshItemCosts(trx, [id]);
    await writeAudit(
      actor,
      {
        action: 'recipe.saved',
        entityType: kind === 'item' ? 'menu_item' : 'modifier',
        entityId: id,
        after: { lines: input.lines.length },
      },
      trx,
    );
  });
  return (await costing(actor)).find((c) => c.kind === kind && c.id === id)!;
}

// ---- Waste and staff meals ---------------------------------------------------------------------

/** Plan §5.9: spoilage or staff meals, for an ingredient or whole dishes (their recipe). */
export async function recordWaste(actor: InventoryActor, raw: unknown) {
  const input = wasteSchema.parse(raw);
  const alerts = await transactionWithRetry(async (trx) => {
    let used: Map<number, number>;
    if (input.ingredientId !== undefined) {
      const ing = await trx('ingredients')
        .where({ id: input.ingredientId, location_id: actor.locationId })
        .whereNull('deleted_at')
        .first('id');
      if (!ing) throw invalidRef('ingredientId');
      used = new Map([[input.ingredientId, input.qty!]]);
    } else {
      const item = await trx('menu_items')
        .where({ id: input.menuItemId, location_id: actor.locationId })
        .first('id');
      if (!item) throw invalidRef('menuItemId');
      const recipes = await loadRecipes(trx, [input.menuItemId!], []);
      used = consumption(
        input.dishes!,
        recipes.items.get(input.menuItemId!) ?? [],
        input.variantId ?? null,
        [],
      );
      if (!used.size) throw AppError.conflict('CONFLICT', 'This dish has no recipe yet.');
    }
    const out = [];
    for (const [ingredientId, q] of used) {
      out.push(
        await moveStock(trx, {
          locationId: actor.locationId,
          ingredientId,
          qtyMilli: -q,
          type: input.type,
          reason: input.reason,
          refType: input.menuItemId ? 'menu_item' : null,
          refId: input.menuItemId ?? null,
          userId: actor.userId,
        }),
      );
    }
    await writeAudit(
      actor,
      {
        action: `stock.${input.type}`,
        entityType: input.menuItemId ? 'menu_item' : 'ingredient',
        entityId: input.menuItemId ?? input.ingredientId!,
        after: { reason: input.reason },
      },
      trx,
    );
    return out;
  });
  emitLowStock(actor.locationId, alerts);
}

export async function listMovements(
  actor: InventoryActor,
  filter: { ingredientId?: number; type?: StockMovementType; limit?: number },
): Promise<StockMovement[]> {
  const q = db('stock_movements as m')
    .join('ingredients as i', 'i.id', 'm.ingredient_id')
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .where('m.location_id', actor.locationId)
    .orderBy('m.id', 'desc')
    .limit(Math.min(filter.limit ?? 200, 1000))
    .select('m.*', 'i.name as ingredient_name', 'i.unit', 'u.name as user_name');
  if (filter.ingredientId) q.where('m.ingredient_id', filter.ingredientId);
  if (filter.type) q.where('m.type', filter.type);
  return (await q).map((r) => ({
    id: num(r.id),
    ingredientId: num(r.ingredient_id),
    ingredientName: String(r.ingredient_name),
    unit: r.unit,
    type: r.type,
    qtyMilli: milli(r.qty),
    unitCostMinor: num(r.unit_cost_minor),
    reason: r.reason ?? null,
    refType: r.ref_type ?? null,
    refId: r.ref_id === null ? null : num(r.ref_id),
    userName: r.user_name ?? null,
    createdAt: iso(r.created_at)!,
  }));
}

// ---- Purchase orders ---------------------------------------------------------------------------

/** Orders with their lines in two queries, whatever the number of orders (no N+1). */
async function loadPurchaseOrders(
  trx: Tx,
  locationId: number,
  ids: number[],
): Promise<PurchaseOrder[]> {
  if (!ids.length) return [];
  const orders = await trx('purchase_orders as p')
    .join('suppliers as s', 's.id', 'p.supplier_id')
    .whereIn('p.id', ids)
    .where('p.location_id', locationId)
    .select('p.*', 's.name as supplier_name');
  const allLines = await trx('purchase_order_lines as l')
    .join('ingredients as i', 'i.id', 'l.ingredient_id')
    .whereIn('l.purchase_order_id', ids)
    .orderBy('l.id')
    .select('l.*', 'i.name as ingredient_name', 'i.unit');
  const byId = new Map(orders.map((o) => [num(o.id), o]));
  return ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const po = byId.get(id)!;
      const lines = allLines.filter((l) => num(l.purchase_order_id) === id);
      return toPurchaseOrder(po, lines);
    });
}

async function loadPurchaseOrder(trx: Tx, locationId: number, id: number): Promise<PurchaseOrder> {
  const [po] = await loadPurchaseOrders(trx, locationId, [id]);
  if (!po) throw AppError.notFound('Purchase order not found');
  return po;
}

function toPurchaseOrder(po: DbRow, lines: DbRow[]): PurchaseOrder {
  return {
    id: num(po.id),
    number: num(po.number),
    supplierId: num(po.supplier_id),
    supplierName: String(po.supplier_name),
    status: po.status,
    notes: po.notes ?? null,
    expectedAt: po.expected_at
      ? po.expected_at instanceof Date
        ? po.expected_at.toISOString().slice(0, 10)
        : String(po.expected_at)
      : null,
    totalMinor: lines.reduce(
      (s, l) => s + stockValue(milli(l.qty_ordered), num(l.unit_cost_minor)),
      0,
    ),
    createdAt: iso(po.created_at)!,
    sentAt: iso(po.sent_at),
    receivedAt: iso(po.received_at),
    lines: lines.map((l) => ({
      id: num(l.id),
      ingredientId: num(l.ingredient_id),
      ingredientName: String(l.ingredient_name),
      unit: l.unit,
      orderedMilli: milli(l.qty_ordered),
      receivedMilli: milli(l.qty_received),
      unitCostMinor: num(l.unit_cost_minor),
    })),
  };
}

export async function listPurchaseOrders(actor: InventoryActor): Promise<PurchaseOrder[]> {
  const ids = (
    await db('purchase_orders')
      .where({ location_id: actor.locationId })
      .orderBy('id', 'desc')
      .limit(100)
      .select('id')
  ).map((r) => num(r.id));
  return loadPurchaseOrders(db, actor.locationId, ids);
}

export const getPurchaseOrder = (actor: InventoryActor, id: number) =>
  loadPurchaseOrder(db, actor.locationId, id);

async function writeLines(
  trx: Tx,
  locationId: number,
  poId: number,
  input: ReturnType<typeof purchaseOrderSchema.parse>,
) {
  const ids = [...new Set(input.lines.map((l) => l.ingredientId))];
  const found = await trx('ingredients')
    .where({ location_id: locationId })
    .whereNull('deleted_at')
    .whereIn('id', ids)
    .count({ n: '*' })
    .first();
  if (num(found?.n) !== ids.length) throw invalidRef('ingredientId');
  await trx('purchase_order_lines').where({ purchase_order_id: poId }).delete();
  await trx('purchase_order_lines').insert(
    input.lines.map((l) => ({
      purchase_order_id: poId,
      ingredient_id: l.ingredientId,
      qty_ordered: fromMilli(l.qty),
      unit_cost_minor: l.unitCostMinor,
    })),
  );
}

export async function createPurchaseOrder(
  actor: InventoryActor,
  raw: unknown,
): Promise<PurchaseOrder> {
  const input = purchaseOrderSchema.parse(raw);
  const id = await transactionWithRetry(async (trx) => {
    await ownSupplier(trx, actor.locationId, input.supplierId);
    const last = await trx('purchase_orders')
      .where({ location_id: actor.locationId })
      .max({ n: 'number' })
      .first();
    const [poId] = await trx('purchase_orders').insert({
      location_id: actor.locationId,
      supplier_id: input.supplierId,
      number: num(last?.n ?? 0) + 1,
      notes: input.notes ?? null,
      expected_at: input.expectedAt ?? null,
      created_by: actor.userId,
    });
    await writeLines(trx, actor.locationId, num(poId), input);
    return num(poId);
  });
  return loadPurchaseOrder(db, actor.locationId, id);
}

const poState = (message: string) => AppError.conflict('PO_STATE', message);

export async function updatePurchaseOrder(
  actor: InventoryActor,
  id: number,
  raw: unknown,
): Promise<PurchaseOrder> {
  const input = purchaseOrderSchema.parse(raw);
  await db.transaction(async (trx) => {
    const po = await trx('purchase_orders')
      .where({ id, location_id: actor.locationId })
      .forUpdate()
      .first('status');
    if (!po) throw AppError.notFound('Purchase order not found');
    if (po.status !== 'draft') throw poState('Only a draft can be changed.');
    await ownSupplier(trx, actor.locationId, input.supplierId);
    await trx('purchase_orders')
      .where({ id })
      .update({
        supplier_id: input.supplierId,
        notes: input.notes ?? null,
        expected_at: input.expectedAt ?? null,
      });
    await writeLines(trx, actor.locationId, id, input);
  });
  return loadPurchaseOrder(db, actor.locationId, id);
}

export async function setPurchaseOrderStatus(
  actor: InventoryActor,
  id: number,
  to: 'sent' | 'cancelled',
): Promise<PurchaseOrder> {
  await db.transaction(async (trx) => {
    const po = await trx('purchase_orders')
      .where({ id, location_id: actor.locationId })
      .forUpdate()
      .first('status');
    if (!po) throw AppError.notFound('Purchase order not found');
    const allowed = to === 'sent' ? ['draft'] : ['draft', 'sent'];
    if (!allowed.includes(po.status)) throw poState(`A ${po.status} order cannot become ${to}.`);
    await trx('purchase_orders')
      .where({ id })
      .update({ status: to, ...(to === 'sent' ? { sent_at: trx.fn.now(3) } : {}) });
    await writeAudit(
      actor,
      { action: `purchase_order.${to}`, entityType: 'purchase_order', entityId: id },
      trx,
    );
  });
  return loadPurchaseOrder(db, actor.locationId, id);
}

/**
 * Goods arrive (all or part): stock goes up through the ledger and the ingredient's cost becomes
 * the weighted average of what was in stock and what arrived (plan §5.9).
 */
export async function receivePurchaseOrder(
  actor: InventoryActor,
  id: number,
  raw: unknown,
): Promise<PurchaseOrder> {
  const input = receiveSchema.parse(raw);
  await transactionWithRetry(async (trx) => {
    const po = await trx('purchase_orders')
      .where({ id, location_id: actor.locationId })
      .forUpdate()
      .first('status', 'number');
    if (!po) throw AppError.notFound('Purchase order not found');
    if (!['draft', 'sent', 'partially_received'].includes(po.status))
      throw poState('This order is closed.');
    const lines = await trx('purchase_order_lines').where({ purchase_order_id: id }).forUpdate();
    const touched: number[] = [];
    for (const r of input.lines) {
      const line = lines.find((l) => num(l.id) === r.lineId);
      if (!line) throw invalidRef('lineId');
      const remaining = milli(line.qty_ordered) - milli(line.qty_received);
      if (r.qty > remaining) {
        throw AppError.conflict('RECEIVE_TOO_MUCH', 'More than was ordered and is still open.', {
          lineId: r.lineId,
          remainingQty: fromMilli(remaining),
        });
      }
      const cost = r.unitCostMinor ?? num(line.unit_cost_minor);
      const ing = await trx('ingredients')
        .where({ id: line.ingredient_id })
        .forUpdate()
        .first('stock_qty', 'cost_per_unit_minor');
      const newCost = weightedAverageCost(
        milli(ing.stock_qty),
        num(ing.cost_per_unit_minor),
        r.qty,
        cost,
      );
      await moveStock(trx, {
        locationId: actor.locationId,
        ingredientId: num(line.ingredient_id),
        qtyMilli: r.qty,
        type: 'purchase',
        unitCostMinor: cost,
        refType: 'purchase_order',
        refId: id,
        userId: actor.userId,
      });
      await trx('ingredients')
        .where({ id: line.ingredient_id })
        .update({ cost_per_unit_minor: newCost });
      await trx('purchase_order_lines')
        .where({ id: line.id })
        .update({
          qty_received: fromMilli(milli(line.qty_received) + r.qty),
          unit_cost_minor: cost,
        });
      line.qty_received = fromMilli(milli(line.qty_received) + r.qty);
      touched.push(num(line.ingredient_id));
    }
    const complete = lines.every((l) => milli(l.qty_received) >= milli(l.qty_ordered));
    await trx('purchase_orders')
      .where({ id })
      .update({
        status: complete ? 'received' : 'partially_received',
        ...(complete ? { received_at: trx.fn.now(3) } : {}),
      });
    await refreshItemCosts(trx, await itemsUsing(trx, touched));
    await writeAudit(
      actor,
      {
        action: 'purchase_order.received',
        entityType: 'purchase_order',
        entityId: id,
        after: { lines: input.lines.length, complete },
      },
      trx,
    );
  });
  return loadPurchaseOrder(db, actor.locationId, id);
}

// ---- Stock counts ------------------------------------------------------------------------------

/** Counts with their lines in two queries, whatever the number of counts (no N+1). */
async function loadCounts(trx: Tx, locationId: number, ids: number[]): Promise<StockCount[]> {
  if (!ids.length) return [];
  const counts = await trx('stock_counts as c')
    .join('users as u', 'u.id', 'c.created_by')
    .whereIn('c.id', ids)
    .where('c.location_id', locationId)
    .select('c.*', 'u.name as created_by_name');
  const allLines = await trx('stock_count_lines as l')
    .join('ingredients as i', 'i.id', 'l.ingredient_id')
    .whereIn('l.stock_count_id', ids)
    .orderBy(['i.category', 'i.name'])
    .select('l.*', 'i.name as ingredient_name', 'i.unit');
  const byId = new Map(counts.map((c) => [num(c.id), c]));
  return ids
    .filter((id) => byId.has(id))
    .map((id) =>
      toCount(
        byId.get(id)!,
        allLines.filter((l) => num(l.stock_count_id) === id),
      ),
    );
}

async function loadCount(trx: Tx, locationId: number, id: number): Promise<StockCount> {
  const [count] = await loadCounts(trx, locationId, [id]);
  if (!count) throw AppError.notFound('Stock count not found');
  return count;
}

function toCount(count: DbRow, lines: DbRow[]): StockCount {
  const view = lines.map((l) => {
    const expected = milli(l.expected_qty);
    const counted = l.counted_qty === null ? null : milli(l.counted_qty);
    const variance =
      counted === null ? null : countVariance(expected, counted, num(l.unit_cost_minor));
    return {
      ingredientId: num(l.ingredient_id),
      ingredientName: String(l.ingredient_name),
      unit: l.unit as StockUnit,
      expectedMilli: expected,
      countedMilli: counted,
      costPerUnitMinor: num(l.unit_cost_minor),
      varianceMilli: variance?.varianceMilli ?? null,
      varianceMinor: variance?.varianceMinor ?? null,
    };
  });
  return {
    id: num(count.id),
    category: count.category ?? null,
    status: count.status,
    note: count.note ?? null,
    createdBy: String(count.created_by_name),
    createdAt: iso(count.created_at)!,
    appliedAt: iso(count.applied_at),
    lines: view,
    varianceMinor: view.reduce((s, l) => s + (l.varianceMinor ?? 0), 0),
  };
}

export async function listCounts(actor: InventoryActor) {
  const ids = (
    await db('stock_counts')
      .where({ location_id: actor.locationId })
      .orderBy('id', 'desc')
      .limit(30)
      .select('id')
  ).map((r) => num(r.id));
  return loadCounts(db, actor.locationId, ids);
}

export const getCount = (actor: InventoryActor, id: number) => loadCount(db, actor.locationId, id);

/** Starts a count (all ingredients or one category): the expected quantities are frozen now. */
export async function createCount(actor: InventoryActor, raw: unknown): Promise<StockCount> {
  const input = stockCountCreateSchema.parse(raw);
  const id = await db.transaction(async (trx) => {
    const open = await trx('stock_counts')
      .where({ location_id: actor.locationId, status: 'open' })
      .first('id');
    if (open)
      throw AppError.conflict('COUNT_STATE', 'Finish or cancel the open stock count first.');
    const q = trx('ingredients')
      .where({ location_id: actor.locationId, active: true })
      .whereNull('deleted_at');
    if (input.category) q.where({ category: input.category });
    const ingredients = await q.select('id', 'stock_qty', 'cost_per_unit_minor');
    if (!ingredients.length)
      throw AppError.conflict('COUNT_STATE', 'There is nothing to count here.');
    const [countId] = await trx('stock_counts').insert({
      location_id: actor.locationId,
      category: input.category || null,
      note: input.note ?? null,
      created_by: actor.userId,
    });
    await trx('stock_count_lines').insert(
      ingredients.map((i) => ({
        stock_count_id: countId,
        ingredient_id: i.id,
        expected_qty: i.stock_qty,
        unit_cost_minor: i.cost_per_unit_minor,
      })),
    );
    return num(countId);
  });
  return loadCount(db, actor.locationId, id);
}

async function openCount(trx: Tx, locationId: number, id: number) {
  const count = await trx('stock_counts')
    .where({ id, location_id: locationId })
    .forUpdate()
    .first('status');
  if (!count) throw AppError.notFound('Stock count not found');
  if (count.status !== 'open')
    throw AppError.conflict('COUNT_STATE', 'This count is already finished.');
}

export async function saveCountLines(
  actor: InventoryActor,
  id: number,
  raw: unknown,
): Promise<StockCount> {
  const input = stockCountLinesSchema.parse(raw);
  await db.transaction(async (trx) => {
    await openCount(trx, actor.locationId, id);
    for (const l of input.lines) {
      await trx('stock_count_lines')
        .where({ stock_count_id: id, ingredient_id: l.ingredientId })
        .update({ counted_qty: l.counted === null ? null : fromMilli(l.counted) });
    }
  });
  return loadCount(db, actor.locationId, id);
}

/**
 * Applies a count: each counted ingredient is corrected by (counted − expected), so sales made
 * while counting are kept. Uncounted lines are left alone. The variance is in quantity and lek.
 */
export async function applyCount(actor: InventoryActor, id: number): Promise<StockCount> {
  const alerts = await transactionWithRetry(async (trx) => {
    await openCount(trx, actor.locationId, id);
    const view = await loadCount(trx, actor.locationId, id);
    const out = [];
    for (const l of view.lines) {
      if (l.varianceMilli === null || l.varianceMilli === 0) continue;
      out.push(
        await moveStock(trx, {
          locationId: actor.locationId,
          ingredientId: l.ingredientId,
          qtyMilli: l.varianceMilli,
          type: 'count_adjust',
          unitCostMinor: l.costPerUnitMinor,
          refType: 'stock_count',
          refId: id,
          userId: actor.userId,
        }),
      );
    }
    await trx('stock_counts')
      .where({ id })
      .update({ status: 'applied', applied_by: actor.userId, applied_at: trx.fn.now(3) });
    await writeAudit(
      actor,
      {
        action: 'stock_count.applied',
        entityType: 'stock_count',
        entityId: id,
        after: { varianceMinor: view.varianceMinor },
      },
      trx,
    );
    return out;
  });
  emitLowStock(actor.locationId, alerts);
  return loadCount(db, actor.locationId, id);
}

export async function cancelCount(actor: InventoryActor, id: number): Promise<StockCount> {
  await db.transaction(async (trx) => {
    await openCount(trx, actor.locationId, id);
    await trx('stock_counts').where({ id }).update({ status: 'cancelled' });
  });
  return loadCount(db, actor.locationId, id);
}
