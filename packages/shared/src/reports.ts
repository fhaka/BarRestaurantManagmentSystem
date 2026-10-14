import { z } from 'zod';
import type { OrderType } from './orders.js';
import type { PaymentMethod } from './billing.js';
import type { StockUnit } from './inventory-math.js';
import type { HoursRow } from './staff-time.js';

/** Plan §5.13: every report takes a date range (business days) and optionally several locations. */
export const reportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    /** "1,2"; empty = the current location. Only locations where the user may see reports. */
    locations: z
      .string()
      .regex(/^\d+(,\d+)*$/)
      .optional()
      .transform((v) => (v ? [...new Set(v.split(',').map(Number))] : [])),
  })
  .refine((q) => q.from <= q.to, { message: 'dateRange', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 366, {
    message: 'dateRange',
    path: ['to'],
  });
export type ReportQuery = z.input<typeof reportQuerySchema>;

/** Average of a total over a count, in whole minor units (0 when there is nothing). */
export function average(totalMinor: number, count: number): number {
  return count > 0 ? Math.round(totalMinor / count) : 0;
}

/** Change against a comparison value in basis points; null when there is nothing to compare. */
export function changeBp(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 10_000) / previous);
}

// ---- Live dashboard ----------------------------------------------------------------------------

export interface DashboardData {
  businessDate: string;
  generatedAt: string;
  /** Paid so far today. */
  revenueMinor: number;
  /** Same weekday last week, up to the same time of day. */
  revenueLastWeekMinor: number;
  orders: number;
  avgTicketMinor: number;
  covers: number;
  openTables: number;
  /** Still to be paid on open orders. */
  openOrdersMinor: number;
  /** Revenue per local hour (0–23) today and on the same weekday last week (whole day). */
  hourly: { hour: number; todayMinor: number; lastWeekMinor: number }[];
  topItems: { name: string; qty: number; revenueMinor: number }[];
  /** Average minutes from sent to ready, per station, today. */
  prepTimes: { stationId: number; name: string; avgMinutes: number; items: number }[];
  lowStock: { id: number; name: string; unit: StockUnit; stockMilli: number; minMilli: number }[];
  voids: { count: number; amountMinor: number };
}

// ---- Reports -----------------------------------------------------------------------------------

export interface SalesReport {
  totals: {
    revenueMinor: number;
    orders: number;
    covers: number;
    avgTicketMinor: number;
    taxMinor: number;
    discountMinor: number;
    refundsMinor: number;
    /** Revenue minus refunds. */
    netMinor: number;
  };
  daily: {
    date: string;
    revenueMinor: number;
    orders: number;
    covers: number;
    avgTicketMinor: number;
  }[];
  /** Revenue and orders by local weekday (0 = Monday) and hour of ordering. */
  heatmap: { weekday: number; hour: number; revenueMinor: number; orders: number }[];
  byCategory: { name: string; qty: number; revenueMinor: number }[];
  byType: { type: OrderType; orders: number; revenueMinor: number }[];
}

/** Product mix and margin (plan §5.13): sales before bill discounts, cost from today's recipes. */
export interface ItemsReport {
  rows: {
    menuItemId: number | null;
    name: string;
    category: string | null;
    qty: number;
    revenueMinor: number;
    netMinor: number;
    /** Null when the item has no recipe. */
    costMinor: number | null;
    marginMinor: number | null;
    marginBp: number | null;
    /** Share of item sales in basis points. */
    shareBp: number;
  }[];
}

export interface StaffReport {
  rows: {
    userId: number;
    name: string;
    orders: number;
    covers: number;
    revenueMinor: number;
    avgTicketMinor: number;
    tipsMinor: number;
    voids: number;
  }[];
}

export interface PaymentsReport {
  rows: { method: PaymentMethod; count: number; amountMinor: number; tipsMinor: number }[];
  refunds: { count: number; amountMinor: number };
  totalMinor: number;
}

export interface DiscountsVoidsReport {
  discounts: {
    at: string;
    date: string;
    orderNumber: number;
    reason: string;
    type: 'percent' | 'fixed';
    value: number;
    amountMinor: number;
    createdBy: string | null;
    approvedBy: string | null;
  }[];
  voids: {
    at: string;
    date: string;
    orderNumber: number;
    item: string;
    qty: number;
    amountMinor: number;
    reason: string | null;
    voidedBy: string | null;
    approvedBy: string | null;
  }[];
  refunds: {
    at: string;
    date: string;
    orderNumber: number;
    method: PaymentMethod;
    amountMinor: number;
    reason: string;
    createdBy: string | null;
    approvedBy: string | null;
  }[];
}

/** Inventory valuation, consumption, waste and count variance (plan §5.13). */
export interface InventoryReport {
  rows: {
    ingredientId: number;
    name: string;
    unit: StockUnit;
    category: string;
    stockMilli: number;
    valueMinor: number;
    purchasedMilli: number;
    consumedMilli: number;
    consumedMinor: number;
    wasteMilli: number;
    wasteMinor: number;
    varianceMilli: number;
    varianceMinor: number;
  }[];
}

export interface HoursReport {
  rows: HoursRow[];
}
