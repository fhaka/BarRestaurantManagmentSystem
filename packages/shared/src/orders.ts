import { z } from 'zod';
import { roundToLek } from './money.js';
import { localParts } from './time.js';

// ---- Order item state machine (plan §6) --------------------------------------------------------

/**
 * draft ──send──▶ sent ──start──▶ preparing ──done──▶ ready ──serve──▶ served
 *   │               │                 │                  │
 *   └─remove        └─────void────────┴──────void────────┘
 * A guest item starts as pending_confirmation and becomes sent when a waiter confirms it.
 * The KDS may mark a sent item ready directly, and "recall" puts ready items back to preparing.
 */
export const ORDER_ITEM_STATUSES = [
  'draft',
  'pending_confirmation',
  'sent',
  'preparing',
  'ready',
  'served',
  'voided',
] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

const ITEM_TRANSITIONS: Record<OrderItemStatus, readonly OrderItemStatus[]> = {
  draft: ['sent'],
  pending_confirmation: ['sent'],
  sent: ['preparing', 'ready', 'voided'],
  preparing: ['ready', 'voided'],
  ready: ['served', 'preparing', 'voided'],
  served: [],
  voided: [],
};

export function canTransitionItem(from: OrderItemStatus, to: OrderItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

/** Items that can still be edited or removed freely (never reached the kitchen). */
export const isUnsent = (s: OrderItemStatus) => s === 'draft' || s === 'pending_confirmation';
/** Items the kitchen is (or was) working on and that count towards the bill. */
export const isBillable = (s: OrderItemStatus) => s !== 'voided' && !isUnsent(s);
/** Voids after this point may produce waste (business rule 3). */
export const isPrepared = (s: OrderItemStatus) => s === 'preparing' || s === 'ready';

export const ORDER_STATUSES = ['open', 'closed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** 1 starter, 2 main, 3 dessert; null = no course (served as soon as ready). */
export const COURSES = [1, 2, 3] as const;
export type Course = (typeof COURSES)[number];

export const KDS_TICKET_STATUSES = ['new', 'in_progress', 'ready', 'done'] as const;
export type KdsTicketStatus = (typeof KDS_TICKET_STATUSES)[number];

// ---- Money ---------------------------------------------------------------------------------------

/**
 * Business rule 2 (first step): line = (unit price + modifier deltas) × qty, rounded per line to
 * whole lek. Discounts, service and tax are applied on top in Phase 6.
 */
export function lineTotal(
  unitPriceMinor: number,
  modifierDeltasMinor: readonly number[],
  qty: number,
): number {
  const unit = unitPriceMinor + modifierDeltasMinor.reduce((sum, d) => sum + d, 0);
  return roundToLek(unit * qty);
}

// ---- Business day --------------------------------------------------------------------------------

/** A business day runs from 04:00 to 04:00 local time, so a 01:00 order belongs to "yesterday". */
export const BUSINESS_DAY_START_HOUR = 4;

export function businessDate(at: Date, timeZone: string): string {
  const shifted = new Date(at.getTime() - BUSINESS_DAY_START_HOUR * 3_600_000);
  return localParts(shifted, timeZone).date;
}

// ---- Modifier choices ----------------------------------------------------------------------------

export interface ModifierGroupRule {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  modifierIds: number[];
}

export type ModifierProblem =
  | { code: 'unknownModifier'; modifierId: number }
  | { code: 'tooFew'; groupId: number; groupName: string; min: number }
  | { code: 'tooMany'; groupId: number; groupName: string; max: number };

/** Checks a selection against the item's modifier groups (min/max/required, known ids). */
export function checkModifierSelection(
  groups: readonly ModifierGroupRule[],
  selected: readonly number[],
): ModifierProblem[] {
  const problems: ModifierProblem[] = [];
  const allowed = new Map<number, number>();
  for (const g of groups) for (const id of g.modifierIds) allowed.set(id, g.id);
  for (const id of selected)
    if (!allowed.has(id)) problems.push({ code: 'unknownModifier', modifierId: id });
  for (const g of groups) {
    const count = selected.filter((id) => allowed.get(id) === g.id).length;
    const min = g.required ? Math.max(1, g.minSelect) : g.minSelect;
    if (count < min) problems.push({ code: 'tooFew', groupId: g.id, groupName: g.name, min });
    if (count > g.maxSelect)
      problems.push({ code: 'tooMany', groupId: g.id, groupName: g.name, max: g.maxSelect });
  }
  return problems;
}

// ---- Schemas -------------------------------------------------------------------------------------

/** An order or table-session reference: numeric id or the client-generated uuid. */
export const refSchema = z.union([z.uuid(), z.coerce.number().int().positive()]);

export const createOrderSchema = z
  .object({
    uuid: z.uuid(),
    type: z.enum(ORDER_TYPES),
    tableSessionRef: refSchema.optional(),
    customerName: z.string().trim().max(100).nullish(),
    customerPhone: z.string().trim().max(30).nullish(),
    deliveryAddress: z.string().trim().max(255).nullish(),
    /** Requested pickup/delivery time (ISO). */
    pickupAt: z.iso.datetime({ offset: true }).nullish(),
  })
  .refine((o) => (o.type === 'dine_in') === (o.tableSessionRef !== undefined), {
    message: 'tableSessionRef',
    path: ['tableSessionRef'],
  })
  .refine((o) => o.type !== 'delivery' || Boolean(o.deliveryAddress), {
    message: 'deliveryAddress',
    path: ['deliveryAddress'],
  });
export type CreateOrderInput = z.input<typeof createOrderSchema>;

export const comboSelectionSchema = z.object({
  slotId: z.number().int().positive(),
  menuItemId: z.number().int().positive(),
  variantId: z.number().int().positive().nullish(),
  modifierIds: z.array(z.number().int().positive()).max(20).default([]),
});

export const newOrderItemSchema = z
  .object({
    /** Client-generated so replays after a Wi-Fi drop are ignored (plan §5.15). */
    uuid: z.uuid(),
    menuItemId: z.number().int().positive().optional(),
    comboId: z.number().int().positive().optional(),
    variantId: z.number().int().positive().nullish(),
    modifierIds: z.array(z.number().int().positive()).max(20).default([]),
    comboSelections: z.array(comboSelectionSchema).max(10).default([]),
    qty: z.number().int().min(1).max(99).default(1),
    seat: z.number().int().min(1).max(40).nullish(),
    course: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
    notes: z.string().trim().max(200).nullish(),
  })
  .refine((i) => (i.menuItemId === undefined) !== (i.comboId === undefined), {
    message: 'itemOrCombo',
    path: ['menuItemId'],
  });
export type NewOrderItem = z.input<typeof newOrderItemSchema>;

export const addItemsSchema = z.object({
  items: z.array(newOrderItemSchema).min(1).max(100),
  /** Send straight to the stations (the waiter screen always does). */
  send: z.boolean().default(false),
});
export type AddItemsInput = z.input<typeof addItemsSchema>;

export const sendItemsSchema = z.object({
  /** Draft item uuids to send; all drafts when omitted. */
  itemRefs: z.array(refSchema).max(200).optional(),
});

export const fireCourseSchema = z.object({ course: z.union([z.literal(2), z.literal(3)]) });

export const updateDraftItemSchema = z.object({
  qty: z.number().int().min(1).max(99).optional(),
  seat: z.number().int().min(1).max(40).nullish(),
  course: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
  notes: z.string().trim().max(200).nullish(),
});

export const voidItemSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  approvalToken: z.string().min(10).max(100).optional(),
});

