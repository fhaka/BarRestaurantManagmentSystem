import type { Knex } from 'knex';
import type {
  AdminMenu,
  Allergen,
  CategoryIcon,
  DietaryTag,
  MenuCategory,
  MenuItem,
  MenuModifierGroup,
  PriceRule,
  Station,
  StationType,
  TaxRate,
} from '@tavolina/shared';
import { thumbUrlFor } from '../../lib/images.js';
import { loadTranslations, translationsFor } from './translations.js';

const bool = (v: unknown) => Boolean(v);
const num = (v: unknown) => Number(v);
const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** Loads everything the menu editor needs for one location in a handful of queries. */
export async function loadAdminMenu(db: Knex, locationId: number): Promise<AdminMenu> {
  const [categoryRows, itemRows, groupRows, ruleRows, stationRows, taxRows] = await Promise.all([
    db('menu_categories')
      .where({ location_id: locationId })
      .whereNull('deleted_at')
      .orderBy([{ column: 'sort' }, { column: 'id' }]),
    db('menu_items')
      .where({ location_id: locationId })
      .whereNull('deleted_at')
      .orderBy([{ column: 'category_id' }, { column: 'sort' }, { column: 'id' }]),
    db('modifier_groups')
      .where({ location_id: locationId })
      .whereNull('deleted_at')
      .orderBy([{ column: 'sort' }, { column: 'id' }]),
    db('price_rules').where({ location_id: locationId }).whereNull('deleted_at').orderBy('id'),
    db('stations')
      .where({ location_id: locationId })
      .orderBy([{ column: 'sort' }, { column: 'id' }]),
    db('tax_rates').where({ location_id: locationId }).orderBy('id'),
  ]);

  const itemIds = itemRows.map((r) => num(r.id));
  const groupIds = groupRows.map((r) => num(r.id));

  const [variantRows, allergenRows, tagRows, linkRows, modifierRows] = await Promise.all([
    itemIds.length
      ? db('menu_item_variants')
          .whereIn('item_id', itemIds)
          .orderBy([{ column: 'sort' }, { column: 'id' }])
      : [],
    itemIds.length ? db('menu_item_allergens').whereIn('item_id', itemIds) : [],
    itemIds.length ? db('menu_item_tags').whereIn('item_id', itemIds) : [],
    itemIds.length
      ? db('menu_item_modifier_groups').whereIn('item_id', itemIds).orderBy('sort')
      : [],
    groupIds.length
      ? db('modifiers')
          .whereIn('group_id', groupIds)
          .orderBy([{ column: 'sort' }, { column: 'id' }])
      : [],
  ]);

  const translations = await loadTranslations(db, [
    { type: 'category', ids: categoryRows.map((r) => num(r.id)) },
    { type: 'item', ids: itemIds },
    { type: 'variant', ids: variantRows.map((r) => num(r.id)) },
    { type: 'modifier_group', ids: groupIds },
    { type: 'modifier', ids: modifierRows.map((r) => num(r.id)) },
  ]);

  const byItem = <T>(rows: Record<string, unknown>[], map: (r: Record<string, unknown>) => T) => {
    const out = new Map<number, T[]>();
    for (const r of rows) {
      const id = num(r.item_id);
      out.set(id, [...(out.get(id) ?? []), map(r)]);
    }
    return out;
  };
  const variants = byItem(variantRows, (r) => ({
    id: num(r.id),
    name: String(r.name),
    priceMinor: num(r.price_minor),
    translations: translationsFor(translations, 'variant', num(r.id)),
  }));
  const allergens = byItem(allergenRows, (r) => r.allergen_key as Allergen);
  const tags = byItem(tagRows, (r) => r.tag_key as DietaryTag);
  const groupLinks = byItem(linkRows, (r) => num(r.group_id));

  const categories: MenuCategory[] = categoryRows.map((r) => ({
    id: num(r.id),
    parentId: r.parent_id === null ? null : num(r.parent_id),
    name: r.name,
    description: r.description,
    icon: (r.icon as CategoryIcon | null) ?? null,
    imageUrl: r.image_url ?? null,
    availableFrom: r.available_from ?? null,
    availableTo: r.available_to ?? null,
    weekdayMask: num(r.weekday_mask),
    active: bool(r.active),
    sort: num(r.sort),
    translations: translationsFor(translations, 'category', num(r.id)),
  }));

  const items: MenuItem[] = itemRows.map((r) => {
    const id = num(r.id);
    return {
      id,
      categoryId: num(r.category_id),
      stationId: r.station_id === null ? null : num(r.station_id),
      name: r.name,
      description: r.description,
      priceMinor: num(r.price_minor),
      costMinor: r.cost_minor === null ? null : num(r.cost_minor),
      taxRateId: r.tax_rate_id === null ? null : num(r.tax_rate_id),
      prepMinutes: r.prep_minutes === null ? null : num(r.prep_minutes),
      imageUrl: r.image_url ?? null,
      thumbUrl: thumbUrlFor(r.image_url ?? null),
      isPopular: bool(r.is_popular),
      isNew: bool(r.is_new),
      guestVisible: bool(r.guest_visible),
      active: bool(r.active),
      outOfStockUntil: r.out_of_stock_until ? (r.out_of_stock_until as Date).toISOString() : null,
      sort: num(r.sort),
      allergens: allergens.get(id) ?? [],
      tags: tags.get(id) ?? [],
      modifierGroupIds: groupLinks.get(id) ?? [],
      variants: variants.get(id) ?? [],
      translations: translationsFor(translations, 'item', id),
    };
  });

  const modifiersByGroup = new Map<number, MenuModifierGroup['modifiers']>();
  for (const r of modifierRows) {
    const gid = num(r.group_id);
    modifiersByGroup.set(gid, [
      ...(modifiersByGroup.get(gid) ?? []),
      {
        id: num(r.id),
        name: r.name,
        priceDeltaMinor: num(r.price_delta_minor),
        active: bool(r.active),
        translations: translationsFor(translations, 'modifier', num(r.id)),
      },
    ]);
  }
  const modifierGroups: MenuModifierGroup[] = groupRows.map((r) => ({
    id: num(r.id),
    name: r.name,
    minSelect: num(r.min_select),
    maxSelect: num(r.max_select),
    required: bool(r.required),
    translations: translationsFor(translations, 'modifier_group', num(r.id)),
    modifiers: modifiersByGroup.get(num(r.id)) ?? [],
  }));

  const priceRules: PriceRule[] = ruleRows.map((r) => ({
    id: num(r.id),
    name: r.name,
    scope: r.scope,
    scopeId: num(r.scope_id),
    type: r.type,
    value: num(r.value),
    weekdayMask: num(r.weekday_mask),
    timeFrom: r.time_from ?? null,
    timeTo: r.time_to ?? null,
    dateFrom: dateOnly(r.date_from),
    dateTo: dateOnly(r.date_to),
    active: bool(r.active),
  }));

  const stations: Station[] = stationRows.map((r) => ({
    id: num(r.id),
    name: r.name,
    type: r.type as StationType,
    active: bool(r.active),
  }));
  const taxRates: TaxRate[] = taxRows.map((r) => ({
    id: num(r.id),
    name: r.name,
    rateBp: num(r.rate_bp),
    isDefault: bool(r.is_default),
  }));

  return { categories, items, modifierGroups, priceRules, stations, taxRates };
}

/** Ids from `ids` that do NOT belong to the location (or are deleted). */
export async function foreignIds(
  db: Knex,
  table: 'menu_categories' | 'menu_items' | 'stations' | 'tax_rates' | 'modifier_groups',
  ids: number[],
  locationId: number,
): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const query = db(table).whereIn('id', unique).where('location_id', locationId);
  if (table !== 'stations' && table !== 'tax_rates') query.whereNull('deleted_at');
  const found = new Set((await query.select('id')).map((r) => num(r.id)));
  return unique.filter((id) => !found.has(id));
}

export async function nextSort(
  db: Knex,
  table: 'menu_categories' | 'menu_items' | 'modifier_groups' | 'stations',
  where: Record<string, unknown>,
): Promise<number> {
  const row = await db(table).where(where).max<{ max: number | null }>('sort as max').first();
  return (row?.max ?? -1) + 1;
}

/** Writes `sort = position` for the given ids, in order. */
export async function applyOrder(
  db: Knex,
  table: 'menu_categories' | 'menu_items',
  ids: number[],
): Promise<void> {
  await Promise.all(ids.map((id, sort) => db(table).where({ id }).update({ sort })));
}
