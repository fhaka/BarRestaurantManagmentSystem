import { printRoutesSchema, printerInputSchema, type Printer } from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { writeAudit, type ActorContext } from '../../lib/audit.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import * as locationRepo from '../locations/repo.js';
import { retryJob, toPrinter } from './queue.js';

interface Actor extends ActorContext {
  locationId: number;
}

const num = (v: unknown) => Number(v);

export async function listPrinters(actor: Actor): Promise<Printer[]> {
  return (await db('printers').where({ location_id: actor.locationId }).orderBy('id')).map(
    toPrinter,
  );
}

const row = (input: ReturnType<typeof printerInputSchema.parse>) => ({
  name: input.name,
  connection: input.connection,
  host: input.connection === 'network' ? (input.host ?? null) : null,
  port: input.port,
  device_path: input.connection === 'usb' ? (input.devicePath ?? null) : null,
  width_chars: input.widthChars,
  active: input.active,
});

export async function createPrinter(actor: Actor, raw: unknown): Promise<Printer> {
  const input = printerInputSchema.parse(raw);
  const [id] = await db('printers').insert({ location_id: actor.locationId, ...row(input) });
  await writeAudit(actor, {
    action: 'printer.created',
    entityType: 'printer',
    entityId: num(id),
    after: { name: input.name },
  });
  return toPrinter(await db('printers').where({ id }).first());
}

async function own(actor: Actor, id: number) {
  const printer = await db('printers').where({ id, location_id: actor.locationId }).first();
  if (!printer) throw AppError.notFound('Printer not found');
  return printer;
}

export async function updatePrinter(actor: Actor, id: number, raw: unknown): Promise<Printer> {
  await own(actor, id);
  const input = printerInputSchema.parse(raw);
  await db('printers').where({ id }).update(row(input));
  return toPrinter(await db('printers').where({ id }).first());
}

export async function deletePrinter(actor: Actor, id: number) {
  await own(actor, id);
  // Old jobs keep their history: the printer is only switched off and unlinked.
  await db('printers').where({ id }).update({ active: false });
  await db('stations').where({ printer_id: id }).update({ printer_id: null });
  const location = await locationRepo.findLocation(actor.locationId);
  const settings = { ...location!.settings };
  if (settings.receiptPrinterId === id) settings.receiptPrinterId = null;
  if (settings.reportPrinterId === id) settings.reportPrinterId = null;
  await locationRepo.updateLocation(actor.locationId, { settings });
}

/** Which printer prints what: receipts, Z reports, and each station's tickets. */
export async function getRoutes(actor: Actor) {
  const location = await locationRepo.findLocation(actor.locationId);
  const stations = await db('stations')
    .where({ location_id: actor.locationId })
    .orderBy('sort')
    .select('id', 'name', 'printer_id');
  return {
    receiptPrinterId: location!.settings.receiptPrinterId,
    reportPrinterId: location!.settings.reportPrinterId,
    stations: stations.map((s) => ({
      stationId: num(s.id),
      name: String(s.name),
      printerId: s.printer_id === null ? null : num(s.printer_id),
    })),
  };
}

export async function saveRoutes(actor: Actor, raw: unknown) {
  const input = printRoutesSchema.parse(raw);
  const ids = [
    input.receiptPrinterId,
    input.reportPrinterId,
    ...input.stations.map((s) => s.printerId),
  ].filter((v): v is number => v !== null);
  if (ids.length) {
    const found = await db('printers')
      .where({ location_id: actor.locationId })
      .whereIn('id', ids)
      .count({ n: '*' })
      .first();
    if (num(found?.n) !== new Set(ids).size) {
      throw new AppError(400, 'INVALID_REFERENCE', 'Choose printers of this location.');
    }
  }
  const location = await locationRepo.findLocation(actor.locationId);
  await db.transaction(async (trx) => {
    await locationRepo.updateLocation(
      actor.locationId,
      {
        settings: {
          ...location!.settings,
          receiptPrinterId: input.receiptPrinterId,
          reportPrinterId: input.reportPrinterId,
        },
      },
      trx,
    );
    for (const s of input.stations) {
      await trx('stations')
        .where({ id: s.stationId, location_id: actor.locationId })
        .update({ printer_id: s.printerId });
    }
    await writeAudit(
      actor,
      {
        action: 'printer.routes_changed',
        entityType: 'location',
        entityId: actor.locationId,
        after: input,
      },
      trx,
    );
  });
  return getRoutes(actor);
}

// ---- Print bridges -----------------------------------------------------------------------------

export async function listBridges(actor: Actor) {
  const rows = await db('print_bridges')
    .where({ location_id: actor.locationId })
    .whereNull('revoked_at')
    .orderBy('id');
  return rows.map((r) => ({
    id: num(r.id),
    name: String(r.name),
    lastSeenAt: r.last_seen_at ? (r.last_seen_at as Date).toISOString() : null,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

/** Creates a key for the print bridge PC; the key is shown once and only its hash is kept. */
export async function createBridge(actor: Actor, raw: unknown) {
  const name =
    String((raw as { name?: unknown })?.name ?? '')
      .trim()
      .slice(0, 80) || 'Print bridge';
  const token = `tpb_${randomToken(32)}`;
  const [id] = await db('print_bridges').insert({
    location_id: actor.locationId,
    name,
    token_hash: sha256(token),
  });
  await writeAudit(actor, {
    action: 'print_bridge.created',
    entityType: 'print_bridge',
    entityId: num(id),
    after: { name },
  });
  return { id: num(id), name, token };
}

export async function revokeBridge(actor: Actor, id: number) {
  const updated = await db('print_bridges')
    .where({ id, location_id: actor.locationId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now(3) });
  if (!updated) throw AppError.notFound('Print bridge not found');
  await writeAudit(actor, {
    action: 'print_bridge.revoked',
    entityType: 'print_bridge',
    entityId: id,
  });
}

export async function listJobs(actor: Actor) {
  const rows = await db('print_jobs as j')
    .join('printers as p', 'p.id', 'j.printer_id')
    .where('j.location_id', actor.locationId)
    .orderBy('j.id', 'desc')
    .limit(50)
    .select(
      'j.id',
      'j.kind',
      'j.status',
      'j.error',
      'j.attempts',
      'j.created_at',
      'j.printed_at',
      'p.name as printer',
    );
  return rows.map((r) => ({
    id: num(r.id),
    kind: r.kind,
    status: r.status,
    error: r.error,
    attempts: num(r.attempts),
    printer: r.printer,
    createdAt: (r.created_at as Date).toISOString(),
    printedAt: r.printed_at ? (r.printed_at as Date).toISOString() : null,
  }));
}

export async function retry(actor: Actor, jobId: number) {
  await retryJob(actor.locationId, jobId);
}
