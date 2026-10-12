import type { Knex } from 'knex';
import {
  OUT_OF_STOCK_RESET_TIME,
  TIMEZONE,
  categoryInputSchema,
  comboInputSchema,
  categoryUpdateSchema,
  itemInputSchema,
  itemUpdateSchema,
  modifierGroupInputSchema,
  nextLocalTime,
  outOfStockSchema,
  priceRuleInputSchema,
  reorderSchema,
  stationInputSchema,
  taxRateInputSchema,
  type AdminMenu,
  type MenuItem,
  type Permission,
} from '@tavolina/shared';
import type { z } from 'zod';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { removeMenuImage, storeMenuImage } from '../../lib/images.js';
import { emit } from '../../realtime/server.js';
import * as repo from './repo.js';
import { deleteTranslations, saveTranslations } from './translations.js';

export interface MenuActor extends ActorContext {
  locationId: number;
  permissions: ReadonlySet<Permission>;
}

type Tx = Knex | Knex.Transaction;

const invalidReference = (field: string) =>
  new AppError(400, 'INVALID_REFERENCE', 'This refers to something that is not on this menu.', {
    field,
  });

async function assertOwned(
  trx: Tx,
  table: Parameters<typeof repo.foreignIds>[1],
  ids: (number | null | undefined)[],
  locationId: number,
  field: string,
) {
  const present = ids.filter((id): id is number => typeof id === 'number');
  if ((await repo.foreignIds(trx, table, present, locationId)).length)
    throw invalidReference(field);
}

// ---- Read --------------------------------------------------------------------------------------

/** Full menu for staff. Cost prices are only shown to people who can edit the menu. */
export async function getAdminMenu(actor: MenuActor): Promise<AdminMenu> {
  const menu = await repo.loadAdminMenu(db, actor.locationId);
  if (!actor.permissions.has('menu.edit')) {
    menu.items = menu.items.map((item) => ({ ...item, costMinor: null }));
  }
  return menu;
}

async function getItem(trx: Tx, locationId: number, id: number): Promise<MenuItem> {
  const menu = await repo.loadAdminMenu(trx, locationId);
  const item = menu.items.find((i) => i.id === id);
  if (!item) throw AppError.notFound('Menu item not found');
  return item;
}

// ---- Stations & tax rates ----------------------------------------------------------------------

export async function createStation(actor: MenuActor, raw: unknown) {
  const input = stationInputSchema.parse(raw);
  const [id] = await db('stations').insert({
    location_id: actor.locationId,
    name: input.name,
    type: input.type,
    active: input.active,
    sort: await repo.nextSort(db, 'stations', { location_id: actor.locationId }),
  });
  return { id: Number(id), ...input };
}

export async function updateStation(actor: MenuActor, id: number, raw: unknown) {
  const input = stationInputSchema.partial().parse(raw);
  await assertOwned(db, 'stations', [id], actor.locationId, 'id');
  await db('stations').where({ id }).update(input);
  const row = await db('stations').where({ id }).first();
  return { id, name: row.name, type: row.type, active: Boolean(row.active) };
}

export async function createTaxRate(actor: MenuActor, raw: unknown) {
  const input = taxRateInputSchema.parse(raw);
  const id = await db.transaction(async (trx) => {
    if (input.isDefault) {
      await trx('tax_rates').where({ location_id: actor.locationId }).update({ is_default: false });
    }
    const [newId] = await trx('tax_rates').insert({
      location_id: actor.locationId,
      name: input.name,
      rate_bp: input.rateBp,
      is_default: input.isDefault,
    });
    return Number(newId);
  });
  return { id, ...input };
}

export async function updateTaxRate(actor: MenuActor, id: number, raw: unknown) {
  const input = taxRateInputSchema.partial().parse(raw);
  await assertOwned(db, 'tax_rates', [id], actor.locationId, 'id');
  await db.transaction(async (trx) => {
    if (input.isDefault) {
      await trx('tax_rates').where({ location_id: actor.locationId }).update({ is_default: false });
    }
    await trx('tax_rates')
      .where({ id })
      .update({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.rateBp !== undefined ? { rate_bp: input.rateBp } : {}),
        ...(input.isDefault !== undefined ? { is_default: input.isDefault } : {}),
      });
  });
  const row = await db('tax_rates').where({ id }).first();
  return { id, name: row.name, rateBp: Number(row.rate_bp), isDefault: Boolean(row.is_default) };
}

