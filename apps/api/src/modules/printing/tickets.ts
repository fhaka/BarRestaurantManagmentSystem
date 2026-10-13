import { db } from '../../db/knex.js';
import { logger } from '../../lib/logger.js';
import * as locationRepo from '../locations/repo.js';
import { loadTickets } from '../orders/kds.js';
import { ticketDocument } from './documents.js';
import { enqueue } from './queue.js';

/** "Send" can also print a station ticket (plan §5.4) when the station has a printer. */
export async function printTickets(locationId: number, ticketIds: number[]): Promise<void> {
  if (!ticketIds.length) return;
  const rows = await db('kds_tickets as t')
    .join('stations as s', 's.id', 't.station_id')
    .whereIn('t.id', ticketIds)
    .whereNotNull('s.printer_id')
    .select('t.*', 's.printer_id', 's.name as station_name');
  if (!rows.length) return;
  const location = await locationRepo.findLocation(locationId);
  const tickets = await loadTickets(db, rows);
  for (const ticket of tickets) {
    const row = rows.find((r) => Number(r.id) === ticket.id)!;
    await enqueue(locationId, Number(row.printer_id), 'ticket', (printer) =>
      ticketDocument({
        lang: location!.settings.defaultLang,
        widthChars: printer.widthChars,
        timeZone: location!.timezone,
        stationName: String(row.station_name),
        ticketNumber: ticket.number,
        orderNumber: ticket.orderNumber,
        tableNames: ticket.tableNames,
        orderType: ticket.orderType,
        waiterName: ticket.waiterName,
        createdAt: ticket.createdAt,
        items: ticket.items
          .filter((i) => i.status !== 'voided')
          .map((i) => ({
            qty: i.qty,
            name: i.name,
            variantName: i.variantName,
            modifiers: i.modifiers,
            notes: i.notes,
            seat: i.seat,
            course: i.course,
            held: i.held,
          })),
      }),
    ).catch((err: unknown) => logger.warn({ err, ticketId: ticket.id }, 'Ticket not printed'));
  }
}
