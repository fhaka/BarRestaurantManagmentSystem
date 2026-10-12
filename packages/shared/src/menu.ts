import { z } from 'zod';
import { langSchema, type Lang } from './i18n.js';
import { ALL_WEEKDAYS_MASK } from './time.js';
import { ALLERGENS, DIETARY_TAGS, type Allergen, type DietaryTag } from './allergens.js';

export * from './allergens.js';

export const STATION_TYPES = ['kitchen', 'bar', 'other'] as const;
export type StationType = (typeof STATION_TYPES)[number];

/** Category icons the menu editor offers (lucide icon names, mapped in the UI). */
export const CATEGORY_ICONS = [
  'coffee',
  'cup-soda',
  'beer',
  'wine',
  'martini',
  'croissant',
  'egg',
  'salad',
  'soup',
  'utensils',
  'beef',
  'fish',
  'pizza',
  'sandwich',
  'cake',
  'ice-cream',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

// ---- Building blocks -------------------------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time' });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date' });
const minor = z.number().int().min(0).max(100_000_000);
const weekdayMask = z.number().int().min(0).max(ALL_WEEKDAYS_MASK);
const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(1000);

/** Per-language overrides. The entity's own name/description are the base (main) language. */
export const translationSchema = z.object({
  name: z.string().trim().max(160).optional(),
  description: z.string().trim().max(1000).optional(),
});
export const translationsSchema = z.partialRecord(langSchema, translationSchema);
export type Translations = Partial<Record<Lang, { name?: string; description?: string }>>;

// ---- Setup: stations & tax rates -------------------------------------------------------------

export const stationInputSchema = z.object({
  name,
  type: z.enum(STATION_TYPES).default('kitchen'),
  active: z.boolean().default(true),
});
export type StationInput = z.input<typeof stationInputSchema>;

export const taxRateInputSchema = z.object({
  name,
  /** Basis points: 2000 = 20% (Albanian standard VAT). */
  rateBp: z.number().int().min(0).max(10_000),
  isDefault: z.boolean().default(false),
});
export type TaxRateInput = z.input<typeof taxRateInputSchema>;

// ---- Categories ------------------------------------------------------------------------------

export const categoryInputSchema = z
  .object({
    name,
    description: description.default(''),
    parentId: z.number().int().positive().nullable().default(null),
    icon: z.enum(CATEGORY_ICONS).nullable().default(null),
    /** Schedule, e.g. breakfast 07:00–11:30. Both or neither. */
    availableFrom: hhmm.nullable().default(null),
    availableTo: hhmm.nullable().default(null),
    weekdayMask: weekdayMask.default(ALL_WEEKDAYS_MASK),
    active: z.boolean().default(true),
    translations: translationsSchema.default({}),
  })
  .refine((c) => (c.availableFrom === null) === (c.availableTo === null), {
    message: 'timeRange',
    path: ['availableTo'],
  });
export type CategoryInput = z.input<typeof categoryInputSchema>;
export const categoryUpdateSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    parentId: z.number().int().positive().nullable().optional(),
    icon: z.enum(CATEGORY_ICONS).nullable().optional(),
    availableFrom: hhmm.nullable().optional(),
    availableTo: hhmm.nullable().optional(),
    weekdayMask: weekdayMask.optional(),
    active: z.boolean().optional(),
    translations: translationsSchema.optional(),
  })
  .refine(
    (c) =>
      c.availableFrom === undefined ||
      c.availableTo === undefined ||
      (c.availableFrom === null) === (c.availableTo === null),
    { message: 'timeRange', path: ['availableTo'] },
  );
export type CategoryUpdate = z.input<typeof categoryUpdateSchema>;

export const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

// ---- Items -----------------------------------------------------------------------------------

export const variantInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name,
  priceMinor: minor,
  translations: translationsSchema.default({}),
});

const itemFields = {
  categoryId: z.number().int().positive(),
  stationId: z.number().int().positive().nullable(),
  name,
  description: description.default(''),
  /** Tax-inclusive price in minor units. With variants, this is the "from" price. */
  priceMinor: minor,
  /** Manual cost; replaced by the recipe cost once inventory exists (Phase 7). */
  costMinor: minor.nullable().default(null),
  taxRateId: z.number().int().positive().nullable().default(null),
  prepMinutes: z.number().int().min(0).max(240).nullable().default(null),
  isPopular: z.boolean().default(false),
  isNew: z.boolean().default(false),
  guestVisible: z.boolean().default(true),
  active: z.boolean().default(true),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  tags: z.array(z.enum(DIETARY_TAGS)).default([]),
  modifierGroupIds: z.array(z.number().int().positive()).max(20).default([]),
  /** Full list: variants missing from it are removed. */
  variants: z.array(variantInputSchema).max(20).default([]),
  translations: translationsSchema.default({}),
};

export const itemInputSchema = z.object(itemFields);
export type ItemInput = z.input<typeof itemInputSchema>;

