import { z } from 'zod';
import type { OrderTotals, TaxLine } from './billing-math.js';
import type { Order } from './orders.js';

export * from './billing-math.js';

// ---- Discounts ---------------------------------------------------------------------------------

export const discountSchema = z
  .object({
    /** A line of the order, or null/omitted for the whole bill. */
    orderItemId: z.number().int().positive().nullish(),
    type: z.enum(['percent', 'fixed']),
    /** Basis points for percent (1000 = 10%), minor units for fixed. */
    value: z.number().int().positive(),
    reason: z.string().trim().min(3).max(200),
    approvalToken: z.string().min(10).max(100).optional(),
  })
  .refine((d) => d.type !== 'percent' || d.value <= 10_000, {
    message: 'percentMax',
    path: ['value'],
  })
  .refine((d) => d.type !== 'fixed' || d.value % 100 === 0, {
    message: 'wholeLek',
    path: ['value'],
  });

// ---- Splitting ---------------------------------------------------------------------------------

export const SPLIT_TYPES = ['full', 'equal', 'seat', 'items', 'custom'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export const billSplitSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('full') }),
  z.object({ type: z.literal('equal'), parts: z.number().int().min(2).max(30) }),
  z.object({ type: z.literal('seat') }),
  z.object({
    type: z.literal('items'),
    /** Order item ids per bill; every unpaid line must be in exactly one group. */
    groups: z.array(z.array(z.number().int().positive()).min(1)).min(2).max(30),
  }),
  z.object({
    type: z.literal('custom'),
    amountsMinor: z.array(z.number().int().positive().multipleOf(100)).min(2).max(30),
  }),
]);
export type BillSplitInput = z.input<typeof billSplitSchema>;

// ---- Payments ----------------------------------------------------------------------------------

export const PAYMENT_METHODS = ['cash', 'card', 'voucher', 'account'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentSchema = z
  .object({
    uuid: z.uuid(),
    method: z.enum(PAYMENT_METHODS),
    /** What is applied to the bill (the rest of a cash note is change). */
    amountMinor: z.number().int().positive(),
    /** Cash handed over; change = tendered − amount − tip. */
    tenderedMinor: z.number().int().positive().nullish(),
    tipMinor: z.number().int().min(0).default(0),
    /** Card terminal reference, voucher code or account name. */
    reference: z.string().trim().max(100).nullish(),
  })
  .refine(
    (p) => p.method !== 'cash' || !p.tenderedMinor || p.tenderedMinor >= p.amountMinor + p.tipMinor,
    {
      message: 'tenderedTooLow',
      path: ['tenderedMinor'],
    },
  )
  .refine((p) => p.method === 'cash' || p.method === 'card' || Boolean(p.reference), {
    message: 'referenceRequired',
    path: ['reference'],
  });
export type PaymentInput = z.input<typeof paymentSchema>;

export const refundSchema = z.object({
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3).max(200),
  approvalToken: z.string().min(10).max(100).optional(),
});

// ---- Cash drawer -------------------------------------------------------------------------------

export const openDrawerSchema = z.object({ floatMinor: z.number().int().min(0).max(100_000_000) });

export const CASH_MOVEMENT_TYPES = ['pay_in', 'pay_out', 'sale', 'refund', 'tip_out'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const cashMovementSchema = z.object({
  type: z.enum(['pay_in', 'pay_out', 'tip_out']),
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3).max(200),
});

export const closeDrawerSchema = z.object({
  /** Count per denomination in lek, e.g. { "1000": 3, "100": 12 }. */
  counts: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(100_000)),
  note: z.string().trim().max(500).nullish(),
  approvalToken: z.string().min(10).max(100).optional(),
});

export const noSaleSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  approvalToken: z.string().min(10).max(100).optional(),
});

// ---- Printing ----------------------------------------------------------------------------------

export const PRINTER_CONNECTIONS = ['network', 'usb', 'console'] as const;

export const printerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    connection: z.enum(PRINTER_CONNECTIONS),
    host: z.string().trim().max(120).nullish(),
    port: z.number().int().min(1).max(65_535).default(9100),
    devicePath: z.string().trim().max(200).nullish(),
    widthChars: z.union([z.literal(32), z.literal(42), z.literal(48)]).default(42),
    active: z.boolean().default(true),
  })
  .refine((p) => p.connection !== 'network' || Boolean(p.host), {
    message: 'hostRequired',
    path: ['host'],
  })
  .refine((p) => p.connection !== 'usb' || Boolean(p.devicePath), {
    message: 'devicePathRequired',
    path: ['devicePath'],
  });

