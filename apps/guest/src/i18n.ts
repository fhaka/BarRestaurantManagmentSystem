import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANG, LANGS, isLang, pickLang } from '@tavolina/shared/client';
import type { Lang } from '@tavolina/shared';

import sq from './locales/sq/common.json';
import en from './locales/en/common.json';
import it from './locales/it/common.json';

export const resources = {
  sq: { common: sq },
  en: { common: en },
  it: { common: it },
} as const;

const STORAGE_KEY = 'tavolina.guest.lang';

// Guests get their browser language automatically; a manual choice is remembered.
function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // ignore unavailable storage
  }
  return pickLang(navigator.languages ?? [navigator.language]);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLang(),
  fallbackLng: DEFAULT_LANG,
  supportedLngs: [...LANGS],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = i18n.language;

export function changeLanguage(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  document.documentElement.lang = lang;
  return i18n.changeLanguage(lang);
}

export default i18n;
