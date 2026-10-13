import type { PrintDocument, PrintLine } from '@tavolina/shared';

/**
 * Turns a Tavolina print document into ESC/POS bytes (Epson-compatible thermal printers).
 * Text is sent in code page 858 (Western European with €), which has every Albanian and Italian
 * letter we need; anything else prints as "?".
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC t 19 selects PC858 on Epson and most clones. */
const CODE_PAGE_858 = 19;

const CP858: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  ø: 0x9b,
  '£': 0x9c,
  Ø: 0x9d,
  '×': 0x9e,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  '«': 0xae,
  '»': 0xaf,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  Ê: 0xd2,
  Ë: 0xd3,
  È: 0xd4,
  '€': 0xd5,
  Í: 0xd6,
  Î: 0xd7,
  Ï: 0xd8,
  Ì: 0xde,
  Ó: 0xe0,
  Ô: 0xe2,
  Ò: 0xe3,
  Ú: 0xe9,
  Û: 0xea,
  Ù: 0xeb,
  '°': 0xf8,
  '·': 0xfa,
  '\u00a0': 0x20,
};

export function encodeText(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else out.push(CP858[ch] ?? 0x3f);
  }
  return out;
}

function qr(data: string): number[] {
  const bytes = [...Buffer.from(data, 'utf8')];
  const len = bytes.length + 3;
  return [
    // Model 2, module size 6, error correction M, store the data, print it.
    GS,
    0x28,
    0x6b,
    0x04,
    0x00,
    0x31,
    0x41,
    0x32,
    0x00,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x43,
    0x06,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x45,
    0x31,
    GS,
    0x28,
    0x6b,
    len & 0xff,
    len >> 8,
    0x31,
    0x50,
    0x30,
    ...bytes,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x51,
    0x30,
  ];
}

const ALIGN = { left: 0, center: 1, right: 2 } as const;

function line(l: PrintLine, width: number): number[] {
  switch (l.kind) {
    case 'rule':
      return [ESC, 0x61, 0, ...encodeText('-'.repeat(width)), LF];
    case 'feed':
      return [ESC, 0x64, Math.min(255, l.lines)];
    case 'qr':
      return [ESC, 0x61, 1, ...qr(l.data), LF, ESC, 0x61, 0];
    case 'text': {
      const double = l.size === 'double';
      return [
        ESC,
        0x61,
        ALIGN[l.align ?? 'left'],
        ESC,
        0x45,
        l.bold ? 1 : 0,
        GS,
        0x21,
        double ? 0x11 : 0x00,
        ...encodeText(l.text),
        LF,
        GS,
        0x21,
        0x00,
        ESC,
        0x45,
        0,
      ];
    }
  }
}

export function encode(doc: PrintDocument): Buffer {
  const bytes: number[] = [ESC, 0x40, ESC, 0x74, CODE_PAGE_858];
  for (const l of doc.lines) bytes.push(...line(l, doc.widthChars));
  // Kick the cash drawer (pin 2, 50 ms on / 500 ms off), then a partial cut after feeding.
  if (doc.openDrawer) bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa);
  if (doc.cut) bytes.push(GS, 0x56, 0x42, 0x00);
  return Buffer.from(bytes);
}

/** The same document as plain text, for the "console" printer type and for logs. */
export function renderText(doc: PrintDocument): string {
  const w = doc.widthChars;
  const pad = (t: string, align: 'left' | 'center' | 'right' = 'left') => {
    if (align === 'left' || t.length >= w) return t;
    const space = w - t.length;
    return align === 'right' ? ' '.repeat(space) + t : ' '.repeat(Math.floor(space / 2)) + t;
  };
  const out: string[] = [];
  for (const l of doc.lines) {
    if (l.kind === 'rule') out.push('-'.repeat(w));
    else if (l.kind === 'feed') out.push(...Array.from({ length: l.lines }, () => ''));
    else if (l.kind === 'qr') out.push(pad('[QR]', 'center'), pad(l.data.slice(0, w), 'center'));
    else out.push(pad(l.size === 'double' ? l.text.toUpperCase() : l.text, l.align));
  }
  if (doc.openDrawer) out.push('[open drawer]');
  if (doc.cut) out.push('='.repeat(w));
  return out.join('\n');
}
