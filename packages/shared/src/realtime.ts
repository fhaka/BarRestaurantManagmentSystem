import { z } from 'zod';

/**
 * Socket.IO events (plan §9). Events are hints: clients refetch from the REST API, which stays the
 * source of truth, and refetch everything after a reconnect.
 */
export const REALTIME_EVENTS = [
  'table.updated',
  'menu.item_availability',
  'order.items_sent',
  'order_item.status_changed',
  'kds.ticket_bumped',
  'service_request.created',
  'guest_order.pending',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENTS)[number];

export const realtimeEnvelopeSchema = z.object({
  type: z.enum(REALTIME_EVENTS),
  locationId: z.number().int().positive(),
  at: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const tableUpdatedDataSchema = z.object({
  tableIds: z.array(z.number().int().positive()),
  /** True when the layout (not just a session) changed: tables or areas added/moved/removed. */
  layout: z.boolean().default(false),
});

export const itemAvailabilityDataSchema = z.object({
  itemId: z.number().int().positive(),
  outOfStockUntil: z.string().nullable(),
});

export interface RealtimeEnvelope<T = Record<string, unknown>> {
  type: RealtimeEventType;
  locationId: number;
  at: string;
  data: T;
}

export interface ItemsSentData {
  orderId: number;
  stationIds: number[];
  ticketIds: number[];
}

export interface ItemStatusChangedData {
  orderId: number;
  tableSessionId: number | null;
  waiterId: number | null;
  tableNames: string[];
  items: { id: number; name: string; status: string }[];
}

export interface TicketBumpedData {
  ticketId: number;
  stationId: number;
  status: string;
}

export interface ServiceRequestCreatedData {
  requestId: number;
  type: string;
  tableId: number;
  tableName: string;
  tableSessionId: number | null;
  /** The table's waiter; null when nobody has taken the table yet (tell everyone). */
  waiterId: number | null;
}

export interface GuestOrderPendingData {
  orderId: number;
  tableSessionId: number;
  tableNames: string[];
  waiterId: number | null;
  itemCount: number;
}

/** A KDS screen asks to receive one station's tickets. */
export const stationJoinSchema = z.object({ stationId: z.number().int().positive() });

/** Sent by the client in the Socket.IO handshake (`auth`). */
export const socketAuthSchema = z.object({
  token: z.string().min(1),
  locationId: z.coerce.number().int().positive(),
});

/**
 * Guests' phones use their own namespace and only ever hear "something changed at your table"
 * (`guest.updated`), then refetch their table state.
 */
export { GUEST_NAMESPACE } from './constants.js';
export const guestSocketAuthSchema = z.object({ tableToken: z.string().min(10).max(64) });

export const roomFor = {
  location: (id: number) => `location:${id}`,
  user: (id: number) => `user:${id}`,
  station: (id: number) => `station:${id}`,
  tableSession: (id: number) => `table-session:${id}`,
  table: (id: number) => `table:${id}`,
};