async function defaultTaxRateId(trx: Tx, locationId: number): Promise<number | null> {
  const row = await trx('tax_rates')
    .where({ location_id: locationId, is_default: true })
    .first('id');
  return row ? Number(row.id) : null;
}

// ---- Categories --------------------------------------------------------------------------------

async function assertValidParent(
  trx: Tx,
  locationId: number,
  parentId: number | null,
  selfId?: number,
) {
  if (parentId === null) return;
  if (parentId === selfId) throw invalidReference('parentId');
  const parent = await trx('menu_categories')
    .where({ id: parentId, location_id: locationId })
    .whereNull('deleted_at')
    .first('parent_id');
  // One level of nesting keeps the guest menu simple.
  if (!parent || parent.parent_id !== null) throw invalidReference('parentId');
  if (selfId) {
    const children = await trx('menu_categories')
      .where({ parent_id: selfId })
      .whereNull('deleted_at')
      .first('id');
    if (children) throw invalidReference('parentId');
  }
}

export async function createCategoryTx(trx: Tx, actor: MenuActor, raw: unknown): Promise<number> {
  const input = categoryInputSchema.parse(raw);
  await assertValidParent(trx, actor.locationId, input.parentId);
  const [id] = await trx('menu_categories').insert({
    location_id: actor.locationId,
    parent_id: input.parentId,
    name: input.name,
    description: input.description,
    icon: input.icon,
    available_from: input.availableFrom,
    available_to: input.availableTo,
    weekday_mask: input.weekdayMask,
    active: input.active,
    sort: await repo.nextSort(trx, 'menu_categories', {
      location_id: actor.locationId,
      deleted_at: null,
    }),
  });
  await saveTranslations(trx, 'category', Number(id), input.translations);
  return Number(id);
}

export async function createCategory(actor: MenuActor, raw: unknown) {
  const id = await db.transaction((trx) => createCategoryTx(trx, actor, raw));
  return (await repo.loadAdminMenu(db, actor.locationId)).categories.find((c) => c.id === id)!;
}

export async function updateCategory(actor: MenuActor, id: number, raw: unknown) {
  const input = categoryUpdateSchema.parse(raw);
  await assertOwned(db, 'menu_categories', [id], actor.locationId, 'id');
  await db.transaction(async (trx) => {
    if (input.parentId !== undefined) {
      await assertValidParent(trx, actor.locationId, input.parentId, id);
    }
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.parentId !== undefined) patch.parent_id = input.parentId;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.availableFrom !== undefined) patch.available_from = input.availableFrom;
    if (input.availableTo !== undefined) patch.available_to = input.availableTo;
    if (input.weekdayMask !== undefined) patch.weekday_mask = input.weekdayMask;
    if (input.active !== undefined) patch.active = input.active;
    if (Object.keys(patch).length) await trx('menu_categories').where({ id }).update(patch);
    if (input.translations) await saveTranslations(trx, 'category', id, input.translations);
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).categories.find((c) => c.id === id)!;
}

export async function deleteCategory(actor: MenuActor, id: number) {
  await assertOwned(db, 'menu_categories', [id], actor.locationId, 'id');
  const [item, child] = await Promise.all([
    db('menu_items').where({ category_id: id }).whereNull('deleted_at').first('id'),
    db('menu_categories').where({ parent_id: id }).whereNull('deleted_at').first('id'),
  ]);
  if (item || child) {
    throw AppError.conflict(
      'CATEGORY_NOT_EMPTY',
      'Move or delete the items and subcategories in this category first.',
    );
  }
  await db.transaction(async (trx) => {
    await trx('menu_categories')
      .where({ id })
      .update({ deleted_at: trx.fn.now(3) });
    await writeAudit(
      actor,
      { action: 'menu.category_deleted', entityType: 'menu_category', entityId: id },
      trx,
    );
  });
}

