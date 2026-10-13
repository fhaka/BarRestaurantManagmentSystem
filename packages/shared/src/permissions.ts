/**
 * Permissions are named strings. Code always checks permissions, never role names.
 * The role → permission mapping below is the default; it is synced into the
 * `roles`, `permissions` and `role_permissions` tables (see docs/DECISIONS.md D-016).
 */

export const PERMISSIONS = [
  // Account & location
  'account.manage',
  'location.manage',
  'settings.edit',
  // Staff & devices
  'staff.view',
  'staff.manage',
  'device.manage',
  'approval.grant',
  // Menu
  'menu.view',
  'menu.edit',
  'menu.availability',
  // Floor & tables
  'floor.view',
  'floor.edit',
  'table.open',
  'table.transfer',
  'table.close',
  'table.view_all',
  // Orders & kitchen
  'order.create',
  'order.send',
  'order.void',
  'order.discount',
  'kds.view',
  'kds.bump',
  // Money
  'payment.take',
  'payment.refund',
  'bill.split',
  'cash.drawer',
  'cash.movement',
  'cash.approve',
  'business_day.close',
  // Back office
  'inventory.view',
  'inventory.manage',
  'reservation.view',
  'reservation.manage',
  'shift.manage',
  'time.clock',
  'report.view',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ['owner', 'manager', 'waiter', 'cashier', 'kitchen'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Higher rank = more senior. Used only for sorting lists, never for access checks. */
export const ROLE_RANK: Record<RoleKey, number> = {
  owner: 5,
  manager: 4,
  cashier: 3,
  waiter: 2,
  kitchen: 1,
};

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== 'account.manage' && p !== 'location.manage'),
  waiter: [
    'menu.view',
    'floor.view',
    'table.open',
    'table.transfer',
    'table.close',
    'order.create',
    'order.send',
    'order.void',
    'payment.take',
    'bill.split',
    'reservation.view',
    'time.clock',
  ],
  cashier: [
    'menu.view',
    'floor.view',
    'table.close',
    'table.view_all',
    'order.create',
    'order.send',
    'order.discount',
    'payment.take',
    'bill.split',
    'cash.drawer',
    'cash.movement',
    'reservation.view',
    'time.clock',
  ],
  // Kitchen and bar screens share one role; the device's station decides what they see.
  kitchen: ['kds.view', 'kds.bump', 'menu.availability', 'time.clock'],
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * A user may only grant a role whose permissions are all within their own.
 * This stops privilege escalation without hard-coding role names.
 */
export function canGrantRole(
  granterPermissions: ReadonlySet<string> | readonly string[],
  role: RoleKey,
): boolean {
  const own = granterPermissions instanceof Set ? granterPermissions : new Set(granterPermissions);
  return ROLE_PERMISSIONS[role].every((p) => own.has(p));
}

/** Actions that need inline manager-PIN approval (plan §4). */
export const APPROVAL_ACTIONS = [
  'order_item.void',
  'order.discount',
  'payment.refund',
  'cash_drawer.open_no_sale',
  'cash_drawer.close',
  'order.delete_paid',
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
