import { useTranslation } from 'react-i18next';
import {
  Beef,
  Beer,
  Cake,
  Coffee,
  Croissant,
  CupSoda,
  Egg,
  Fish,
  IceCreamCone,
  Martini,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import {
  ALL_WEEKDAYS_MASK,
  type CategoryIcon,
  type Lang,
  type Translations,
} from '@tavolina/shared';

export const CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon> = {
  coffee: Coffee,
  'cup-soda': CupSoda,
  beer: Beer,
  wine: Wine,
  martini: Martini,
  croissant: Croissant,
  egg: Egg,
  salad: Salad,
  soup: Soup,
  utensils: UtensilsCrossed,
  beef: Beef,
  fish: Fish,
  pizza: Pizza,
  sandwich: Sandwich,
  cake: Cake,
  'ice-cream': IceCreamCone,
};

/** "1 200" / "1200,50" → 120000 minor units; null for empty; NaN for invalid. */
export function parseLekInput(value: string): number | null {
  const cleaned = value.replace(/[\s\u00A0]/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

export function minorToInput(minor: number | null): string {
  if (minor === null) return '';
  const lek = minor / 100;
  return Number.isInteger(lek) ? String(lek) : lek.toFixed(2);
}

/** Languages (from `langs`) missing a translated name. */
export function missingTranslations(translations: Translations, langs: Lang[]): Lang[] {
  return langs.filter((l) => !translations[l]?.name?.trim());
}

/** "E hën–E pre" style summary of a weekday mask. */
export function describeWeekdays(mask: number, everyDay: string, names: readonly string[]): string {
  if ((mask & ALL_WEEKDAYS_MASK) === ALL_WEEKDAYS_MASK) return everyDay;
  const days = names.filter((_, i) => (mask & (1 << i)) !== 0);
  // Collapse a single run of consecutive days into "first–last".
  const indices = names.map((_, i) => i).filter((i) => (mask & (1 << i)) !== 0);
  const consecutive = indices.every((d, i) => i === 0 || d === indices[i - 1]! + 1);
  return consecutive && days.length > 2 ? `${days[0]}–${days[days.length - 1]}` : days.join(', ');
}

/** Monday-first short weekday names from the translations (Intl lacks Albanian in some browsers). */
export function useWeekdayNames(): string[] {
  const { t } = useTranslation('menu');
  return t('weekdays', { returnObjects: true }) as string[];
}