export async function reorderCategories(actor: MenuActor, raw: unknown) {
  const { ids } = reorderSchema.parse(raw);
  await assertOwned(db, 'menu_categories', ids, actor.locationId, 'ids');
  await db.transaction((trx) => repo.applyOrder(trx, 'menu_categories', ids));
}

// ---- Items -------------------------------------------------------------------------------------

async function assertItemReferences(
  trx: Tx,
  locationId: number,
  refs: {
    categoryId?: number;
    stationId?: number | null;
    taxRateId?: number | null;
    modifierGroupIds?: number[];
  },
) {
  await assertOwned(trx, 'menu_categories', [refs.categoryId], locationId, 'categoryId');
  await assertOwned(trx, 'stations', [refs.stationId], locationId, 'stationId');
  await assertOwned(trx, 'tax_rates', [refs.taxRateId], locationId, 'taxRateId');
  await assertOwned(
    trx,
    'modifier_groups',
    refs.modifierGroupIds ?? [],
    locationId,
    'modifierGroupIds',
  );
}

async function replaceItemLinks(
  trx: Tx,
  itemId: number,
  links: {
    allergens?: string[];
    tags?: string[];
    modifierGroupIds?: number[];
  },
) {
  if (links.allergens) {
    await trx('menu_item_allergens').where({ item_id: itemId }).delete();
    const unique = [...new Set(links.allergens)];
    if (unique.length) {
      await trx('menu_item_allergens').insert(
        unique.map((k) => ({ item_id: itemId, allergen_key: k })),
      );
    }
  }
  if (links.tags) {
    await trx('menu_item_tags').where({ item_id: itemId }).delete();
    const unique = [...new Set(links.tags)];
    if (unique.length) {
      await trx('menu_item_tags').insert(unique.map((k) => ({ item_id: itemId, tag_key: k })));
    }
  }
  if (links.modifierGroupIds) {
    await trx('menu_item_modifier_groups').where({ item_id: itemId }).delete();
    const unique = [...new Set(links.modifierGroupIds)];
    if (unique.length) {
      await trx('menu_item_modifier_groups').insert(
        unique.map((groupId, sort) => ({ item_id: itemId, group_id: groupId, sort })),
      );
    }
  }
}

type VariantInput = z.output<typeof itemInputSchema>['variants'][number];

/** Makes the item's variants match the list: updates by id, adds new ones, removes the rest. */
async function replaceVariants(trx: Tx, itemId: number, variants: VariantInput[]) {
  const existing = new Set(
    (await trx('menu_item_variants').where({ item_id: itemId }).select('id')).map((r) =>
      Number(r.id),
    ),
  );
  const kept: number[] = [];
  for (const [sort, v] of variants.entries()) {
    if (v.id !== undefined && !existing.has(v.id)) throw invalidReference('variants');
    let id = v.id;
    if (id !== undefined) {
      await trx('menu_item_variants')
        .where({ id })
        .update({ name: v.name, price_minor: v.priceMinor, sort });
    } else {
      const [newId] = await trx('menu_item_variants').insert({
        item_id: itemId,
        name: v.name,
        price_minor: v.priceMinor,
        sort,
      });
      id = Number(newId);
    }
    kept.push(id);
    await saveTranslations(trx, 'variant', id, v.translations);
  }
  const removed = [...existing].filter((id) => !kept.includes(id));
  if (removed.length) {
    await trx('menu_item_variants').whereIn('id', removed).delete();
    await deleteTranslations(trx, 'variant', removed);
  }
}

const priceSnapshot = (item: Pick<MenuItem, 'priceMinor' | 'variants'>) => ({
  priceMinor: item.priceMinor,
  variants: item.variants.map((v) => ({ name: v.name, priceMinor: v.priceMinor })),
});