export const printRoutesSchema = z.object({
  receiptPrinterId: z.number().int().positive().nullable(),
  reportPrinterId: z.number().int().positive().nullable(),
  stations: z.array(
    z.object({
      stationId: z.number().int().positive(),
      printerId: z.number().int().positive().nullable(),
    }),
  ),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).nullish(),
});

// ---- Response types ----------------------------------------------------------------------------

export type BillStatus = 'open' | 'paid' | 'refunded';
export type FiscalStatus = 'pending' | 'registered' | 'failed';

export interface Payment {
  id: number;
  uuid: string;
  billId: number;
  method: PaymentMethod;
  amountMinor: number;
  tipMinor: number;
  tenderedMinor: number | null;
  changeMinor: number;
  reference: string | null;
  refundedMinor: number;
  takenBy: string | null;
  createdAt: string;
}

export interface FiscalInfo {
  status: FiscalStatus;
  invoiceNumber: string;
  nslf: string | null;
  nivf: string | null;
  qrUrl: string | null;
}

export interface Bill {
  id: number;
  label: string;
  splitType: SplitType;
  /** Order item ids (by item / by seat splits). */
  itemIds: number[];
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  balanceMinor: number;
  status: BillStatus;
  tax: TaxLine[];
  payments: Payment[];
  fiscal: FiscalInfo | null;
  receiptToken: string;
  /** The digital receipt on the guest app (QR / link for the guest). */
  receiptUrl: string;
}

/** Everything the cashier screen needs for one order. */
export interface BillView {
  order: Order;
  totals: OrderTotals;
  discounts: {
    id: number;
    orderItemId: number | null;
    type: 'percent' | 'fixed';
    value: number;
    amountMinor: number;
    reason: string;
  }[];
  bills: Bill[];
  paidMinor: number;
  /** Total minus payments (refunds do not reopen a bill). */
  balanceMinor: number;
  serviceChargeBp: number;
  tipOptionsBp: number[];
}

export interface CashMovement {
  id: number;
  type: CashMovementType;
  amountMinor: number;
  reason: string | null;
  userName: string | null;
  createdAt: string;
}

export interface CashDrawer {
  id: number;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
  floatMinor: number;
  expectedMinor: number;
  countedMinor: number | null;
  differenceMinor: number | null;
  closedAt: string | null;
  movements: CashMovement[];
}

export interface ZReport {
  businessDate: string;
  generatedAt: string;
  closed: boolean;
  orders: number;
  grossSalesMinor: number;
  discountsMinor: number;
  serviceMinor: number;
  netSalesMinor: number;
  tax: TaxLine[];
  payments: { method: PaymentMethod; count: number; amountMinor: number }[];
  paymentsTotalMinor: number;
  tipsMinor: number;
  refunds: { count: number; amountMinor: number };
  voids: { count: number; amountMinor: number };
  items: { name: string; qty: number; amountMinor: number }[];
  waiters: { name: string; orders: number; salesMinor: number; tipsMinor: number }[];
  cash: {
    floatMinor: number;
    salesMinor: number;
    payInsMinor: number;
    payOutsMinor: number;
    refundsMinor: number;
    expectedMinor: number;
    countedMinor: number | null;
  };
  fiscal: { registered: number; pending: number; failed: number };
}

export interface Printer {
  id: number;
  name: string;
  connection: (typeof PRINTER_CONNECTIONS)[number];
  host: string | null;
  port: number;
  devicePath: string | null;
  widthChars: 32 | 42 | 48;
  active: boolean;
}

/** A receipt, ticket or report as lines; the print bridge turns it into ESC/POS. */
export interface PrintDocument {
  widthChars: number;
  lines: PrintLine[];
  cut: boolean;
  openDrawer?: boolean;
}

export type PrintLine =
  | {
      kind: 'text';
      text: string;
      align?: 'left' | 'center' | 'right';
      bold?: boolean;
      size?: 'normal' | 'double';
    }
  | { kind: 'rule' }
  | { kind: 'qr'; data: string }
  | { kind: 'feed'; lines: number };

export interface PrintJobPayload {
  jobId: number;
  printer: Pick<Printer, 'connection' | 'host' | 'port' | 'devicePath' | 'widthChars'>;
  document: PrintDocument;
}
