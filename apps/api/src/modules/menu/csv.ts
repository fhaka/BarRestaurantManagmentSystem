import Papa from 'papaparse';
import {
  ALLERGENS,
  DIETARY_TAGS,
  lekToMinor,
  menuImportSchema,
  minorToLek,
  type Allergen,
  type DietaryTag,
  type ImportErrorCode,
  type MenuImportResult,
  type MenuItem,
  type Translations,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import * as repo from './repo.js';
import { createCategoryTx, createItemTx, updateItemTx, type MenuActor } from './service.js';

/**
 * CSV columns. Prices are in lek (decimals allowed). Lists use ";". Booleans: 1/0, yes/no, po/jo.
 * Variants and modifier groups are not part of the CSV; edit them in the app.
 */
export const CSV_COLUMNS = [
  'id',
  'category',
  'name',
  'name_en',
  'name_it',
  'description',
  'description_en',
  'description_it',
  'price',
  'cost',
  'station',
  'tax_rate',
  'prep_minutes',
  'allergens',
  'tags',
  'popular',
  'new',
  'guest_visible',
  'active',
] as const;
type Column = (typeof CSV_COLUMNS)[number];
const OTHER_LANGS = ['en', 'it'] as const;

const yesNo = (v: boolean) => (v ? '1' : '0');

export async function exportMenuCsv(locationId: number): Promise<string> {
  const menu = await repo.loadAdminMenu(db, locationId);
  const category = new Map(menu.categories.map((c) => [c.id, c.name]));
  const station = new Map(menu.stations.map((s) => [s.id, s.name]));
  const tax = new Map(menu.taxRates.map((t) => [t.id, t.name]));
  const categoryOrder = new Map(menu.categories.map((c, i) => [c.id, i]));

  const rows = [...menu.items]
    .sort(
      (a, b) =>
        (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0) ||
        a.sort - b.sort,
    )
    .map((item): Record<Column, string | number> => ({
      id: item.id,
      category: category.get(item.categoryId) ?? '',
      name: item.name,
      name_en: item.translations.en?.name ?? '',
      name_it: item.translations.it?.name ?? '',
      description: item.description,
      description_en: item.translations.en?.description ?? '',
      description_it: item.translations.it?.description ?? '',
      price: minorToLek(item.priceMinor),
      cost: item.costMinor === null ? '' : minorToLek(item.costMinor),
      station: item.stationId ? (station.get(item.stationId) ?? '') : '',
      tax_rate: item.taxRateId ? (tax.get(item.taxRateId) ?? '') : '',
      prep_minutes: item.prepMinutes ?? '',
      allergens: item.allergens.join(';'),
      tags: item.tags.join(';'),
      popular: yesNo(item.isPopular),
      new: yesNo(item.isNew),
      guest_visible: yesNo(item.guestVisible),
      active: yesNo(item.active),
    }));

  // A BOM makes Excel open UTF-8 (ë, ç) correctly.
  return `\uFEFF${Papa.unparse({ fields: [...CSV_COLUMNS], data: rows.map((r) => CSV_COLUMNS.map((c) => r[c])) })}`;
}

// ---- Import ------------------------------------------------------------------------------------

type RowError = MenuImportResult['errors'][number];

function parseLek(value: string): number | null {
  const cleaned = value.replace(/\s|\u00A0|L$|ALL$/gi, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return lekToMinor(Number(cleaned));
}

function parseBool(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (['1', 'yes', 'y', 'true', 'po', 'si', 'sì'].includes(v)) return true;
  if (['0', 'no', 'n', 'false', 'jo'].includes(v)) return false;
  return null;
}

function parseList<T extends string>(
  value: string,
  allowed: readonly T[],
): { ok: T[]; bad: string[] } {
  const parts = value
    .split(/[;,|]/)
    .map((p) =>
      p
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    )
    .filter(Boolean);
  return {
    ok: parts.filter((p): p is T => (allowed as readonly string[]).includes(p)),
    bad: parts.filter((p) => !(allowed as readonly string[]).includes(p)),
  };
}

interface PlannedRow {
  row: number;
  existing: MenuItem | null;
  categoryName: string;
  /** Fields to set; only columns present in the file are included. */
  fields: Record<string, unknown>;
  translations: Translations | null;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('sq');

/**
 * Validates every row first. With dryRun (default) nothing is written. Otherwise all rows are
 * applied in one transaction — any error means nothing changes.
 */
export async function importMenuCsv(actor: MenuActor, raw: unknown): Promise<MenuImportResult> {
  const { csv, dryRun } = menuImportSchema.parse(raw);
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const headers = new Set(parsed.meta.fields ?? []);
  // "Couldn't detect the delimiter" just means a one-column file; Papa falls back to commas.
  const errors: RowError[] = parsed.errors
    .filter((e) => e.type !== 'Delimiter')
    .map((e) => ({ row: (e.row ?? 0) + 2, code: 'parse', message: e.message }));
  for (const required of ['category', 'name', 'price'] as const) {
    if (!headers.has(required))
      errors.push({
        row: 1,
        column: required,
        code: 'missingColumn',
        value: required,
        message: `Missing column "${required}"`,
      });
  }
  if (errors.length) return { dryRun, created: 0, updated: 0, categoriesCreated: 0, errors };

  const menu = await repo.loadAdminMenu(db, actor.locationId);
  const itemsById = new Map(menu.items.map((i) => [i.id, i]));
  const categoryByName = new Map(menu.categories.map((c) => [norm(c.name), c]));
  const itemByKey = new Map(
    menu.items.map((i) => [
      `${norm(menu.categories.find((c) => c.id === i.categoryId)?.name ?? '')}|${norm(i.name)}`,
      i,
    ]),
  );
  const stationByName = new Map(menu.stations.map((s) => [norm(s.name), s.id]));
  const taxByName = new Map(menu.taxRates.map((t) => [norm(t.name), t.id]));

  const plan: PlannedRow[] = [];
  const newCategories = new Set<string>();
  const seenKeys = new Set<string>();

  parsed.data.forEach((record, index) => {
    const row = index + 2; // header is row 1
    const get = (c: Column) => (headers.has(c) ? (record[c] ?? '').trim() : undefined);
    const fail = (column: Column, code: ImportErrorCode, message: string, value?: string) =>
      errors.push({ row, column, code, message, ...(value !== undefined ? { value } : {}) });

    const categoryName = get('category') ?? '';
    const name = get('name') ?? '';
    if (!categoryName) fail('category', 'required', 'Category is required');
    if (!name) fail('name', 'required', 'Name is required');

    let existing: MenuItem | null = null;
    const idText = get('id');
    if (idText) {
      existing = itemsById.get(Number(idText)) ?? null;
      if (!existing) fail('id', 'unknownId', `No item with id ${idText} on this menu`, idText);
    } else if (categoryName && name) {
      existing = itemByKey.get(`${norm(categoryName)}|${norm(name)}`) ?? null;
    }
    const key = existing ? `id:${existing.id}` : `${norm(categoryName)}|${norm(name)}`;
    if (seenKeys.has(key)) fail('name', 'duplicate', 'This item appears twice in the file', name);
    seenKeys.add(key);

    const fields: Record<string, unknown> = { name };
    const price = parseLek(get('price') ?? '');
    if (price === null) {
      fail(
        'price',
        'invalidPrice',
        'Price must be a number in lek, e.g. 250 or 12.50',
        get('price'),
      );
    } else fields.priceMinor = price;

    const description = get('description');
    if (description !== undefined) fields.description = description;
    const cost = get('cost');
    if (cost !== undefined) {
      const parsedCost = cost === '' ? null : parseLek(cost);
      if (cost !== '' && parsedCost === null) {
        fail('cost', 'invalidPrice', 'Cost must be a number in lek', cost);
      } else fields.costMinor = parsedCost;
    }
    const station = get('station');
    if (station !== undefined) {
      const id = station === '' ? null : stationByName.get(norm(station));
      if (id === undefined)
        fail('station', 'unknownStation', `Unknown station "${station}"`, station);
      else fields.stationId = id;
    } else if (!existing) {
      fields.stationId = null;
    }
    const taxRate = get('tax_rate');
    if (taxRate) {
      const id = taxByName.get(norm(taxRate));
      if (id === undefined) {
        fail('tax_rate', 'unknownTaxRate', `Unknown tax rate "${taxRate}"`, taxRate);
      } else fields.taxRateId = id;
    }
    const prep = get('prep_minutes');
    if (prep !== undefined) {
      const minutes = prep === '' ? null : Number(prep);
      if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 240)) {
        fail('prep_minutes', 'invalidPrep', 'Prep time must be 0–240 minutes', prep);
      } else fields.prepMinutes = minutes;
    }
    for (const [column, allowed, field] of [
      ['allergens', ALLERGENS, 'allergens'],
      ['tags', DIETARY_TAGS, 'tags'],
    ] as const) {
      const value = get(column);
      if (value === undefined) continue;
      const list = parseList<Allergen | DietaryTag>(value, allowed);
      if (list.bad.length) {
        fail(
          column,
          'unknownValues',
          `Unknown ${column}: ${list.bad.join(', ')}`,
          list.bad.join(', '),
        );
      } else fields[field] = list.ok;
    }
    for (const [column, field] of [
      ['popular', 'isPopular'],
      ['new', 'isNew'],
      ['guest_visible', 'guestVisible'],
      ['active', 'active'],
    ] as const) {
      const value = get(column);
      if (value === undefined || value === '') continue;
      const b = parseBool(value);
      if (b === null) fail(column, 'invalidBoolean', 'Use 1 or 0 (yes/no)', value);
      else fields[field] = b;
    }

    let translations: Translations | null = null;
    const hasTranslationColumns = OTHER_LANGS.some(
      (l) => headers.has(`name_${l}`) || headers.has(`description_${l}`),
    );
    if (hasTranslationColumns) {
      translations = { ...(existing?.translations ?? {}) };
      for (const lang of OTHER_LANGS) {
        const tName = get(`name_${lang}`);
        const tDesc = get(`description_${lang}`);
        translations[lang] = {
          name: tName ?? existing?.translations[lang]?.name ?? '',
          description: tDesc ?? existing?.translations[lang]?.description ?? '',
        };
      }
    }

    if (categoryName && !categoryByName.has(norm(categoryName)))
      newCategories.add(norm(categoryName));
    plan.push({ row, existing, categoryName, fields, translations });
  });

  const result: MenuImportResult = {
    dryRun,
    created: plan.filter((p) => !p.existing).length,
    updated: plan.filter((p) => p.existing).length,
    categoriesCreated: newCategories.size,
    errors,
  };
  if (errors.length || dryRun) return result;

  await db.transaction(async (trx) => {
    const categoryIds = new Map([...categoryByName].map(([k, c]) => [k, c.id]));
    for (const p of plan) {
      let categoryId = categoryIds.get(norm(p.categoryName));
      if (categoryId === undefined) {
        categoryId = await createCategoryTx(trx, actor, { name: p.categoryName.trim() });
        categoryIds.set(norm(p.categoryName), categoryId);
      }
      const payload = {
        ...p.fields,
        categoryId,
        ...(p.translations ? { translations: p.translations } : {}),
      };
      try {
        if (p.existing) await updateItemTx(trx, actor, p.existing.id, payload);
        else await createItemTx(trx, actor, payload);
      } catch (err) {
        // Validation that only the full schema catches (e.g. name too long): report the row.
        throw new AppError(422, 'IMPORT_INVALID', 'Some rows could not be imported.', {
          errors: [
            {
              row: p.row,
              code: 'invalidRow',
              message: err instanceof Error ? err.message : 'Invalid row',
            },
          ],
        });
      }
    }
  });
  return result;
}
