import { roomFor, type ItemStatusChangedData, type ItemsSentData } from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { emit, emitTableUpdated } from '../../realtime/server.js';
import * as repo from './repo.js';
import type { TicketChange } from './tickets.js';

/** Tells the stations (and the floor) that new items arrived. Hints only; clients refetch. */
export function emitItemsSent(
  locationId: number,
  orderId: number,
  sent: Omit<ItemsSentData, 'orderId'>,
): void {
  if (!sent.stationIds.length && !sent.ticketIds.length) return;
  const data: ItemsSentData = { orderId, ...sent };
  emit('order.items_sent', locationId, { ...data }, sent.stationIds.map(roomFor.station));
}

/**
 * Item status changes go to the whole location (floor colours, order screens). The waiter of the
 * table is named so their device can show a "food ready" toast.
 */
export async function emitItemsChanged(
  locationId: number,
  orderId: number,
  itemIds: number[],
  tickets: TicketChange[],
): Promise<void> {
  for (const t of tickets) {
    emit('kds.ticket_bumped', locationId, { ...t }, [roomFor.station(t.stationId)]);
  }
  if (!itemIds.length) return;
  const order = await db('orders as o')
    .leftJoin('table_sessions as s', 's.id', 'o.table_session_id')
    .where('o.id', orderId)
    .first('o.table_session_id', db.raw('COALESCE(s.waiter_id, o.opened_by) as waiter_id'));
  if (!order) return;
  const sessionId = order.table_session_id === null ? null : Number(order.table_session_id);
  const items = await db('order_items')
    .whereIn('id', itemIds)
    .select('id', 'name_snapshot', 'status');
  const names = sessionId
    ? ((await repo.tableNamesForSessions(db, [sessionId])).get(sessionId) ?? [])
    : [];
  const data: ItemStatusChangedData = {
    orderId,
    tableSessionId: sessionId,
    waiterId: order.waiter_id === null ? null : Number(order.waiter_id),
    tableNames: names,
    items: items.map((i) => ({
      id: Number(i.id),
      name: String(i.name_snapshot),
      status: String(i.status),
    })),
  };
  emit('order_item.status_changed', locationId, { ...data });
  if (sessionId) {
    const tableIds = (
      await db('table_session_tables').where({ session_id: sessionId }).select('table_id')
    ).map((r) => Number(r.table_id));
    if (tableIds.length) emitTableUpdated(locationId, tableIds);
  }
}
