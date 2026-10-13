import { useQuery } from '@tanstack/react-query';
import {
  fromMilli,
  type Ingredient,
  type ItemCosting,
  type StockUnit,
  type Supplier,
} from '@tavolina/shared';
import i18n, { currentLocale } from '../../i18n';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

/** 1 500 thousandths of a litre → "1,5 l" in the UI language. */
export function formatQty(milli: number, unit: StockUnit): string {
  const n = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 3 }).format(
    milli / 1000,
  );
  return `${n} ${i18n.t(`inventory:units.${unit}`)}`;
}

/** Thousandths → what goes back into a quantity field ("0.018", "1.5", "10"). */
export function qtyToInput(milli: number | null): string {
  if (milli === null) return '';
  return fromMilli(milli).replace(/\.?0+$/, '');
}

/** Margin colour: under 60% on drinks/food is worth a look (plan §5.9 shows margins, not a rule). */
export function marginTone(marginBp: number): 'success' | 'warning' | 'danger' {
  if (marginBp < 3_000) return 'danger';
  if (marginBp < 6_000) return 'warning';
  return 'success';
}

export const formatPct = (bp: number) =>
  `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(bp / 100)}%`;

// Every inventory query key starts with "inventory", so a stock.low event refreshes them all.
export function useIngredients() {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['inventory', 'ingredients', locationId],
    queryFn: () => api<Ingredient[]>('GET', '/ingredients'),
  });
}

export function useSuppliers() {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['inventory', 'suppliers', locationId],
    queryFn: () => api<Supplier[]>('GET', '/suppliers'),
  });
}

export function useCosting() {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['inventory', 'costing', locationId],
    queryFn: () => api<ItemCosting[]>('GET', '/costing'),
  });
}
