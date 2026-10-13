import {
  formatMoney,
  type CurrencyDisplay,
  type FiscalInfo,
  type Lang,
  type PaymentMethod,
  type PrintDocument,
  type PrintLine,
  type TaxLine,
  type ZReport,
} from '@tavolina/shared';

/**
 * Receipts, kitchen tickets and the Z report as plain lines (plan §5.12). The print bridge turns
 * them into ESC/POS; screens can show the same lines. Receipts use the location's main language.
 */

const LABELS = {
  sq: {
    table: 'Tavolina',
    order: 'Porosia',
    waiter: 'Kamarieri',
    subtotal: 'Nëntotali',
    discount: 'Zbritje',
    service: 'Shërbimi',
    total: 'TOTALI',
    vat: 'TVSH',
    net: 'Pa TVSH',
    change: 'Kusuri',
    tip: 'Bakshish',
    cash: 'Kesh',
    card: 'Kartë',
    voucher: 'Kupon',
    account: 'Llogari',
    invoice: 'Fatura nr.',
    pending: 'Fiskalizimi në pritje',
    nslf: 'NSLF',
    nivf: 'NIVF',
    takeaway: 'Për ta marrë',
    delivery: 'Dërgesë',
    bill: 'Fatura',
    seat: 'Vendi',
    course: 'Radha',
    z: 'RAPORTI Z',
    xPreview: 'RAPORT X (paraprak)',
    date: 'Data',
    orders: 'Porosi',
    gross: 'Shitjet bruto',
    netSales: 'Shitjet neto',
    payments: 'Pagesat',
    tips: 'Bakshishe',
    refunds: 'Kthime',
    voids: 'Anulime',
    items: 'Artikujt',
    staff: 'Stafi',
    drawer: 'Arka',
    float: 'Fondi fillestar',
    expected: 'Pritet',
    counted: 'Numëruar',
    payIn: 'Hyrje',
    payOut: 'Dalje',
    fiscal: 'Fiskalizimi',
  },
  en: {
    table: 'Table',
    order: 'Order',
    waiter: 'Waiter',
    subtotal: 'Subtotal',
    discount: 'Discount',
    service: 'Service',
    total: 'TOTAL',
    vat: 'VAT',
    net: 'Net',
    change: 'Change',
    tip: 'Tip',
    cash: 'Cash',
    card: 'Card',
    voucher: 'Voucher',
    account: 'Account',
    invoice: 'Invoice no.',
    pending: 'Fiscal registration pending',
    nslf: 'IIC',
    nivf: 'FIC',
    takeaway: 'Takeaway',
    delivery: 'Delivery',
    bill: 'Bill',
    seat: 'Seat',
    course: 'Course',
    z: 'Z REPORT',
    xPreview: 'X REPORT (preview)',
    date: 'Date',
    orders: 'Orders',
    gross: 'Gross sales',
    netSales: 'Net sales',
    payments: 'Payments',
    tips: 'Tips',
    refunds: 'Refunds',
    voids: 'Voids',
    items: 'Items',
    staff: 'Staff',
    drawer: 'Cash drawer',
    float: 'Opening float',
    expected: 'Expected',
    counted: 'Counted',
    payIn: 'Pay in',
    payOut: 'Pay out',
    fiscal: 'Fiscal',
  },
  it: {
    table: 'Tavolo',
    order: 'Ordine',
    waiter: 'Cameriere',
    subtotal: 'Subtotale',
    discount: 'Sconto',
    service: 'Servizio',
    total: 'TOTALE',
    vat: 'IVA',
    net: 'Imponibile',
    change: 'Resto',
    tip: 'Mancia',
    cash: 'Contanti',
    card: 'Carta',
    voucher: 'Buono',
    account: 'Conto',
    invoice: 'Fattura n.',
    pending: 'Fiscalizzazione in attesa',
    nslf: 'NSLF',
    nivf: 'NIVF',
    takeaway: 'Asporto',
    delivery: 'Consegna',
    bill: 'Conto',
    seat: 'Posto',
    course: 'Portata',
    z: 'RAPPORTO Z',
    xPreview: 'RAPPORTO X (anteprima)',
    date: 'Data',
    orders: 'Ordini',
    gross: 'Vendite lorde',
    netSales: 'Vendite nette',
    payments: 'Pagamenti',
    tips: 'Mance',
    refunds: 'Rimborsi',
    voids: 'Annulli',
    items: 'Articoli',
    staff: 'Personale',
    drawer: 'Cassa',
    float: 'Fondo iniziale',
    expected: 'Atteso',
    counted: 'Contato',
    payIn: 'Entrata',
    payOut: 'Uscita',
    fiscal: 'Fiscale',
  },
} as const;