export const itemUpdateSchema = z.object({
  categoryId: itemFields.categoryId.optional(),
  stationId: itemFields.stationId.optional(),
  name: name.optional(),
  description: description.optional(),
  priceMinor: minor.optional(),
  costMinor: minor.nullable().optional(),
  taxRateId: z.number().int().positive().nullable().optional(),
  prepMinutes: z.number().int().min(0).max(240).nullable().optional(),
  isPopular: z.boolean().optional(),
  isNew: z.boolean().optional(),
  guestVisible: z.boolean().optional(),
  active: z.boolean().optional(),
  allergens: z.array(z.enum(ALLERGENS)).optional(),
  tags: z.array(z.enum(DIETARY_TAGS)).optional(),
  modifierGroupIds: z.array(z.number().int().positive()).max(20).optional(),
  variants: z.array(variantInputSchema).max(20).optional(),
  translations: translationsSchema.optional(),
});
export type ItemUpdate = z.input<typeof itemUpdateSchema>;

/** 86: "today" returns at 04:00 local tomorrow; "indefinite" until turned back on. */
export const OUT_OF_STOCK_MODES = ['today', 'indefinite', 'back'] as const;
export const outOfStockSchema = z.object({ mode: z.enum(OUT_OF_STOCK_MODES) });
export type OutOfStockMode = (typeof OUT_OF_STOCK_MODES)[number];
/** Local time when "out of stock today" items come back. */
export const OUT_OF_STOCK_RESET_TIME = '04:00';

// ---- Modifier groups -------------------------------------------------------------------------

export const modifierInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name,
  /** May be negative ("no cheese -50 L"). */
  priceDeltaMinor: z.number().int().min(-10_000_000).max(10_000_000).default(0),
  active: z.boolean().default(true),
  translations: translationsSchema.default({}),
});

export const modifierGroupInputSchema = z
  .object({
    name,
    minSelect: z.number().int().min(0).max(20).default(0),
    maxSelect: z.number().int().min(1).max(20).default(1),
    required: z.boolean().default(false),
    translations: translationsSchema.default({}),
    modifiers: z.array(modifierInputSchema).min(1).max(30),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: 'minMax', path: ['minSelect'] })
  .refine((g) => !g.required || g.minSelect >= 1, { message: 'requiredMin', path: ['minSelect'] })
  .refine((g) => g.maxSelect <= g.modifiers.length, {
    message: 'maxOptions',
    path: ['maxSelect'],
  });
export type ModifierGroupInput = z.input<typeof modifierGroupInputSchema>;

// ---- Price rules -----------------------------------------------------------------------------

export const PRICE_RULE_SCOPES = ['item', 'category'] as const;
/** percent: value in basis points off (2000 = 20% off). fixed: value in minor units off. */
export const PRICE_RULE_TYPES = ['percent', 'fixed'] as const;

export const priceRuleInputSchema = z
  .object({
    name,
    scope: z.enum(PRICE_RULE_SCOPES),
    scopeId: z.number().int().positive(),
    type: z.enum(PRICE_RULE_TYPES),
    value: z.number().int().min(1).max(100_000_000),
    weekdayMask: weekdayMask.default(ALL_WEEKDAYS_MASK),
    timeFrom: hhmm.nullable().default(null),
    timeTo: hhmm.nullable().default(null),
    dateFrom: isoDate.nullable().default(null),
    dateTo: isoDate.nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((r) => r.type !== 'percent' || r.value <= 10_000, {
    message: 'percentMax',
    path: ['value'],
  })
  .refine((r) => (r.timeFrom === null) === (r.timeTo === null), {
    message: 'timeRange',
    path: ['timeTo'],
  })
  .refine((r) => !r.dateFrom || !r.dateTo || r.dateFrom <= r.dateTo, {
    message: 'dateRange',
    path: ['dateTo'],
  });
export type PriceRuleInput = z.input<typeof priceRuleInputSchema>;

// ---- Combos ("Menu dreke") --------------------------------------------------------------------

export const comboSlotInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name,
  translations: translationsSchema.default({}),
  /** The dishes the guest chooses one of, with an optional surcharge. */
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        priceDeltaMinor: z.number().int().min(0).max(10_000_000).default(0),
      }),
    )
    .min(1)
    .max(40),
});

export const comboInputSchema = z.object({
  name,
  description: description.default(''),
  /** Fixed price for the whole menu, tax-inclusive. */
  priceMinor: minor,
  /** Where the combo is listed on the order screen and guest menu. */
  categoryId: z.number().int().positive(),
  active: z.boolean().default(true),
  guestVisible: z.boolean().default(true),
  translations: translationsSchema.default({}),
  slots: z.array(comboSlotInputSchema).min(1).max(8),
});
export type ComboInput = z.input<typeof comboInputSchema>;

export interface MenuComboSlot {
  id: number;
  name: string;
  translations: Translations;
  items: { menuItemId: number; priceDeltaMinor: number }[];
}

export interface MenuCombo {
  id: number;
  name: string;
  description: string;
  priceMinor: number;
  categoryId: number;
  active: boolean;
  guestVisible: boolean;
  translations: Translations;
  slots: MenuComboSlot[];
}

