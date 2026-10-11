import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  Package,
  ScrollText,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@tavolina/shared';

export type NavKey =
  | 'dashboard'
  | 'floor'
  | 'orders'
  | 'kds'
  | 'cashier'
  | 'reservations'
  | 'menu'
  | 'inventory'
  | 'staff'
  | 'reports'
  | 'audit'
  | 'locations'
  | 'settings';

export interface NavItem {
  key: NavKey;
  path: string;
  icon: LucideIcon;
  /** Shown only when the user has this permission at the current location. */
  permission: Permission;
  /** Build phase that delivers the screen; earlier phases show a placeholder. */
  phase: number;
}

export interface NavGroup {
  key: 'service' | 'management' | 'business';
  items: NavItem[];
}

/** Navigation is driven by permissions only, never by role names (plan §4). */
export const NAV: NavGroup[] = [
  {
    key: 'service',
    items: [
      { key: 'floor', path: '/floor', icon: LayoutGrid, permission: 'floor.view', phase: 3 },
      { key: 'orders', path: '/orders', icon: ClipboardList, permission: 'order.create', phase: 4 },
      { key: 'kds', path: '/kds', icon: ChefHat, permission: 'kds.view', phase: 4 },
      { key: 'cashier', path: '/cashier', icon: Wallet, permission: 'payment.take', phase: 6 },
      {
        key: 'reservations',
        path: '/reservations',
        icon: CalendarDays,
        permission: 'reservation.view',
        phase: 8,
      },
    ],
  },
  {
    key: 'management',
    items: [
      {
        key: 'dashboard',
        path: '/dashboard',
        icon: LayoutDashboard,
        permission: 'report.view',
        phase: 9,
      },
      { key: 'menu', path: '/menu', icon: BookOpen, permission: 'menu.edit', phase: 2 },
      {
        key: 'inventory',
        path: '/inventory',
        icon: Package,
        permission: 'inventory.view',
        phase: 7,
      },
      { key: 'staff', path: '/staff', icon: Users, permission: 'staff.view', phase: 1 },
      { key: 'reports', path: '/reports', icon: BarChart3, permission: 'report.view', phase: 9 },
      { key: 'audit', path: '/audit', icon: ScrollText, permission: 'audit.view', phase: 10 },
    ],
  },
  {
    key: 'business',
    items: [
      {
        key: 'locations',
        path: '/locations',
        icon: Building2,
        permission: 'location.manage',
        phase: 1,
      },
      { key: 'settings', path: '/settings', icon: Settings, permission: 'settings.edit', phase: 1 },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function visibleNav(can: (p: Permission) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Where a user lands after sign-in: dashboard for managers, KDS for kitchen, floor for waiters. */
export function homePath(can: (p: Permission) => boolean): string {
  const order: NavKey[] = ['dashboard', 'floor', 'kds', 'cashier', 'staff', 'settings'];
  for (const key of order) {
    const item = NAV_ITEMS.find((i) => i.key === key);
    if (item && can(item.permission)) return item.path;
  }
  return NAV_ITEMS.find((i) => can(i.permission))?.path ?? '/no-access';
}