export async function createItemTx(trx: Tx, actor: MenuActor, raw: unknown): Promise<number> {
  const input = itemInputSchema.parse(raw);
  await assertItemReferences(trx, actor.locationId, input);
  const [id] = await trx('menu_items').insert({
    location_id: actor.locationId,
    category_id: input.categoryId,
    station_id: input.stationId,
    tax_rate_id: input.taxRateId ?? (await defaultTaxRateId(trx, actor.locationId)),
    name: input.name,
    description: input.description,
    price_minor: input.priceMinor,
    cost_minor: input.costMinor,
    prep_minutes: input.prepMinutes,
    is_popular: input.isPopular,
    is_new: input.isNew,
    guest_visible: input.guestVisible,
    active: input.active,
    sort: await repo.nextSort(trx, 'menu_items', {
      category_id: input.categoryId,
      deleted_at: null,
    }),
  });
  const itemId = Number(id);
  await replaceItemLinks(trx, itemId, input);
  await replaceVariants(trx, itemId, input.variants);
  await saveTranslations(trx, 'item', itemId, input.translations);
  await writeAudit(
    actor,
    {
      action: 'menu.item_created',
      entityType: 'menu_item',
      entityId: itemId,
      after: {
        name: input.name,
        priceMinor: input.priceMinor,
        variants: input.variants.map((v) => ({ name: v.name, priceMinor: v.priceMinor })),
      },
    },
    trx,
  );
  return itemId;
}

export async function createItem(actor: MenuActor, raw: unknown): Promise<MenuItem> {
  const id = await db.transaction((trx) => createItemTx(trx, actor, raw));
  return getItem(db, actor.locationId, id);
}

export async function updateItemTx(trx: Tx, actor: MenuActor, id: number, raw: unknown) {
  const input = itemUpdateSchema.parse(raw);
  const before = await getItem(trx, actor.locationId, id);
  await assertItemReferences(trx, actor.locationId, input);

  const patch: Record<string, unknown> = {};
  if (input.categoryId !== undefined && input.categoryId !== before.categoryId) {
    patch.category_id = input.categoryId;
    patch.sort = await repo.nextSort(trx, 'menu_items', {
      category_id: input.categoryId,
      deleted_at: null,
    });
  }
  if (input.stationId !== undefined) patch.station_id = input.stationId;
  if (input.taxRateId !== undefined) patch.tax_rate_id = input.taxRateId;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.priceMinor !== undefined) patch.price_minor = input.priceMinor;
  if (input.costMinor !== undefined) patch.cost_minor = input.costMinor;
  if (input.prepMinutes !== undefined) patch.prep_minutes = input.prepMinutes;
  if (input.isPopular !== undefined) patch.is_popular = input.isPopular;
  if (input.isNew !== undefined) patch.is_new = input.isNew;
  if (input.guestVisible !== undefined) patch.guest_visible = input.guestVisible;
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length) await trx('menu_items').where({ id }).update(patch);

  await replaceItemLinks(trx, id, input);
  if (input.variants) await replaceVariants(trx, id, input.variants);
  if (input.translations) await saveTranslations(trx, 'item', id, input.translations);

  const after = await getItem(trx, actor.locationId, id);
  const beforePrices = priceSnapshot(before);
  const afterPrices = priceSnapshot(after);
  // Business rule 9: every price change is audited.
  if (JSON.stringify(beforePrices) !== JSON.stringify(afterPrices)) {
    await writeAudit(
      actor,
      {
        action: 'menu.price_changed',
        entityType: 'menu_item',
        entityId: id,
        before: beforePrices,
        after: afterPrices,
      },
      trx,
    );
  }
  return after;
}

export function updateItem(actor: MenuActor, id: number, raw: unknown): Promise<MenuItem> {
  return db.transaction((trx) => updateItemTx(trx, actor, id, raw));
}

export async function deleteItem(actor: MenuActor, id: number) {
  const item = await getItem(db, actor.locationId, id);
  await db.transaction(async (trx) => {
    await trx('menu_items')
      .where({ id })
      .update({ deleted_at: trx.fn.now(3) });
    await writeAudit(
      actor,
      {
        action: 'menu.item_deleted',
        entityType: 'menu_item',
        entityId: id,
        before: { name: item.name, ...priceSnapshot(item) },
      },
      trx,
    );
  });
}

export async function reorderItems(actor: MenuActor, categoryId: number, raw: unknown) {
  const { ids } = reorderSchema.parse(raw);
  await assertOwned(db, 'menu_categories', [categoryId], actor.locationId, 'categoryId');
  const inCategory = await db('menu_items')
    .whereIn('id', ids)
    .where({ category_id: categoryId, location_id: actor.locationId })
    .whereNull('deleted_at')
    .count<{ n: number }[]>('id as n');
  if (Number(inCategory[0]?.n) !== new Set(ids).size) throw invalidReference('ids');
  await db.transaction((trx) => repo.applyOrder(trx, 'menu_items', ids));
}

