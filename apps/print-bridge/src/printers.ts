import { createWriteStream } from 'node:fs';
import { Socket } from 'node:net';
import type { PrintJobPayload } from '@tavolina/shared';
import { encode, renderText } from './escpos.js';

const TIMEOUT_MS = 8_000;

/** Raw TCP to the printer's port (9100 on almost every network thermal printer). */
function sendNetwork(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(TIMEOUT_MS, () => fail(new Error(`Printer ${host}:${port} did not answer`)));
    socket.once('error', fail);
    socket.connect(port, host, () => {
      socket.end(data, () => resolve());
    });
  });
}

/** USB / serial printers show up as a device file (e.g. /dev/usb/lp0, or \\.\COM3 on Windows). */
function sendDevice(path: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path, { flags: 'w' });
    stream.once('error', reject);
    stream.end(data, () => resolve());
  });
}

export async function print(
  job: PrintJobPayload,
  log: (text: string) => void = console.log,
): Promise<void> {
  const { printer, document } = job;
  switch (printer.connection) {
    case 'network':
      if (!printer.host) throw new Error('Network printer has no address');
      return sendNetwork(printer.host, printer.port, encode(document));
    case 'usb':
      if (!printer.devicePath) throw new Error('USB printer has no device path');
      return sendDevice(printer.devicePath, encode(document));
    case 'console':
      // For trying things out without a printer: the receipt appears in this window.
      log(renderText(document));
      return;
  }
}