type Labels = (typeof LABELS)[Lang];
export const labelsFor = (lang: Lang): Labels => LABELS[lang] ?? LABELS.sq;

/** Thermal printers have no non-breaking space; plain spaces keep the columns. */
export const money = (minor: number, currency: CurrencyDisplay = 'L') =>
  formatMoney(minor, { currency }).replace(/\u00a0/g, ' ');

const text = (
  t: string,
  extra: Omit<Extract<PrintLine, { kind: 'text' }>, 'kind' | 'text'> = {},
): PrintLine => ({
  kind: 'text',
  text: t,
  ...extra,
});

/** "2× Kapuçino ......... 360 L" within the paper width (long names wrap). */
export function columns(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  if (left.length <= room) return [left + ' '.repeat(width - left.length - right.length) + right];
  const out: string[] = [];
  let rest = left;
  while (rest.length > room) {
    const cut = rest.lastIndexOf(' ', room);
    const at = cut > room / 2 ? cut : room;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  out.push(rest + ' '.repeat(Math.max(1, width - rest.length - right.length)) + right);
  return out;
}

const localTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(',', '');

export interface ReceiptInput {
  lang: Lang;
  widthChars: number;
  currency: CurrencyDisplay;
  timeZone: string;
  location: { name: string; address: string; nipt: string | null; header: string; footer: string };
  orderNumber: number;
  orderType: string;
  tableNames: string[];
  waiterName: string | null;
  billLabel: string | null;
  lines: { qty: number; name: string; details: string[]; amountMinor: number }[];
  subtotalMinor: number;
  discountMinor: number;
  serviceMinor: number;
  totalMinor: number;
  tax: TaxLine[];
  payments: { method: PaymentMethod; amountMinor: number; tipMinor: number; changeMinor: number }[];
  fiscal: FiscalInfo | null;
  printedAt: string;
}

export function receiptDocument(r: ReceiptInput): PrintDocument {
  const L = labelsFor(r.lang);
  const w = r.widthChars;
  const m = (v: number) => money(v, r.currency);
  const lines: PrintLine[] = [
    text(r.location.name, { align: 'center', bold: true, size: 'double' }),
  ];
  if (r.location.address) lines.push(text(r.location.address, { align: 'center' }));
  if (r.location.nipt) lines.push(text(`NIPT ${r.location.nipt}`, { align: 'center' }));
  for (const h of r.location.header.split('\n').filter(Boolean))
    lines.push(text(h, { align: 'center' }));
  lines.push({ kind: 'rule' });
  const where = r.tableNames.length
    ? `${L.table} ${r.tableNames.join(' + ')}`
    : r.orderType === 'delivery'
      ? L.delivery
      : L.takeaway;
  lines.push(...columns(where, `${L.order} #${r.orderNumber}`, w).map((t) => text(t)));
  lines.push(
    ...columns(
      localTime(r.printedAt, r.timeZone),
      r.waiterName ? `${L.waiter}: ${r.waiterName}` : '',
      w,
    ).map((t) => text(t)),
  );
  if (r.billLabel) lines.push(text(`${L.bill} ${r.billLabel}`, { bold: true }));
  lines.push({ kind: 'rule' });
  for (const l of r.lines) {
    lines.push(...columns(`${l.qty}× ${l.name}`, m(l.amountMinor), w).map((t) => text(t)));
    for (const d of l.details) lines.push(text(`   ${d}`));
  }
  lines.push({ kind: 'rule' });
  if (r.discountMinor || r.serviceMinor) {
    lines.push(...columns(L.subtotal, m(r.subtotalMinor), w).map((t) => text(t)));
    if (r.discountMinor)
      lines.push(...columns(L.discount, `-${m(r.discountMinor)}`, w).map((t) => text(t)));
    if (r.serviceMinor) lines.push(...columns(L.service, m(r.serviceMinor), w).map((t) => text(t)));
  }
  lines.push(
    text(columns(L.total, m(r.totalMinor), Math.floor(w / 2))[0]!, { bold: true, size: 'double' }),
  );
  for (const t of r.tax) {
    const pct = `${L.vat} ${t.rateBp / 100}%`;
    lines.push(
      ...columns(`${pct}  ${L.net} ${m(t.netMinor)}`, m(t.taxMinor), w).map((s) => text(s)),
    );
  }
  lines.push({ kind: 'rule' });
  for (const p of r.payments) {
    lines.push(...columns(L[p.method], m(p.amountMinor), w).map((t) => text(t)));
    if (p.tipMinor) lines.push(...columns(`  ${L.tip}`, m(p.tipMinor), w).map((t) => text(t)));
    if (p.changeMinor)
      lines.push(...columns(`  ${L.change}`, m(p.changeMinor), w).map((t) => text(t)));
  }
  if (r.fiscal) {
    lines.push({ kind: 'rule' });
    lines.push(text(`${L.invoice} ${r.fiscal.invoiceNumber}`));
    if (r.fiscal.status === 'registered' && r.fiscal.nslf && r.fiscal.nivf) {
      lines.push(text(`${L.nslf}: ${r.fiscal.nslf}`), text(`${L.nivf}: ${r.fiscal.nivf}`));
      if (r.fiscal.qrUrl) lines.push({ kind: 'qr', data: r.fiscal.qrUrl });
    } else {
      lines.push(text(L.pending, { bold: true }));
    }
  }
  for (const f of r.location.footer.split('\n').filter(Boolean))
    lines.push(text(f, { align: 'center' }));
  lines.push({ kind: 'feed', lines: 3 });
  return { widthChars: w, lines, cut: true };
}

export interface TicketInput {
  lang: Lang;
  widthChars: number;
  timeZone: string;
  stationName: string;
  ticketNumber: number;
  orderNumber: number;
  tableNames: string[];
  orderType: string;
  waiterName: string | null;
  createdAt: string;
  items: {
    qty: number;
    name: string;
    variantName: string | null;
    modifiers: string[];
    notes: string | null;
    seat: number | null;
    course: number | null;
    held: boolean;
  }[];
}

/** A kitchen / bar ticket: big dish names, notes impossible to miss. */
export function ticketDocument(t: TicketInput): PrintDocument {
  const L = labelsFor(t.lang);
  const where = t.tableNames.length
    ? `${L.table} ${t.tableNames.join(' + ')}`
    : t.orderType === 'delivery'
      ? L.delivery
      : L.takeaway;
  const lines: PrintLine[] = [
    text(t.stationName.toUpperCase(), { align: 'center', bold: true }),
    text(`#${t.ticketNumber}  ${where}`, { bold: true, size: 'double' }),
    text(
      `${L.order} #${t.orderNumber}  ${localTime(t.createdAt, t.timeZone)}${t.waiterName ? `  ${t.waiterName}` : ''}`,
    ),
    { kind: 'rule' },
  ];
  for (const i of t.items) {
    lines.push(
      text(`${i.qty}x ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`, {
        bold: true,
        size: 'double',
      }),
    );
    for (const mod of i.modifiers) lines.push(text(`   + ${mod}`));
    if (i.notes) lines.push(text(`   !! ${i.notes}`, { bold: true }));
    const meta = [
      i.seat ? `${L.seat} ${i.seat}` : null,
      i.course ? `${L.course} ${i.course}` : null,
    ].filter(Boolean);
    if (meta.length) lines.push(text(`   ${meta.join(' · ')}${i.held ? ' ...' : ''}`));
  }
  lines.push({ kind: 'feed', lines: 3 });
  return { widthChars: t.widthChars, lines, cut: true };
}

export function zReportDocument(
  z: ZReport,
  opts: {
    lang: Lang;
    widthChars: number;
    currency: CurrencyDisplay;
    locationName: string;
    timeZone: string;
  },
): PrintDocument {
  const L = labelsFor(opts.lang);
  const w = opts.widthChars;
  const m = (v: number) => money(v, opts.currency);
  const row = (a: string, b: string) => columns(a, b, w).map((t) => text(t));
  const lines: PrintLine[] = [
    text(opts.locationName, { align: 'center', bold: true }),
    text(z.closed ? L.z : L.xPreview, { align: 'center', bold: true, size: 'double' }),
    ...row(L.date, z.businessDate),
    ...row('', localTime(z.generatedAt, opts.timeZone)),
    { kind: 'rule' },
    ...row(L.orders, String(z.orders)),
    ...row(L.gross, m(z.grossSalesMinor)),
    ...row(L.discount, `-${m(z.discountsMinor)}`),
    ...row(L.service, m(z.serviceMinor)),
    text(columns(L.netSales, m(z.netSalesMinor), w)[0]!, { bold: true }),
  ];
  for (const t of z.tax)
    lines.push(...row(`${L.vat} ${t.rateBp / 100}%  ${L.net} ${m(t.netMinor)}`, m(t.taxMinor)));
  lines.push({ kind: 'rule' }, text(L.payments, { bold: true }));
  for (const p of z.payments) lines.push(...row(`${L[p.method]} (${p.count})`, m(p.amountMinor)));
  lines.push(...row(L.total, m(z.paymentsTotalMinor)), ...row(L.tips, m(z.tipsMinor)));
  lines.push(...row(`${L.refunds} (${z.refunds.count})`, `-${m(z.refunds.amountMinor)}`));
  lines.push(...row(`${L.voids} (${z.voids.count})`, m(z.voids.amountMinor)));
  lines.push({ kind: 'rule' }, text(L.drawer, { bold: true }));
  lines.push(...row(L.float, m(z.cash.floatMinor)), ...row(L.cash, m(z.cash.salesMinor)));
  lines.push(
    ...row(L.payIn, m(z.cash.payInsMinor)),
    ...row(L.payOut, `-${m(z.cash.payOutsMinor)}`),
  );
  lines.push(
    ...row(L.refunds, `-${m(z.cash.refundsMinor)}`),
    ...row(L.expected, m(z.cash.expectedMinor)),
  );
  if (z.cash.countedMinor !== null) lines.push(...row(L.counted, m(z.cash.countedMinor)));
  lines.push({ kind: 'rule' }, text(L.staff, { bold: true }));
  for (const s of z.waiters)
    lines.push(...row(`${s.name} (${s.orders})`, `${m(s.salesMinor)} / ${m(s.tipsMinor)}`));
  lines.push({ kind: 'rule' }, text(L.items, { bold: true }));
  for (const i of z.items) lines.push(...row(`${i.qty}× ${i.name}`, m(i.amountMinor)));
  lines.push({ kind: 'rule' });
  lines.push(...row(L.fiscal, `${z.fiscal.registered} / ${z.fiscal.pending} / ${z.fiscal.failed}`));
  lines.push({ kind: 'feed', lines: 3 });
  return { widthChars: w, lines, cut: true };
}

export const drawerKickDocument = (widthChars: number): PrintDocument => ({
  widthChars,
  lines: [],
  cut: false,
  openDrawer: true,
});
