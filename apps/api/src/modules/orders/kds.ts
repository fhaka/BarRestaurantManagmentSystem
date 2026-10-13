import type { Knex } from 'knex';
import type {
  Approver,
  KdsBoard,
  KdsTicket,
  KdsTicketItem,
  OrderItemStatus,
} from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { emitItemsChanged } from './events.js';
import * as repo from './repo.js';
import type { OrderActor } from './service.js';
import { syncComboParents } from './service.js';
import { refreshTicketsById } from './tickets.js';

type Tx = Knex | Knex.Transaction;

const iso = (v: unknown) => (v ? (v as Date).toISOString() : null);

async function stationFor(actor: OrderActor, stationId: number) {
  const station = await db('stations')
    .where({ id: stationId, location_id: actor.locationId })
    .first('id', 'name', 'type');
  if (!station) throw AppError.notFound('Station not found');
  return { id: Number(station.id), name: String(station.name), type: String(station.type) };
}

export async function loadTickets(
  trx: Tx,
  ticketRows: Record<string, unknown>[],
): Promise<KdsTicket[]> {
  if (!ticketRows.length) return [];
  const ids = ticketRows.map((t) => Number(t.id));
  const items = await trx('kds_ticket_items as k')
    .join('order_items as i', 'i.id', 'k.order_item_id')
    .leftJoin('order_items as p', 'p.id', 'i.parent_item_id')
    .whereIn('k.ticket_id', ids)
    .orderBy('i.id')
    .select('k.ticket_id', 'i.*', 'p.name_snapshot as combo_name');
  const mods = items.length
    ? await trx('order_item_modifiers')
        .whereIn(
          'order_item_id',
          items.map((i) => i.id),
        )
        .select('order_item_id', 'name_snapshot')
    : [];
  const orderIds = [...new Set(ticketRows.map((t) => Number(t.order_id)))];
  const orders = await trx('orders as o')
    .leftJoin('table_sessions as s', 's.id', 'o.table_session_id')
    .leftJoin('users as w', 'w.id', trx.raw('COALESCE(s.waiter_id, o.opened_by)'))
    .whereIn('o.id', orderIds)
    .select(
      'o.id',
      'o.number',
      'o.type',
      'o.table_session_id',
      'o.customer_name',
      'w.name as waiter_name',
    );
  const names = await repo.tableNamesForSessions(
    trx,
    orders.filter((o) => o.table_session_id).map((o) => Number(o.table_session_id)),
  );
  return ticketRows.map((t) => {
    const order = orders.find((o) => Number(o.id) === Number(t.order_id))!;
    const ticketItems: KdsTicketItem[] = items
      .filter((i) => Number(i.ticket_id) === Number(t.id))
      .map((i) => ({
        id: Number(i.id),
        name: String(i.name_snapshot),
        variantName: i.variant_name_snapshot ?? null,
        qty: Number(i.qty),
        seat: i.seat === null ? null : Number(i.seat),
        course: i.course === null ? null : (Number(i.course) as 1 | 2 | 3),
        held: Boolean(i.held),
        notes: i.notes ?? null,
        status: i.status as OrderItemStatus,
        modifiers: mods
          .filter((m) => Number(m.order_item_id) === Number(i.id))
          .map((m) => String(m.name_snapshot)),
        comboName: i.combo_name ?? null,
      }));
    return {
      id: Number(t.id),
      number: Number(t.number),
      status: t.status as KdsTicket['status'],
      stationId: Number(t.station_id),
      orderNumber: Number(order.number),
      orderType: order.type,
      tableNames: order.table_session_id ? (names.get(Number(order.table_session_id)) ?? []) : [],
      waiterName: order.waiter_name ?? null,
      customerName: order.customer_name ?? null,
      createdAt: iso(t.created_at)!,
      bumpedAt: iso(t.bumped_at),
      items: ticketItems,
    };
  });
}

/** One station's screen: open tickets oldest first, plus the last ten finished ones. */
export async function getBoard(actor: OrderActor, stationId: number): Promise<KdsBoard> {
  const station = await stationFor(actor, stationId);
  const open = await db('kds_tickets')
    .where({ station_id: stationId, location_id: actor.locationId })
    .whereIn('status', ['new', 'in_progress', 'ready'])
    .orderBy([{ column: 'created_at' }, { column: 'id' }]);
  const recent = await db('kds_tickets')
    .where({ station_id: stationId, location_id: actor.locationId, status: 'done' })
    .orderBy('done_at', 'desc')
    .limit(10);
  return { station, tickets: await loadTickets(db, open), recent: await loadTickets(db, recent) };
}