/** 86 an item ("today" = until 04:00 tomorrow), keep it off indefinitely, or bring it back. */
export async function setOutOfStock(actor: MenuActor, id: number, raw: unknown, now = new Date()) {
  const { mode } = outOfStockSchema.parse(raw);
  await getItem(db, actor.locationId, id);
  const until =
    mode === 'back'
      ? null
      : mode === 'today'
        ? nextLocalTime(now, OUT_OF_STOCK_RESET_TIME, TIMEZONE)
        : new Date('9999-12-31T00:00:00Z');
  await db.transaction(async (trx) => {
    await trx('menu_items').where({ id }).update({ out_of_stock_until: until });
    await writeAudit(
      actor,
      {
        action: 'menu.availability_changed',
        entityType: 'menu_item',
        entityId: id,
        after: { mode, until },
      },
      trx,
    );
  });
  const item = await getItem(db, actor.locationId, id);
  emit('menu.item_availability', actor.locationId, {
    itemId: id,
    outOfStockUntil: item.outOfStockUntil,
  });
  return item;
}

export async function setItemImage(actor: MenuActor, id: number, file: Buffer | undefined) {
  if (!file) throw new AppError(400, 'INVALID_IMAGE', 'Choose a photo to upload.');
  const item = await getItem(db, actor.locationId, id);
  const url = await storeMenuImage(file, `menu/${actor.locationId}`);
  await db('menu_items').where({ id }).update({ image_url: url });
  await removeMenuImage(item.imageUrl);
  return getItem(db, actor.locationId, id);
}

export async function removeItemImage(actor: MenuActor, id: number) {
  const item = await getItem(db, actor.locationId, id);
  await db('menu_items').where({ id }).update({ image_url: null });
  await removeMenuImage(item.imageUrl);
  return getItem(db, actor.locationId, id);
}

export async function setCategoryImage(actor: MenuActor, id: number, file: Buffer | undefined) {
  if (!file) throw new AppError(400, 'INVALID_IMAGE', 'Choose a photo to upload.');
  await assertOwned(db, 'menu_categories', [id], actor.locationId, 'id');
  const old = await db('menu_categories').where({ id }).first('image_url');
  const url = await storeMenuImage(file, `menu/${actor.locationId}`);
  await db('menu_categories').where({ id }).update({ image_url: url });
  await removeMenuImage(old?.image_url ?? null);
  return (await repo.loadAdminMenu(db, actor.locationId)).categories.find((c) => c.id === id)!;
}

// ---- Modifier groups ---------------------------------------------------------------------------

type ModifierGroupData = z.output<typeof modifierGroupInputSchema>;

async function writeModifiers(trx: Tx, groupId: number, modifiers: ModifierGroupData['modifiers']) {
  const existing = new Set(
    (await trx('modifiers').where({ group_id: groupId }).select('id')).map((r) => Number(r.id)),
  );
  const kept: number[] = [];
  for (const [sort, m] of modifiers.entries()) {
    if (m.id !== undefined && !existing.has(m.id)) throw invalidReference('modifiers');
    const row = { name: m.name, price_delta_minor: m.priceDeltaMinor, active: m.active, sort };
    let id = m.id;
    if (id !== undefined) await trx('modifiers').where({ id }).update(row);
    else id = Number((await trx('modifiers').insert({ ...row, group_id: groupId }))[0]);
    kept.push(id);
    await saveTranslations(trx, 'modifier', id, m.translations);
  }
  const removed = [...existing].filter((id) => !kept.includes(id));
  if (removed.length) {
    await trx('modifiers').whereIn('id', removed).delete();
    await deleteTranslations(trx, 'modifier', removed);
  }
}

