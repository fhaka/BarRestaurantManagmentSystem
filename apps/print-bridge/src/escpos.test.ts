import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { PrintDocument } from '@tavolina/shared';
import { encode, encodeText, renderText } from './escpos.js';
import { print } from './printers.js';

const doc: PrintDocument = {
  widthChars: 32,
  lines: [
    { kind: 'text', text: 'Bar Restaurant Las Vegas', align: 'center', bold: true, size: 'double' },
    { kind: 'rule' },
    { kind: 'text', text: '2× Kapuçino              360 L' },
    { kind: 'text', text: 'Shërbimi                   0 L' },
    { kind: 'qr', data: 'https://example.test/verify?iic=ABC' },
    { kind: 'feed', lines: 3 },
  ],
  cut: true,
  openDrawer: true,
};

describe('ESC/POS encoder', () => {
  it('writes Albanian and Italian letters in code page 858', () => {
    expect(encodeText('ëËçÇ')).toEqual([0x89, 0xd3, 0x87, 0x80]);
    expect(encodeText('àèéìòù')).toEqual([0x85, 0x8a, 0x82, 0x8d, 0x95, 0x97]);
    expect(encodeText('2× 5€')).toEqual([0x32, 0x9e, 0x20, 0x35, 0xd5]);
    expect(encodeText('😀')).toEqual([0x3f]);
  });

  it('starts with init + code page, ends with drawer kick and cut', () => {
    const bytes = [...encode(doc)];
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(bytes.slice(-9)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1d, 0x56, 0x42, 0x00]);
    // Double size on, then back to normal.
    const text = Buffer.from(bytes).indexOf(Buffer.from('Bar Restaurant'));
    expect(bytes.slice(text - 3, text)).toEqual([0x1d, 0x21, 0x11]);
    // The QR code is stored with its length (data + 3).
    const data = Buffer.from('https://example.test/verify?iic=ABC');
    const at = Buffer.from(bytes).indexOf(data);
    expect(bytes.slice(at - 8, at)).toEqual([
      0x1d,
      0x28,
      0x6b,
      data.length + 3,
      0,
      0x31,
      0x50,
      0x30,
    ]);
  });

  it('renders the same document as text for the console printer', () => {
    const text = renderText(doc);
    expect(text).toContain('BAR RESTAURANT LAS VEGAS');
    expect(text).toContain('-'.repeat(32));
    expect(text).toContain('[open drawer]');
  });
});

describe('network printing', () => {
  it('sends the bytes to the printer port', async () => {
    const received: Buffer[] = [];
    const server = createServer((socket) => socket.on('data', (d: Buffer) => received.push(d)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await print({
      jobId: 1,
      printer: { connection: 'network', host: '127.0.0.1', port, devicePath: null, widthChars: 32 },
      document: doc,
    });
    await new Promise((r) => setTimeout(r, 50));
    server.close();
    expect(Buffer.concat(received)).toEqual(encode(doc));
  });

  it('reports a printer that is not there', async () => {
    await expect(
      print({
        jobId: 2,
        printer: {
          connection: 'network',
          host: '127.0.0.1',
          port: 1,
          devicePath: null,
          widthChars: 32,
        },
        document: doc,
      }),
    ).rejects.toThrow();
  });
});
