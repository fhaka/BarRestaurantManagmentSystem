import { z } from 'zod';
import type { Lang } from './i18n.js';
import { newOrderItemSchema, type OrderItemStatus } from './orders.js';
import type { SessionStatus } from './floor.js';

// ---- Guest QR ordering (plan §5.5) -------------------------------------------------------------

/** Business rule 8: at most this many orders per guest session per minute. */
export const GUEST_ORDERS_PER_MINUTE = 5;

export const SERVICE_REQUEST_TYPES = ['call_waiter', 'bill_cash', 'bill_card'] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const guestOrderSchema = z.object({
  items: z.array(newOrderItemSchema).min(1).max(30),
});
export type GuestOrderInput = z.input<typeof guestOrderSchema>;

export const serviceRequestSchema = z.object({ type: z.enum(SERVICE_REQUEST_TYPES) });

export const blockGuestSchema = z.object({ blocked: z.boolean() });

/** What the QR page needs before showing the menu. */
export interface GuestTableInfo {
  location: { id: number; name: string; languages: Lang[]; defaultLang: Lang };
  table: { id: number; name: string };
  orderingEnabled: boolean;
  /** Orders wait for a waiter before reaching the kitchen. */
  requiresConfirmation: boolean;
}

/** A line of the table's order as guests see it (prices included; no staff details). */
export interface GuestOrderLine {
  id: number;
  uuid: string;
  /** Names are stored in the location's main language; the phone translates via these ids. */
  menuItemId: number | null;
  comboId: number | null;
  variantId: number | null;
  modifierIds: (number | null)[];
  name: string;
  variantName: string | null;
  modifiers: string[];
  qty: number;
  notes: string | null;
  status: OrderItemStatus;
  /** Ordered from this phone. */
  mine: boolean;
  /** Ordered by staff rather than from a phone. */
  byStaff: boolean;
  parentItemId: number | null;
  lineTotalMinor: number;
  addedAt: string;
}

export interface GuestTableState {
  /** Null when nobody is seated (the first order opens the table). */
  session: { status: SessionStatus; openedAt: string } | null;
  lines: GuestOrderLine[];
  totalMinor: number;
  myTotalMinor: number;
  /** Open requests from this table, so the buttons can say "waiter is coming". */
  openRequests: { type: ServiceRequestType; createdAt: string }[];
  blocked: boolean;
  /** Paid bills of this visit: links to the digital receipts. */
  receipts: { label: string; splitType: string; totalMinor: number; token: string }[];
  /** "Leave a review" once the table has paid (plan §5.5). */
  review: 'available' | 'done' | null;
}

/** A guest phone at a table, as staff see it (to block abuse). */
export interface GuestSessionSummary {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  lang: string | null;
  blocked: boolean;
  itemCount: number;
}

/** Open requests for the location (staff). */
export interface ServiceRequest {
  id: number;
  type: ServiceRequestType;
  tableId: number;
  tableName: string;
  tableSessionId: number | null;
  createdAt: string;
}
