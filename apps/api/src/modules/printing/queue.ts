import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { PrintDocument, PrintJobPayload, Printer } from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { sha256 } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

/**
 * Print jobs (plan §5.12). The API never talks to printers: it queues a job and hands it to the
 * restaurant's print bridge over Socket.IO (namespace /print-bridge, room per location). If no
 * printer is set for a job, nothing is queued and the screens remain the only output.
 */

export const PRINT_NAMESPACE = '/print-bridge';
const room = (locationId: number) => `print-bridge:${locationId}`;
let server: Server | null = null;

export function toPrinter(r: Record<string, unknown>): Printer {
  return {
    id: Number(r.id),
    name: String(r.name),
    connection: r.connection as Printer['connection'],
    host: (r.host as string | null) ?? null,
    port: Number(r.port),
    devicePath: (r.device_path as string | null) ?? null,
    widthChars: Number(r.width_chars) as Printer['widthChars'],
    active: Boolean(r.active),
  };
}

export async function printerFor(locationId: number, printerId: number | null | undefined) {
  if (!printerId) return null;
  const row = await db('printers')
    .where({ id: printerId, location_id: locationId, active: true })
    .first();
  return row ? toPrinter(row) : null;
}

async function payloadFor(jobId: number): Promise<PrintJobPayload | null> {
  const job = await db('print_jobs as j')
    .join('printers as p', 'p.id', 'j.printer_id')
    .where('j.id', jobId)
    .first(
      'j.id',
      'j.document',
      'p.connection',
      'p.host',
      'p.port',
      'p.device_path',
      'p.width_chars',
    );
  if (!job) return null;
  return {
    jobId: Number(job.id),
    printer: {
      connection: job.connection,
      host: job.host,
      port: Number(job.port),
      devicePath: job.device_path,
      widthChars: Number(job.width_chars) as Printer['widthChars'],
    },
    document: (typeof job.document === 'string'
      ? JSON.parse(job.document)
      : job.document) as PrintDocument,
  };
}

async function dispatch(locationId: number, jobId: number) {
  if (!server) return;
  const payload = await payloadFor(jobId);
  if (!payload) return;
  const sockets = await server.of(PRINT_NAMESPACE).in(room(locationId)).fetchSockets();
  if (!sockets.length) return; // Stays queued until a bridge connects.
  // Marked before sending: a fast bridge may confirm the print before this update would land.
  await db('print_jobs')
    .where({ id: jobId })
    .update({ status: 'sent', attempts: db.raw('attempts + 1') });
  server.of(PRINT_NAMESPACE).to(room(locationId)).emit('print.job', payload);
}

/** Queues a document for a printer; returns the job id, or null when no printer is set. */
export async function enqueue(
  locationId: number,
  printerId: number | null | undefined,
  kind: 'ticket' | 'receipt' | 'z_report' | 'drawer_kick',
  document: (printer: Printer) => PrintDocument | Promise<PrintDocument>,
): Promise<number | null> {
  const printer = await printerFor(locationId, printerId);
  if (!printer) return null;
  const [id] = await db('print_jobs').insert({
    location_id: locationId,
    printer_id: printer.id,
    kind,
    document: JSON.stringify(await document(printer)),
  });
  void dispatch(locationId, Number(id)).catch((err: unknown) =>
    logger.warn({ err, jobId: id }, 'Could not hand print job to the bridge'),
  );
  return Number(id);
}

export async function retryJob(locationId: number, jobId: number) {
  await db('print_jobs')
    .where({ id: jobId, location_id: locationId })
    .update({ status: 'queued', error: null });
  await dispatch(locationId, jobId);
}

const ackSchema = z.object({
  jobId: z.number().int().positive(),
  ok: z.boolean(),
  error: z.string().max(500).optional(),
});

/** The bridge signs in with its key, gets anything still queued, and reports each print. */
export function attachPrintBridge(io: Server) {
  server = io;
  const ns = io.of(PRINT_NAMESPACE);
  ns.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof token !== 'string' || token.length < 20) return next(new Error('unauthorized'));
    db('print_bridges')
      .where({ token_hash: sha256(token) })
      .whereNull('revoked_at')
      .first('id', 'location_id')
      .then((bridge) => {
        if (!bridge) return next(new Error('unauthorized'));
        socket.data = { bridgeId: Number(bridge.id), locationId: Number(bridge.location_id) };
        next();
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Print bridge authentication failed');
        next(new Error('unauthorized'));
      });
  });
  ns.on('connection', (socket: Socket) => {
    const { bridgeId, locationId } = socket.data as { bridgeId: number; locationId: number };
    const logFailure = (err: unknown) =>
      logger.warn({ err, bridgeId }, 'Print bridge update failed');
    void socket.join(room(locationId));
    // Knex queries only run when awaited or then-ed.
    db('print_bridges')
      .where({ id: bridgeId })
      .update({ last_seen_at: db.fn.now(3) })
      .then(() => flushQueued(locationId))
      .catch(logFailure);
    socket.on('print.ack', (raw: unknown) => {
      const parsed = ackSchema.safeParse(raw);
      if (!parsed.success) return;
      db('print_jobs')
        .where({ id: parsed.data.jobId, location_id: locationId })
        .update(
          parsed.data.ok
            ? { status: 'printed', printed_at: db.fn.now(3), error: null }
            : { status: 'failed', error: parsed.data.error ?? 'Printer error' },
        )
        .catch(logFailure);
    });
  });
}

/** Jobs that waited for a bridge (or were sent but never confirmed) go out again. */
async function flushQueued(locationId: number) {
  const jobs = await db('print_jobs')
    .where({ location_id: locationId })
    .where((q) =>
      q
        .where('status', 'queued')
        .orWhere((s) =>
          s.where('status', 'sent').where('created_at', '<', db.raw('NOW(3) - INTERVAL 2 MINUTE')),
        ),
    )
    .where('created_at', '>', db.raw('NOW(3) - INTERVAL 1 DAY'))
    .orderBy('id')
    .limit(50)
    .select('id');
  for (const j of jobs) await dispatch(locationId, Number(j.id));
}

export const bridgeTokenHash = sha256;
