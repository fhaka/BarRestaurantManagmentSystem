import { useCallback, useEffect, useState } from 'react';
import { lineTotal } from '@tavolina/shared/client';
import type {
  GuestCombo,
  GuestMenu,
  GuestMenuItem,
  GuestOrderLine,
  NewOrderItem,
} from '@tavolina/shared';

export interface ComboChoice {
  slotId: number;
  itemId: number;
  variantId: number | null;
  modifierIds: number[];
}

/** One line in the phone's cart (kept on the phone until the guest orders). */
export interface GuestCartLine {
  uuid: string;
  itemId?: number;
  comboId?: number;
  variantId: number | null;
  modifierIds: number[];
  combo: ComboChoice[];
  qty: number;
  notes: string | null;
}

const storageKey = (tableToken: string) => `tavolina.guest.cart.${tableToken}`;

function load(tableToken: string): GuestCartLine[] {
  try {
    const raw = localStorage.getItem(storageKey(tableToken));
    return raw ? (JSON.parse(raw) as GuestCartLine[]) : [];
  } catch {
    return [];
  }
}

/** The cart for this table, saved on the phone so a reload or a dropped signal loses nothing. */
export function useCart(tableToken: string) {
  const [lines, setLines] = useState<GuestCartLine[]>(() => load(tableToken));
  useEffect(() => {
    try {
      if (lines.length) localStorage.setItem(storageKey(tableToken), JSON.stringify(lines));
      else localStorage.removeItem(storageKey(tableToken));
    } catch {
      // The cart just won't survive a reload.
    }
  }, [lines, tableToken]);

  const save = useCallback((line: GuestCartLine) => {
    setLines((current) =>
      current.some((l) => l.uuid === line.uuid)
        ? current.map((l) => (l.uuid === line.uuid ? line : l))
        : [...current, line],
    );
  }, []);
  const setQty = useCallback((uuid: string, qty: number) => {
    setLines((current) =>
      qty < 1
        ? current.filter((l) => l.uuid !== uuid)
        : current.map((l) => (l.uuid === uuid ? { ...l, qty } : l)),
    );
  }, []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, save, setQty, clear };
}

export const allItems = (menu: GuestMenu): GuestMenuItem[] =>
  menu.categories.flatMap((c) => c.items);
export const allCombos = (menu: GuestMenu): GuestCombo[] =>
  menu.categories.flatMap((c) => c.combos);

/** Price of one dish with its size and options, per unit. */
export function unitPrice(item: GuestMenuItem, variantId: number | null) {
  return item.variants.find((v) => v.id === variantId)?.priceMinor ?? item.priceMinor;
}

const modifierDeltas = (item: GuestMenuItem, ids: number[]) =>
  item.modifierGroups
    .flatMap((g) => g.modifiers)
    .filter((m) => ids.includes(m.id))
    .map((m) => m.priceDeltaMinor);

const modifierNames = (item: GuestMenuItem, ids: number[]) =>
  item.modifierGroups
    .flatMap((g) => g.modifiers)
    .filter((m) => ids.includes(m.id))
    .map((m) => m.name);

export interface CartLineView {
  name: string;
  details: string[];
  totalMinor: number;
  /** The dish is no longer on the menu (sold out meanwhile). */
  missing: boolean;
}

export function describe(menu: GuestMenu, line: GuestCartLine): CartLineView {
  const items = allItems(menu);
  if (line.comboId !== undefined) {
    const combo = allCombos(menu).find((c) => c.id === line.comboId);
    if (!combo) return { name: '?', details: [], totalMinor: 0, missing: true };
    let unit = combo.priceMinor;
    const deltas: number[] = [];
    const details: string[] = [];
    let missing = false;
    for (const choice of line.combo) {
      const slot = combo.slots.find((s) => s.id === choice.slotId);
      unit += slot?.options.find((o) => o.itemId === choice.itemId)?.priceDeltaMinor ?? 0;
      const item = items.find((i) => i.id === choice.itemId);
      if (!item) {
        missing = true;
        continue;
      }
      deltas.push(...modifierDeltas(item, choice.modifierIds));
      const variant = item.variants.find((v) => v.id === choice.variantId)?.name;
      details.push(
        [item.name, variant, ...modifierNames(item, choice.modifierIds)]
          .filter(Boolean)
          .join(' · '),
      );
    }
    return { name: combo.name, details, totalMinor: lineTotal(unit, deltas, line.qty), missing };
  }
  const item = items.find((i) => i.id === line.itemId);
  if (!item) return { name: '?', details: [], totalMinor: 0, missing: true };
  const variant = item.variants.find((v) => v.id === line.variantId)?.name;
  return {
    name: item.name,
    details: [variant, ...modifierNames(item, line.modifierIds)].filter((x): x is string =>
      Boolean(x),
    ),
    totalMinor: lineTotal(
      unitPrice(item, line.variantId),
      modifierDeltas(item, line.modifierIds),
      line.qty,
    ),
    missing: false,
  };
}

export function toOrderItem(line: GuestCartLine): NewOrderItem {
  const base = { uuid: line.uuid, qty: line.qty, notes: line.notes };
  return line.comboId !== undefined
    ? {
        ...base,
        comboId: line.comboId,
        comboSelections: line.combo.map((c) => ({
          slotId: c.slotId,
          menuItemId: c.itemId,
          variantId: c.variantId,
          modifierIds: c.modifierIds,
        })),
      }
    : {
        ...base,
        menuItemId: line.itemId,
        variantId: line.variantId,
        modifierIds: line.modifierIds,
      };
}

/** A line from the table's order in the phone's language (stored names are in the main one). */
export function localLine(menu: GuestMenu, line: GuestOrderLine) {
  if (line.comboId !== null) {
    const combo = allCombos(menu).find((c) => c.id === line.comboId);
    return { name: combo?.name ?? line.name, variantName: null, modifiers: line.modifiers };
  }
  const item = allItems(menu).find((i) => i.id === line.menuItemId);
  if (!item) return { name: line.name, variantName: line.variantName, modifiers: line.modifiers };
  const modifiers = item.modifierGroups.flatMap((g) => g.modifiers);
  return {
    name: item.name,
    variantName: item.variants.find((v) => v.id === line.variantId)?.name ?? line.variantName,
    modifiers: line.modifierIds.map(
      (id, index) => modifiers.find((m) => m.id === id)?.name ?? line.modifiers[index] ?? '',
    ),
  };
}
