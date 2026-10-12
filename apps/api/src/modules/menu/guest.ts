import {
  effectivePrice,
  inTimeWindow,
  localParts,
  pickLang,
  resolveMenuLang,
  weekdayInMask,
  type GuestCombo,
  type GuestMenu,
  type GuestMenuCategory,
  type GuestMenuItem,
  type GuestModifierGroup,
  type MenuCategory,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import * as locationRepo from '../locations/repo.js';
import * as repo from './repo.js';
import { translate } from './translations.js';

/**
 * The menu as guests see it, in one language (falling back to the main language per field):
 * only active, guest-visible, in-stock items; prices include any price rule active right now
 * in the location's timezone. Shared by the public menu endpoint and the QR app (Phase 5).
 */
export async function buildGuestMenu(
  locationId: number,
  requested: { lang?: string; acceptLanguage?: string },
  at = new Date(),
): Promise<GuestMenu> {
  const location = await locationRepo.findLocation(locationId);
  if (!location) throw AppError.notFound('Menu not found');
  const { settings } = location;

  const wanted =
    requested.lang ??
    (requested.acceptLanguage
      ? pickLang(
          requested.acceptLanguage.split(',').map((part) => part.split(';')[0]!.trim()),
          settings.defaultLang,
        )
      : undefined);
  const lang = resolveMenuLang(wanted, settings.languages, settings.defaultLang);

  const menu = await repo.loadAdminMenu(db, locationId);
  const local = localParts(at, location.timezone);
  const activeRules = menu.priceRules.filter((r) => r.active);
  const categoriesById = new Map(menu.categories.map((c) => [c.id, c]));

  const groups = new Map<number, GuestModifierGroup>();
  for (const g of menu.modifierGroups) {
    const modifiers = g.modifiers
      .filter((m) => m.active)
      .map((m) => ({
        id: m.id,
        name: translate(m.translations, lang, 'name', m.name),
        priceDeltaMinor: m.priceDeltaMinor,
      }));
    if (!modifiers.length) continue;
    groups.set(g.id, {
      id: g.id,
      name: translate(g.translations, lang, 'name', g.name),
      minSelect: g.minSelect,
      maxSelect: Math.min(g.maxSelect, modifiers.length),
      required: g.required,
      modifiers,
    });
  }

  const categoryChain = (categoryId: number): number[] => {
    const chain: number[] = [];
    let current = categoriesById.get(categoryId);
    while (current && !chain.includes(current.id)) {
      chain.push(current.id);
      current = current.parentId ? categoriesById.get(current.parentId) : undefined;
    }
    return chain;
  };

  // A category shows only if it and its parent are active.
  const visibleCategory = (c: MenuCategory | undefined): boolean =>
    Boolean(c?.active && (!c.parentId || categoriesById.get(c.parentId)?.active));

  const now = at.getTime();
  const itemsByCategory = new Map<number, GuestMenuItem[]>();
  for (const item of menu.items) {
    const outOfStock =
      item.outOfStockUntil !== null && new Date(item.outOfStockUntil).getTime() > now;
    if (!item.active || !item.guestVisible || outOfStock) continue;
    if (!visibleCategory(categoriesById.get(item.categoryId))) continue;

    const target = { itemId: item.id, categoryIds: categoryChain(item.categoryId) };
    const price = (base: number) => {
      const effective = effectivePrice(base, target, activeRules, at, location.timezone);
      return {
        priceMinor: effective.priceMinor,
        regularPriceMinor: effective.ruleId === null ? null : base,
      };
    };

    const guestItem: GuestMenuItem = {
      id: item.id,
      name: translate(item.translations, lang, 'name', item.name),
      description: translate(item.translations, lang, 'description', item.description),
      ...price(item.priceMinor),
      imageUrl: item.imageUrl,
      thumbUrl: item.thumbUrl,
      isPopular: item.isPopular,
      isNew: item.isNew,
      prepMinutes: item.prepMinutes,
      allergens: item.allergens,
      tags: item.tags,
      variants: item.variants.map((v) => ({
        id: v.id,
        name: translate(v.translations, lang, 'name', v.name),
        ...price(v.priceMinor),
      })),
      modifierGroups: item.modifierGroupIds
        .map((id) => groups.get(id))
        .filter((g): g is GuestModifierGroup => g !== undefined),
    };
    itemsByCategory.set(item.categoryId, [
      ...(itemsByCategory.get(item.categoryId) ?? []),
      guestItem,
    ]);
  }

  // Set menus: only the dishes guests can see are offered; a part with no dish hides the menu.
  const visibleItemIds = new Set([...itemsByCategory.values()].flat().map((i) => i.id));
  const combosByCategory = new Map<number, GuestCombo[]>();
  for (const combo of menu.combos) {
    if (!combo.active || !combo.guestVisible) continue;
    const slots = combo.slots.map((slot) => ({
      id: slot.id,
      name: translate(slot.translations, lang, 'name', slot.name),
      options: slot.items
        .filter((i) => visibleItemIds.has(i.menuItemId))
        .map((i) => ({ itemId: i.menuItemId, priceDeltaMinor: i.priceDeltaMinor })),
    }));
    if (slots.some((slot) => slot.options.length === 0)) continue;
    combosByCategory.set(combo.categoryId, [
      ...(combosByCategory.get(combo.categoryId) ?? []),
      {
        id: combo.id,
        name: translate(combo.translations, lang, 'name', combo.name),
        description: translate(combo.translations, lang, 'description', combo.description),
        priceMinor: combo.priceMinor,
        slots,
      },
    ]);
  }

  const hasContent = (c: MenuCategory): boolean =>
    (itemsByCategory.get(c.id)?.length ?? 0) > 0 ||
    (combosByCategory.get(c.id)?.length ?? 0) > 0 ||
    menu.categories.some(
      (child) => child.parentId === c.id && visibleCategory(child) && hasContent(child),
    );

  const categories: GuestMenuCategory[] = menu.categories
    .filter((c) => visibleCategory(c) && hasContent(c))
    .map((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: translate(c.translations, lang, 'name', c.name),
      description: translate(c.translations, lang, 'description', c.description),
      icon: c.icon,
      imageUrl: c.imageUrl,
      availableNow:
        weekdayInMask(local.weekday, c.weekdayMask) &&
        inTimeWindow(local.minutes, c.availableFrom, c.availableTo),
      availableFrom: c.availableFrom,
      availableTo: c.availableTo,
      items: itemsByCategory.get(c.id) ?? [],
      combos: combosByCategory.get(c.id) ?? [],
    }));

  return {
    location: {
      id: location.id,
      name: location.name,
      currencyDisplay: settings.currencyDisplay,
      languages: settings.languages,
      defaultLang: settings.defaultLang,
    },
    lang,
    generatedAt: at.toISOString(),
    categories,
  };
}
