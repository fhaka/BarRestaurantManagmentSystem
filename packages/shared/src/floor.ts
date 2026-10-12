import { z } from 'zod';

/** The floor is a grid; positions and sizes are whole grid cells. */
export const FLOOR_GRID = { cols: 48, rows: 32 } as const;

export const TABLE_SHAPES = ['square', 'round', 'rectangle', 'bar_stool'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** Default footprint (grid cells) for a new table of each shape. */
export const SHAPE_SIZE: Record<TableShape, { w: number; h: number }> = {
  square: { w: 3, h: 3 },
  round: { w: 3, h: 3 },
  rectangle: { w: 6, h: 3 },
  bar_stool: { w: 2, h: 2 },
};

/**
 * Floor colours (plan §5.2). Phase 3 produces free / occupied / bill_requested / needs_cleaning;
 * ordered and food_ready come from orders (Phase 4), reserved from reservations (Phase 8).
 */
export const TABLE_STATUSES = [
  'free',
  'occupied',
  'ordered',
  'food_ready',
  'bill_requested',
  'needs_cleaning',
  'reserved',
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

// ---- Table session state machine (plan §6) -----------------------------------------------------

export const SESSION_STATUSES = ['open', 'bill_requested', 'paid', 'closed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  open: ['bill_requested', 'closed'],
  bill_requested: ['open', 'paid', 'closed'],
  paid: ['closed', 'open'],
  closed: [],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

/**
 * Business rule 4: a session closes only when nothing is owed. Until bills exist (Phase 6) the
 * balance is always 0; the caller passes the real balance once it does.
 */
export function canCloseSession(status: SessionStatus, balanceMinor: number): boolean {
  return canTransitionSession(status, 'closed') && balanceMinor <= 0;
}

export function deriveTableStatus(input: {
  needsCleaning: boolean;
  session: { status: SessionStatus; hasOrders?: boolean; hasReadyItems?: boolean } | null;
  reservedSoon?: boolean;
}): TableStatus {
  const { session } = input;
  if (session && session.status !== 'closed') {
    if (session.status === 'bill_requested' || session.status === 'paid') return 'bill_requested';
    if (session.hasReadyItems) return 'food_ready';
    if (session.hasOrders) return 'ordered';
    return 'occupied';
  }
  if (input.needsCleaning) return 'needs_cleaning';
  if (input.reservedSoon) return 'reserved';
  return 'free';
}

// ---- Layout geometry ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned overlap in grid cells (rotation is visual only and ignored here). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectInGrid(r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= FLOOR_GRID.cols && r.y + r.h <= FLOOR_GRID.rows;
}

// ---- Schemas -----------------------------------------------------------------------------------

const name = z.string().trim().min(1).max(60);
const cell = z.number().int().min(0);
const size = z.number().int().min(1).max(16);

export const areaInputSchema = z.object({
  name,
  active: z.boolean().default(true),
});
export type AreaInput = z.input<typeof areaInputSchema>;

const layoutFields = {
  x: cell.max(FLOOR_GRID.cols - 1),
  y: cell.max(FLOOR_GRID.rows - 1),
  w: size,
  h: size,
  rotation: z.number().int().min(0).max(359).default(0),
};

const inGrid = (t: { x?: number; y?: number; w?: number; h?: number }) =>
  t.x === undefined ||
  t.y === undefined ||
  t.w === undefined ||
  t.h === undefined ||
  rectInGrid({ x: t.x, y: t.y, w: t.w, h: t.h });

export const tableInputSchema = z
  .object({
    areaId: z.number().int().positive(),
    name: z.string().trim().min(1).max(20),
    seats: z.number().int().min(1).max(40).default(4),
    shape: z.enum(TABLE_SHAPES).default('square'),
    ...layoutFields,
    active: z.boolean().default(true),
  })
  .refine(inGrid, { message: 'outsideFloor', path: ['x'] });
export type TableInput = z.input<typeof tableInputSchema>;

export const tableUpdateSchema = z
  .object({
    areaId: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(20).optional(),
    seats: z.number().int().min(1).max(40).optional(),
    shape: z.enum(TABLE_SHAPES).optional(),
    x: layoutFields.x.optional(),
    y: layoutFields.y.optional(),
    w: size.optional(),
    h: size.optional(),
    rotation: z.number().int().min(0).max(359).optional(),
    active: z.boolean().optional(),
  })
  .refine(inGrid, { message: 'outsideFloor', path: ['x'] });
export type TableUpdate = z.input<typeof tableUpdateSchema>;

/** Saves the whole editor canvas of one area at once. */
export const layoutSaveSchema = z.object({
  areaId: z.number().int().positive(),
  tables: z
    .array(
      z
        .object({ id: z.number().int().positive(), ...layoutFields })
        .refine(inGrid, { message: 'outsideFloor', path: ['x'] }),
    )
    .max(300),
});

export const openSessionSchema = z.object({
  /** Client-generated so an offline replay cannot open the table twice. */
  uuid: z.uuid(),
  tableId: z.number().int().positive(),
  guestCount: z.number().int().min(1).max(99).default(2),
});
export type OpenSessionInput = z.input<typeof openSessionSchema>;

export const sessionUpdateSchema = z.object({
  guestCount: z.number().int().min(1).max(99),
});

export const transferSchema = z
  .object({
    toTableId: z.number().int().positive().optional(),
    toWaiterId: z.number().int().positive().optional(),
  })
  .refine((v) => (v.toTableId === undefined) !== (v.toWaiterId === undefined), {
    message: 'transferTarget',
  });

export const mergeSchema = z.object({ tableId: z.number().int().positive() });
export const splitSchema = z.object({ tableId: z.number().int().positive() });

// ---- Response types ----------------------------------------------------------------------------

export interface Area {
  id: number;
  name: string;
  sort: number;
  active: boolean;
}

export interface FloorSession {
  id: number;
  uuid: string;
  status: SessionStatus;
  guestCount: number;
  /** Null when guests opened the table by ordering from the QR menu (nobody has taken it yet). */
  waiterId: number | null;
  waiterName: string | null;
  /** The current user's own table (or they may act on all tables). */
  mine: boolean;
  openedAt: string;
  /** Every table in the session; more than one when tables are merged. */
  tableIds: number[];
  primaryTableId: number;
  /** Order total so far. */
  totalMinor: number;
  /** Guest-ordered lines waiting for a waiter to confirm them. */
  pendingGuestItems: number;
}

/** An open "call waiter" / "bill please" request from the QR menu. */
export interface FloorRequest {
  id: number;
  type: 'call_waiter' | 'bill_cash' | 'bill_card';
  createdAt: string;
}

export interface FloorTable {
  id: number;
  areaId: number;
  name: string;
  seats: number;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  active: boolean;
  needsCleaning: boolean;
  status: TableStatus;
  session: FloorSession | null;
  requests: FloorRequest[];
}

export interface FloorState {
  areas: Area[];
  tables: FloorTable[];
  /** People who can take tables, for "transfer to waiter". */
  waiters: { id: number; name: string }[];
  /** Whether this user may act on every table (else only their own). */
  canActOnAllTables: boolean;
  generatedAt: string;
}

export interface TableQr {
  tableId: number;
  tableName: string;
  url: string;
  svg: string;
}