export async function createModifierGroup(actor: MenuActor, raw: unknown) {
  const input = modifierGroupInputSchema.parse(raw);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('modifier_groups').insert({
      location_id: actor.locationId,
      name: input.name,
      min_select: input.minSelect,
      max_select: input.maxSelect,
      required: input.required,
      sort: await repo.nextSort(trx, 'modifier_groups', {
        location_id: actor.locationId,
        deleted_at: null,
      }),
    });
    const groupId = Number(newId);
    await writeModifiers(trx, groupId, input.modifiers);
    await saveTranslations(trx, 'modifier_group', groupId, input.translations);
    return groupId;
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).modifierGroups.find((g) => g.id === id)!;
}

export async function updateModifierGroup(actor: MenuActor, id: number, raw: unknown) {
  const input = modifierGroupInputSchema.parse(raw);
  await assertOwned(db, 'modifier_groups', [id], actor.locationId, 'id');
  await db.transaction(async (trx) => {
    await trx('modifier_groups').where({ id }).update({
      name: input.name,
      min_select: input.minSelect,
      max_select: input.maxSelect,
      required: input.required,
    });
    await writeModifiers(trx, id, input.modifiers);
    await saveTranslations(trx, 'modifier_group', id, input.translations);
    await writeAudit(
      actor,
      {
        action: 'menu.modifier_group_updated',
        entityType: 'modifier_group',
        entityId: id,
        after: input,
      },
      trx,
    );
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).modifierGroups.find((g) => g.id === id)!;
}

export async function deleteModifierGroup(actor: MenuActor, id: number) {
  await assertOwned(db, 'modifier_groups', [id], actor.locationId, 'id');
  await db.transaction(async (trx) => {
    await trx('menu_item_modifier_groups').where({ group_id: id }).delete();
    await trx('modifier_groups')
      .where({ id })
      .update({ deleted_at: trx.fn.now(3) });
    await writeAudit(
      actor,
      { action: 'menu.modifier_group_deleted', entityType: 'modifier_group', entityId: id },
      trx,
    );
  });
}

// ---- Price rules -------------------------------------------------------------------------------

type PriceRuleData = z.output<typeof priceRuleInputSchema>;

async function assertRuleScope(trx: Tx, actor: MenuActor, rule: PriceRuleData) {
  await assertOwned(
    trx,
    rule.scope === 'item' ? 'menu_items' : 'menu_categories',
    [rule.scopeId],
    actor.locationId,
    'scopeId',
  );
}

const ruleRow = (r: PriceRuleData) => ({
  name: r.name,
  scope: r.scope,
  scope_id: r.scopeId,
  type: r.type,
  value: r.value,
  weekday_mask: r.weekdayMask,
  time_from: r.timeFrom,
  time_to: r.timeTo,
  date_from: r.dateFrom,
  date_to: r.dateTo,
  active: r.active,
});

export async function createPriceRule(actor: MenuActor, raw: unknown) {
  const input = priceRuleInputSchema.parse(raw);
  await assertRuleScope(db, actor, input);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('price_rules').insert({
      location_id: actor.locationId,
      ...ruleRow(input),
    });
    await writeAudit(
      actor,
      {
        action: 'menu.price_rule_created',
        entityType: 'price_rule',
        entityId: Number(newId),
        after: input,
      },
      trx,
    );
    return Number(newId);
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).priceRules.find((r) => r.id === id)!;
}

