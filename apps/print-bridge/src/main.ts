import { io } from 'socket.io-client';
import type { PrintJobPayload } from '@tavolina/shared';
import { print } from './printers.js';

/**
 * Tavolina print bridge (plan §5.12). Runs on a PC in the restaurant, keeps a connection to the
 * API and prints whatever it is sent. Configure with:
 *   TAVOLINA_API_URL     e.g. https://tavolina.example.com (default http://localhost:4100)
 *   TAVOLINA_BRIDGE_KEY  the key shown once under Settings → Printers → Print bridge
 */

const apiUrl = (process.env.TAVOLINA_API_URL ?? 'http://localhost:4100').replace(/\/$/, '');
const key = process.env.TAVOLINA_BRIDGE_KEY;
if (!key) {
  console.error('Set TAVOLINA_BRIDGE_KEY to the key from Settings → Printers.');
  process.exit(1);
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (message: string) => console.log(`[${stamp()}] ${message}`);

const socket = io(`${apiUrl}/print-bridge`, {
  path: '/socket.io',
  auth: { token: key },
  transports: ['websocket'],
  reconnectionDelayMax: 15_000,
});

socket.on('connect', () => log(`Connected to ${apiUrl}`));
socket.on('disconnect', (reason) => log(`Disconnected (${reason}); reconnecting…`));
socket.on('connect_error', (err) => log(`Cannot connect: ${err.message}`));

// One job at a time, in the order they arrive, so tickets never interleave.
let queue = Promise.resolve();
socket.on('print.job', (job: PrintJobPayload) => {
  queue = queue.then(async () => {
    const where =
      job.printer.connection === 'network'
        ? `${job.printer.host}:${job.printer.port}`
        : job.printer.connection;
    try {
      await print(job, (text) => console.log(text));
      log(`Printed job ${job.jobId} on ${where}`);
      socket.emit('print.ack', { jobId: job.jobId, ok: true });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      log(`Job ${job.jobId} failed on ${where}: ${message}`);
      socket.emit('print.ack', { jobId: job.jobId, ok: false, error: message.slice(0, 500) });
    }
  });
});

const stop = () => {
  socket.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
