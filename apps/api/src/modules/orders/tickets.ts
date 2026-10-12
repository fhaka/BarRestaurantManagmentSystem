import type { Knex } from 'knex';
import type { KdsTicketStatus, OrderItemStatus } from '@tavolina/shared';

type Tx = Knex | Knex.Transaction;

export interface TicketChange {
  ticketId: number;
  stationId: number;
  status: KdsTicketStatus;
}

/**
 * A ticket's column follows its dishes: done once everything is served or voided, ready when
 * every fired dish is ready, in progress as soon as one is started.
 */
export function ticketStatusFor(
  items: { status: OrderItemStatus; held: boolean }[],
): KdsTicketStatus {
  const live = items.filter((i) => i.status !== 'voided');
  if (live.every((i) => i.status === 'served')) return 'done';
  const fired = live.filter((i) => !i.held && i.status !== 'served');
  if (fired.length && fired.every((i) => i.status === 'ready')) return 'ready';
  if (live.some((i) => i.status === 'preparing' || i.status === 'ready')) return 'in_progress';
  return 'new';
}

/** Recomputes the tickets holding these items; returns the ones whose status changed. */
export async function refreshTickets(trx: Tx, itemIds: number[]): Promise<TicketChange[]> {
  if (!itemIds.length) return [];
  const ticketIds = (
    await trx('kds_ticket_items').whereIn('order_item_id', itemIds).distinct('ticket_id')
  ).map((r) => Number(r.ticket_id));
  return refreshTicketsById(trx, ticketIds);
}

export async function refreshTicketsById(trx: Tx, ticketIds: number[]): Promise<TicketChange[]> {
  if (!ticketIds.length) return [];
  const tickets = await trx('kds_tickets')
    .whereIn('id', ticketIds)
    .select('id', 'station_id', 'status', 'started_at', 'bumped_at');
  const items = await trx('kds_ticket_items as k')
    .join('order_items as i', 'i.id', 'k.order_item_id')
    .whereIn('k.ticket_id', ticketIds)
    .select('k.ticket_id', 'i.status', 'i.held');
  const changes: TicketChange[] = [];
  for (const t of tickets) {
    const status = ticketStatusFor(
      items
        .filter((i) => Number(i.ticket_id) === Number(t.id))
        .map((i) => ({ status: i.status as OrderItemStatus, held: Boolean(i.held) })),
    );
    if (status === t.status) continue;
    const now = trx.fn.now(3);
    await trx('kds_tickets')
      .where({ id: t.id })
      .update({
        status,
        ...(status !== 'new' && !t.started_at ? { started_at: now } : {}),
        ...(status === 'ready' || status === 'done'
          ? t.bumped_at
            ? {}
            : { bumped_at: now }
          : { bumped_at: null }),
        done_at: status === 'done' ? now : null,
      });
    changes.push({ ticketId: Number(t.id), stationId: Number(t.station_id), status });
  }
  return changes;
}
