import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANG, LANGS, LANG_LOCALES, isLang, type Lang } from '@tavolina/shared';

// Every locales/<lang>/<namespace>.json file, bundled. Albanian is the source language.
const files = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', {
  eager: true,
  import: 'default',
});

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, content] of Object.entries(files)) {
  const match = /\.\/locales\/(\w+)\/(\w+)\.json$/.exec(path);
  if (!match) continue;
  const [, lang, ns] = match as unknown as [string, string, string];
  (resources[lang] ??= {})[ns] = content;
}

export const NAMESPACES = [
  'common',
  'app',
  'auth',
  'errors',
  'staff',
  'business',
  'menu',
  'floor',
  'orders',
  'kds',
  'billing',
  'inventory',
  'reservations',
  'showcase',
];

const STORAGE_KEY = 'tavolina.lang';

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // ignore unavailable storage
  }
  return DEFAULT_LANG;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLang(),
  fallbackLng: DEFAULT_LANG,
  supportedLngs: [...LANGS],
  defaultNS: 'common',
  ns: NAMESPACES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function syncDocumentLang(lang: string) {
  document.documentElement.lang = lang;
}
syncDocumentLang(i18n.language);

export function changeLanguage(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  syncDocumentLang(lang);
  return i18n.changeLanguage(lang);
}

/** Intl locale for the active UI language (for dates and numbers). */
export function currentLocale(): string {
  const lang = i18n.language;
  return isLang(lang) ? LANG_LOCALES[lang] : LANG_LOCALES[DEFAULT_LANG];
}

export default i18n;