export const serveItemsSchema = z.object({
  /** Item refs to serve; every ready item of the order when omitted. */
  itemRefs: z.array(refSchema).max(200).optional(),
});

export const itemStatusSchema = z.object({ status: z.enum(['preparing', 'ready']) });

export const repeatItemsSchema = z.object({
  itemRefs: z.array(refSchema).min(1).max(100),
  /** New uuids for the copies, in the same order. */
  uuids: z.array(z.uuid()).min(1).max(100),
  send: z.boolean().default(true),
});

// ---- Response types ------------------------------------------------------------------------------

export interface OrderItemModifier {
  modifierId: number | null;
  name: string;
  priceDeltaMinor: number;
}

export interface OrderItem {
  id: number;
  uuid: string;
  menuItemId: number | null;
  comboId: number | null;
  /** Set on the dishes inside a combo. */
  parentItemId: number | null;
  variantId: number | null;
  name: string;
  variantName: string | null;
  unitPriceMinor: number;
  qty: number;
  seat: number | null;
  course: Course | null;
  /** Later courses wait until fired. */
  held: boolean;
  notes: string | null;
  status: OrderItemStatus;
  stationId: number | null;
  source: 'staff' | 'guest';
  modifiers: OrderItemModifier[];
  lineTotalMinor: number;
  addedAt: string;
  sentAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  voidReason: string | null;
}

export interface Order {
  id: number;
  uuid: string;
  number: number;
  businessDate: string;
  type: OrderType;
  status: OrderStatus;
  tableSessionId: number | null;
  tableNames: string[];
  waiterId: number | null;
  waiterName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  pickupAt: string | null;
  subtotalMinor: number;
  totalMinor: number;
  /** Courses that still have held items. */
  heldCourses: Course[];
  items: OrderItem[];
  createdAt: string;
}

export interface OrderSummary {
  id: number;
  uuid: string;
  number: number;
  type: OrderType;
  tableNames: string[];
  tableSessionId: number | null;
  customerName: string | null;
  waiterName: string | null;
  totalMinor: number;
  itemCount: number;
  readyCount: number;
  createdAt: string;
}

export interface KdsTicketItem {
  id: number;
  name: string;
  variantName: string | null;
  qty: number;
  seat: number | null;
  course: Course | null;
  held: boolean;
  notes: string | null;
  status: OrderItemStatus;
  modifiers: string[];
  /** Name of the combo this dish belongs to. */
  comboName: string | null;
}

export interface KdsTicket {
  id: number;
  number: number;
  status: KdsTicketStatus;
  stationId: number;
  orderNumber: number;
  orderType: OrderType;
  tableNames: string[];
  waiterName: string | null;
  customerName: string | null;
  createdAt: string;
  bumpedAt: string | null;
  items: KdsTicketItem[];
}

export interface KdsBoard {
  station: { id: number; name: string; type: string };
  /** new + in_progress + ready, oldest first. */
  tickets: KdsTicket[];
  /** The last 10 finished tickets, newest first (for "recall"). */
  recent: KdsTicket[];
}

/** People who can approve with their PIN at this location. */
export interface Approver {
  id: number;
  name: string;
  roleKey: string;
}