async function ticketFor(trx: Tx, actor: OrderActor, ticketId: number) {
  const ticket = await trx('kds_tickets')
    .where({ id: ticketId, location_id: actor.locationId })
    .forUpdate()
    .first();
  if (!ticket) throw AppError.notFound('Ticket not found');
  return ticket;
}

async function ticketItemIds(
  trx: Tx,
  ticketId: number,
  statuses: OrderItemStatus[],
): Promise<number[]> {
  return (
    await trx('kds_ticket_items as k')
      .join('order_items as i', 'i.id', 'k.order_item_id')
      .where('k.ticket_id', ticketId)
      .where('i.held', false)
      .whereIn('i.status', statuses)
      .select('i.id')
  ).map((r) => Number(r.id));
}

/** "Bump": every fired dish on the ticket is ready. */
export async function bumpTicket(actor: OrderActor, ticketId: number): Promise<KdsTicket> {
  const result = await db.transaction(async (trx) => {
    const ticket = await ticketFor(trx, actor, ticketId);
    const ids = await ticketItemIds(trx, ticketId, ['sent', 'preparing']);
    if (!ids.length)
      throw AppError.conflict('ORDER_ITEM_STATE', 'Nothing on this ticket is waiting.');
    const now = trx.fn.now(3);
    await trx('order_items').whereIn('id', ids).whereNull('started_at').update({ started_at: now });
    await trx('order_items').whereIn('id', ids).update({ status: 'ready', ready_at: now });
    await syncComboParents(trx, Number(ticket.order_id));
    const changes = await refreshTicketsById(trx, [ticketId]);
    return { orderId: Number(ticket.order_id), ids, changes };
  });
  await emitItemsChanged(actor.locationId, result.orderId, result.ids, result.changes);
  return (await loadTickets(db, [await db('kds_tickets').where({ id: ticketId }).first()]))[0]!;
}

/** "Recall": a bumped ticket goes back on the line (its ready dishes are being prepared again). */
export async function recallTicket(actor: OrderActor, ticketId: number): Promise<KdsTicket> {
  const result = await db.transaction(async (trx) => {
    const ticket = await ticketFor(trx, actor, ticketId);
    const ids = await ticketItemIds(trx, ticketId, ['ready']);
    if (!ids.length)
      throw AppError.conflict('ORDER_ITEM_STATE', 'Everything on this ticket was already served.');
    await trx('order_items').whereIn('id', ids).update({ status: 'preparing', ready_at: null });
    await syncComboParents(trx, Number(ticket.order_id));
    const changes = await refreshTicketsById(trx, [ticketId]);
    await writeAudit(
      actor,
      { action: 'kds.ticket_recalled', entityType: 'kds_ticket', entityId: ticketId },
      trx,
    );
    return { orderId: Number(ticket.order_id), ids, changes };
  });
  await emitItemsChanged(actor.locationId, result.orderId, result.ids, result.changes);
  return (await loadTickets(db, [await db('kds_tickets').where({ id: ticketId }).first()]))[0]!;
}

/** People at this location who can approve with their PIN (voids now, discounts and refunds later). */
export async function listApprovers(actor: OrderActor): Promise<Approver[]> {
  const rows = await db('user_locations as ul')
    .join('users as u', 'u.id', 'ul.user_id')
    .join('roles as r', 'r.id', 'ul.role_id')
    .join('role_permissions as rp', 'rp.role_id', 'r.id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where({ 'ul.location_id': actor.locationId, 'p.key': 'approval.grant', 'u.active': true })
    .whereNull('u.deleted_at')
    .whereNotNull('u.pin_hash')
    .orderBy('u.name')
    .select('u.id', 'u.name', 'r.key as role_key');
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), roleKey: String(r.role_key) }));
}

/** Stations a kitchen or bar screen can follow. */
export async function listStations(actor: OrderActor) {
  const rows = await db('stations')
    .where({ location_id: actor.locationId, active: true })
    .orderBy([{ column: 'sort' }, { column: 'id' }])
    .select('id', 'name', 'type');
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), type: String(r.type) }));
}