export async function updatePriceRule(actor: MenuActor, id: number, raw: unknown) {
  const input = priceRuleInputSchema.parse(raw);
  const exists = await db('price_rules')
    .where({ id, location_id: actor.locationId })
    .whereNull('deleted_at')
    .first('id');
  if (!exists) throw AppError.notFound('Price rule not found');
  await assertRuleScope(db, actor, input);
  await db.transaction(async (trx) => {
    await trx('price_rules').where({ id }).update(ruleRow(input));
    await writeAudit(
      actor,
      { action: 'menu.price_rule_updated', entityType: 'price_rule', entityId: id, after: input },
      trx,
    );
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).priceRules.find((r) => r.id === id)!;
}

export async function deletePriceRule(actor: MenuActor, id: number) {
  const updated = await db('price_rules')
    .where({ id, location_id: actor.locationId })
    .whereNull('deleted_at')
    .update({ deleted_at: db.fn.now(3) });
  if (!updated) throw AppError.notFound('Price rule not found');
  await writeAudit(actor, {
    action: 'menu.price_rule_deleted',
    entityType: 'price_rule',
    entityId: id,
  });
}

// ---- Combos ------------------------------------------------------------------------------------

async function writeCombo(trx: Tx, actor: MenuActor, comboId: number, raw: unknown) {
  const input = comboInputSchema.parse(raw);
  await assertOwned(trx, 'menu_categories', [input.categoryId], actor.locationId, 'categoryId');
  await assertOwned(
    trx,
    'menu_items',
    input.slots.flatMap((s) => s.items.map((i) => i.menuItemId)),
    actor.locationId,
    'slots',
  );
  await trx('combos').where({ id: comboId }).update({
    name: input.name,
    description: input.description,
    price_minor: input.priceMinor,
    category_id: input.categoryId,
    active: input.active,
    guest_visible: input.guestVisible,
  });
  await saveTranslations(trx, 'combo', comboId, input.translations);

  const existing = (await trx('combo_slots').where({ combo_id: comboId }).select('id')).map((r) =>
    Number(r.id),
  );
  const kept: number[] = [];
  for (const [sort, slot] of input.slots.entries()) {
    if (slot.id !== undefined && !existing.includes(slot.id)) throw invalidReference('slots');
    let slotId = slot.id;
    if (slotId !== undefined) {
      await trx('combo_slots').where({ id: slotId }).update({ name: slot.name, sort });
    } else {
      slotId = Number(
        (await trx('combo_slots').insert({ combo_id: comboId, name: slot.name, sort }))[0],
      );
    }
    kept.push(slotId);
    await saveTranslations(trx, 'combo_slot', slotId, slot.translations);
    await trx('combo_slot_items').where({ slot_id: slotId }).delete();
    const unique = [...new Map(slot.items.map((i) => [i.menuItemId, i])).values()];
    await trx('combo_slot_items').insert(
      unique.map((i, itemSort) => ({
        slot_id: slotId,
        menu_item_id: i.menuItemId,
        price_delta_minor: i.priceDeltaMinor,
        sort: itemSort,
      })),
    );
  }
  const removed = existing.filter((id) => !kept.includes(id));
  if (removed.length) {
    await trx('combo_slots').whereIn('id', removed).delete();
    await deleteTranslations(trx, 'combo_slot', removed);
  }
  return input;
}

export async function createCombo(actor: MenuActor, raw: unknown) {
  const parsed = comboInputSchema.parse(raw);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('combos').insert({
      location_id: actor.locationId,
      category_id: parsed.categoryId,
      name: parsed.name,
      price_minor: parsed.priceMinor,
      sort: await repo.nextSort(trx, 'combos', { location_id: actor.locationId, deleted_at: null }),
    });
    await writeCombo(trx, actor, Number(newId), raw);
    await writeAudit(
      actor,
      {
        action: 'menu.combo_created',
        entityType: 'combo',
        entityId: Number(newId),
        after: { name: parsed.name, priceMinor: parsed.priceMinor },
      },
      trx,
    );
    return Number(newId);
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).combos.find((c) => c.id === id)!;
}

export async function updateCombo(actor: MenuActor, id: number, raw: unknown) {
  const before = (await repo.loadAdminMenu(db, actor.locationId)).combos.find((c) => c.id === id);
  if (!before) throw AppError.notFound('Combo not found');
  await db.transaction(async (trx) => {
    const input = await writeCombo(trx, actor, id, raw);
    if (input.priceMinor !== before.priceMinor) {
      await writeAudit(
        actor,
        {
          action: 'menu.price_changed',
          entityType: 'combo',
          entityId: id,
          before: { priceMinor: before.priceMinor },
          after: { priceMinor: input.priceMinor },
        },
        trx,
      );
    }
  });
  return (await repo.loadAdminMenu(db, actor.locationId)).combos.find((c) => c.id === id)!;
}

export async function deleteCombo(actor: MenuActor, id: number) {
  const updated = await db('combos')
    .where({ id, location_id: actor.locationId })
    .whereNull('deleted_at')
    .update({ deleted_at: db.fn.now(3) });
  if (!updated) throw AppError.notFound('Combo not found');
  await writeAudit(actor, { action: 'menu.combo_deleted', entityType: 'combo', entityId: id });
}
