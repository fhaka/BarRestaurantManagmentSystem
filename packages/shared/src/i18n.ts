import { z } from 'zod';

/** Languages supported across the product. Albanian is the source language. */
export const LANGS = ['sq', 'en', 'it'] as const;
// Marked pure so bundlers can drop it (and zod) when only the constants/helpers are used.
export const langSchema = /* @__PURE__ */ z.enum(LANGS);
export type Lang = z.infer<typeof langSchema>;
export const DEFAULT_LANG: Lang = 'sq';

/** BCP-47 locale used for Intl formatting per UI language. */
export const LANG_LOCALES: Record<Lang, string> = {
  sq: 'sq-AL',
  en: 'en-GB',
  it: 'it-IT',
};

// Plain check (not langSchema) so browser bundles that only need this don't pull in zod.
export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** Picks the first supported language from a list such as `navigator.languages`. */
export function pickLang(candidates: readonly string[], fallback: Lang = DEFAULT_LANG): Lang {
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return fallback;
}
