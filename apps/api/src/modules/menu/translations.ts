import type { Knex } from 'knex';
import { isLang, type Lang, type Translations } from '@tavolina/shared';

export type TranslatableEntity =
  'category' | 'item' | 'variant' | 'modifier_group' | 'modifier' | 'combo' | 'combo_slot';
const FIELDS = ['name', 'description'] as const;

const keyOf = (type: TranslatableEntity, id: number) => `${type}:${id}`;

/** Loads translations for many entities at once, keyed "type:id". */
export async function loadTranslations(
  db: Knex,
  refs: { type: TranslatableEntity; ids: number[] }[],
): Promise<Map<string, Translations>> {
  const out = new Map<string, Translations>();
  const wanted = refs.filter((r) => r.ids.length > 0);
  if (!wanted.length) return out;

  const rows = await db('translations')
    .where((q) => {
      for (const ref of wanted) {
        q.orWhere((w) => w.where('entity_type', ref.type).whereIn('entity_id', ref.ids));
      }
    })
    .select<
      {
        entity_type: TranslatableEntity;
        entity_id: number;
        field: string;
        lang: string;
        value: string;
      }[]
    >('entity_type', 'entity_id', 'field', 'lang', 'value');

  for (const row of rows) {
    if (!isLang(row.lang) || !(FIELDS as readonly string[]).includes(row.field)) continue;
    const key = keyOf(row.entity_type, row.entity_id);
    const entry = out.get(key) ?? {};
    const lang = (entry[row.lang] ??= {});
    lang[row.field as (typeof FIELDS)[number]] = row.value;
    out.set(key, entry);
  }
  return out;
}

export function translationsFor(
  map: Map<string, Translations>,
  type: TranslatableEntity,
  id: number,
): Translations {
  return map.get(keyOf(type, id)) ?? {};
}

/** Replaces all translations of one entity. Empty strings are not stored. */
export async function saveTranslations(
  db: Knex,
  type: TranslatableEntity,
  id: number,
  translations: Translations,
): Promise<void> {
  await db('translations').where({ entity_type: type, entity_id: id }).delete();
  const rows: Record<string, unknown>[] = [];
  for (const [lang, fields] of Object.entries(translations) as [Lang, Translations[Lang]][]) {
    for (const field of FIELDS) {
      const value = fields?.[field]?.trim();
      if (value) rows.push({ entity_type: type, entity_id: id, field, lang, value });
    }
  }
  if (rows.length) await db('translations').insert(rows);
}

export async function deleteTranslations(db: Knex, type: TranslatableEntity, ids: number[]) {
  if (ids.length)
    await db('translations').where('entity_type', type).whereIn('entity_id', ids).delete();
}

/** The text in `lang`, falling back to the entity's own (main-language) text. */
export function translate(
  translations: Translations,
  lang: Lang,
  field: (typeof FIELDS)[number],
  base: string,
): string {
  return translations[lang]?.[field]?.trim() || base;
}