// ---- Import ----------------------------------------------------------------------------------

export const menuImportSchema = z.object({
  csv: z.string().min(1).max(900_000),
  dryRun: z.boolean().default(true),
});

/** Row problem codes; apps translate them (`message` is an English fallback). */
export const IMPORT_ERROR_CODES = [
  'parse',
  'missingColumn',
  'required',
  'unknownId',
  'duplicate',
  'invalidPrice',
  'unknownStation',
  'unknownTaxRate',
  'invalidPrep',
  'unknownValues',
  'invalidBoolean',
  'invalidRow',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export interface MenuImportError {
  row: number;
  column?: string;
  code: ImportErrorCode;
  /** The offending value(s), for the message. */
  value?: string;
  message: string;
}

export interface MenuImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  categoriesCreated: number;
  errors: MenuImportError[];
}

// ---- Response types: admin menu (staff) ------------------------------------------------------

export interface Station {
  id: number;
  name: string;
  type: StationType;
  active: boolean;
}

export interface TaxRate {
  id: number;
  name: string;
  rateBp: number;
  isDefault: boolean;
}

export interface MenuCategory {
  id: number;
  parentId: number | null;
  name: string;
  description: string;
  icon: CategoryIcon | null;
  imageUrl: string | null;
  availableFrom: string | null;
  availableTo: string | null;
  weekdayMask: number;
  active: boolean;
  sort: number;
  translations: Translations;
}

export interface MenuVariant {
  id: number;
  name: string;
  priceMinor: number;
  translations: Translations;
}

export interface MenuItem {
  id: number;
  categoryId: number;
  stationId: number | null;
  name: string;
  description: string;
  priceMinor: number;
  /** Hidden from roles without menu.edit. */
  costMinor: number | null;
  taxRateId: number | null;
  prepMinutes: number | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  isPopular: boolean;
  isNew: boolean;
  guestVisible: boolean;
  active: boolean;
  /** ISO time; in the future = out of stock ("86"). */
  outOfStockUntil: string | null;
  sort: number;
  allergens: Allergen[];
  tags: DietaryTag[];
  modifierGroupIds: number[];
  variants: MenuVariant[];
  translations: Translations;
}

export interface MenuModifier {
  id: number;
  name: string;
  priceDeltaMinor: number;
  active: boolean;
  translations: Translations;
}

export interface MenuModifierGroup {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  translations: Translations;
  modifiers: MenuModifier[];
}

export interface PriceRule {
  id: number;
  name: string;
  scope: (typeof PRICE_RULE_SCOPES)[number];
  scopeId: number;
  type: (typeof PRICE_RULE_TYPES)[number];
  value: number;
  weekdayMask: number;
  timeFrom: string | null;
  timeTo: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  active: boolean;
}

export interface AdminMenu {
  categories: MenuCategory[];
  items: MenuItem[];
  combos: MenuCombo[];
  modifierGroups: MenuModifierGroup[];
  priceRules: PriceRule[];
  stations: Station[];
  taxRates: TaxRate[];
}

// ---- Response types: guest menu --------------------------------------------------------------

export interface GuestModifierGroup {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  modifiers: { id: number; name: string; priceDeltaMinor: number }[];
}

export interface GuestMenuItem {
  id: number;
  name: string;
  description: string;
  /** Price now, including any active happy hour. */
  priceMinor: number;
  /** Set when a price rule lowers the price now. */
  regularPriceMinor: number | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  isPopular: boolean;
  isNew: boolean;
  prepMinutes: number | null;
  allergens: Allergen[];
  tags: DietaryTag[];
  variants: { id: number; name: string; priceMinor: number; regularPriceMinor: number | null }[];
  modifierGroups: GuestModifierGroup[];
}

export interface GuestMenuCategory {
  id: number;
  parentId: number | null;
  name: string;
  description: string;
  icon: CategoryIcon | null;
  imageUrl: string | null;
  /** False outside the category's schedule (e.g. breakfast after 11:30). */
  availableNow: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  items: GuestMenuItem[];
  /** Set menus listed in this category. */
  combos: GuestCombo[];
}

/** A set menu for guests; slot options point at items elsewhere in the guest menu. */
export interface GuestCombo {
  id: number;
  name: string;
  description: string;
  priceMinor: number;
  slots: { id: number; name: string; options: { itemId: number; priceDeltaMinor: number }[] }[];
}

export interface GuestMenu {
  location: {
    id: number;
    name: string;
    currencyDisplay: 'L' | 'ALL';
    languages: Lang[];
    defaultLang: Lang;
  };
  /** The language the content is in (requested, if the location offers it). */
  lang: Lang;
  generatedAt: string;
  categories: GuestMenuCategory[];
}

/** Picks the best supported language: requested if offered, else the location default. */
export function resolveMenuLang(
  requested: unknown,
  offered: readonly Lang[],
  fallback: Lang,
): Lang {
  return typeof requested === 'string' && (offered as readonly string[]).includes(requested)
    ? (requested as Lang)
    : fallback;
}
