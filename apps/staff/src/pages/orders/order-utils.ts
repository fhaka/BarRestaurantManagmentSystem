import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  CheckCheck,
  ChefHat,
  Clock,
  Flame,
  PauseCircle,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  effectivePrice,
  lineTotal,
  type AdminMenu,
  type Location,
  type MenuItem,
  type Order,
  type OrderItemStatus,
} from '@tavolina/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

export type BadgeTone =
  'neutral' | 'info' | 'primary' | 'success' | 'highlight' | 'warning' | 'danger';

/** Status is always colour + icon + words (plan §12). */
export const ITEM_STATUS_STYLE: Record<OrderItemStatus, { icon: LucideIcon; tone: BadgeTone }> = {
  draft: { icon: Clock, tone: 'neutral' },
  pending_confirmation: { icon: PauseCircle, tone: 'warning' },
  sent: { icon: Send, tone: 'info' },
  preparing: { icon: Flame, tone: 'highlight' },
  ready: { icon: ChefHat, tone: 'success' },
  served: { icon: CheckCheck, tone: 'neutral' },
  voided: { icon: XCircle, tone: 'danger' },
};

/** Where an order is added to: a table session, or a takeaway / delivery order. */
export type OrderTarget =
  { kind: 'session'; sessionId: number } | { kind: 'order'; orderRef: string };

export const targetKey = (t: OrderTarget) =>
  t.kind === 'session' ? `s:${t.sessionId}` : `o:${t.orderRef}`;

export function useOrderQuery(target: OrderTarget) {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['order', locationId, targetKey(target)],
    queryFn: async () =>
      target.kind === 'session'
        ? (await api<{ order: Order | null }>('GET', `/table-sessions/${target.sessionId}/order`))
            .order
        : api<Order>('GET', `/orders/${target.orderRef}`),
    refetchInterval: 60_000,
  });
}

export function useCurrentLocation() {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['location', locationId],
    queryFn: () => api<Location>('GET', '/locations/current'),
    staleTime: 5 * 60_000,
  });
}

// ---- Cart (lines not sent yet; kept on the device so a reload or Wi-Fi drop loses nothing) ----

export interface CartLine {
  uuid: string;
  menuItemId?: number;
  comboId?: number;
  variantId: number | null;
  modifierIds: number[];
  comboSelections: {
    slotId: number;
    menuItemId: number;
    variantId: number | null;
    modifierIds: number[];
  }[];
  qty: number;
  seat: number | null;
  course: 1 | 2 | 3 | null;
  notes: string | null;
}

interface CartState {
  carts: Record<string, CartLine[]>;
  set: (key: string, lines: CartLine[]) => void;
}

export const useCarts = create<CartState>()(
  persist(
    (set) => ({
      carts: {},
      set: (key, lines) =>
        set((s) => {
          const carts = { ...s.carts };
          if (lines.length) carts[key] = lines;
          else delete carts[key];
          return { carts };
        }),
    }),
    { name: 'tavolina.carts' },
  ),
);

/** Same dish with the same options: tapping it again just adds one. */
export function sameChoice(a: CartLine, b: CartLine): boolean {
  return (
    a.menuItemId === b.menuItemId &&
    a.comboId === b.comboId &&
    a.variantId === b.variantId &&
    a.seat === b.seat &&
    a.course === b.course &&
    (a.notes ?? '') === (b.notes ?? '') &&
    JSON.stringify([...a.modifierIds].sort()) === JSON.stringify([...b.modifierIds].sort()) &&
    JSON.stringify(a.comboSelections) === JSON.stringify(b.comboSelections)
  );
}

export function toRequestItem(line: CartLine) {
  const base = {
    uuid: line.uuid,
    qty: line.qty,
    seat: line.seat,
    course: line.course,
    notes: line.notes,
  };
  return line.comboId !== undefined
    ? { ...base, comboId: line.comboId, comboSelections: line.comboSelections }
    : {
        ...base,
        menuItemId: line.menuItemId,
        variantId: line.variantId,
        modifierIds: line.modifierIds,
      };
}

// ---- Prices and labels (the server prices for real; this is for the screen) ------------------

export function categoryChain(menu: AdminMenu, categoryId: number): number[] {
  const chain: number[] = [];
  let current = menu.categories.find((c) => c.id === categoryId);
  while (current && !chain.includes(current.id)) {
    chain.push(current.id);
    const parentId = current.parentId;
    current = parentId ? menu.categories.find((c) => c.id === parentId) : undefined;
  }
  return chain;
}

export function itemPrice(
  menu: AdminMenu,
  item: MenuItem,
  variantId: number | null,
  timeZone: string,
  at = new Date(),
) {
  const base = item.variants.find((v) => v.id === variantId)?.priceMinor ?? item.priceMinor;
  return effectivePrice(
    base,
    { itemId: item.id, categoryIds: categoryChain(menu, item.categoryId) },
    menu.priceRules,
    at,
    timeZone,
  );
}

const modifierById = (menu: AdminMenu, id: number) =>
  menu.modifierGroups.flatMap((g) => g.modifiers).find((m) => m.id === id);

export interface LineView {
  name: string;
  details: string[];
  totalMinor: number;
}

export function describeLine(menu: AdminMenu, line: CartLine, timeZone: string): LineView {
  if (line.comboId !== undefined) {
    const combo = menu.combos.find((c) => c.id === line.comboId);
    let unit = combo?.priceMinor ?? 0;
    const details: string[] = [];
    const deltas: number[] = [];
    for (const sel of line.comboSelections) {
      const slot = combo?.slots.find((s) => s.id === sel.slotId);
      unit += slot?.items.find((i) => i.menuItemId === sel.menuItemId)?.priceDeltaMinor ?? 0;
      const item = menu.items.find((i) => i.id === sel.menuItemId);
      const variant = item?.variants.find((v) => v.id === sel.variantId);
      const mods = sel.modifierIds.map((id) => modifierById(menu, id)).filter(Boolean);
      deltas.push(...mods.map((m) => m!.priceDeltaMinor));
      details.push(
        [item?.name, variant?.name, ...mods.map((m) => m!.name)].filter(Boolean).join(' · '),
      );
    }
    return { name: combo?.name ?? '?', details, totalMinor: lineTotal(unit, deltas, line.qty) };
  }
  const item = menu.items.find((i) => i.id === line.menuItemId);
  if (!item) return { name: '?', details: [], totalMinor: 0 };
  const variant = item.variants.find((v) => v.id === line.variantId);
  const mods = line.modifierIds.map((id) => modifierById(menu, id)).filter(Boolean);
  const unit = itemPrice(menu, item, line.variantId, timeZone).priceMinor;
  return {
    name: item.name,
    details: [variant?.name, ...mods.map((m) => m!.name)].filter((x): x is string => Boolean(x)),
    totalMinor: lineTotal(
      unit,
      mods.map((m) => m!.priceDeltaMinor),
      line.qty,
    ),
  };
}

export const isOutOfStock = (item: Pick<MenuItem, 'outOfStockUntil'>, now = Date.now()) =>
  item.outOfStockUntil !== null && new Date(item.outOfStockUntil).getTime() > now;

/** Items needing a choice (size, required options) open the options sheet instead of adding. */
export function needsOptions(menu: AdminMenu, item: MenuItem): boolean {
  return (
    item.variants.length > 0 ||
    item.modifierGroupIds.some((id) => menu.modifierGroups.some((g) => g.id === id))
  );
}
