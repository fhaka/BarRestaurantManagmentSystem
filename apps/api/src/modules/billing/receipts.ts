import QRCode from 'qrcode';
import type { PaymentMethod, PrintDocument, TaxLine } from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { AppError } from '../../lib/errors.js';
import { fiscalForBills } from '../fiscal/service.js';
import * as locationRepo from '../locations/repo.js';
import * as orderRepo from '../orders/repo.js';
import { receiptDocument } from '../printing/documents.js';
import { enqueue } from '../printing/queue.js';
import { loadTotals } from './totals.js';

const num = (v: unknown) => Number(v);

/**
 * The customer receipt of one bill. Lines are the bill's own dishes (by item / by seat) or the
 * whole order for equal and custom splits; the amounts always add up to what was paid.
 */
export async function receiptForBill(billId: number, widthChars: number): Promise<PrintDocument> {
  const bill = await db('bills').where({ id: billId }).first();
  if (!bill) throw AppError.notFound('Receipt not found');
  const order = await orderRepo.loadOrder(db, num(bill.order_id));
  const location = (await locationRepo.findLocation(
    num((await db('orders').where({ id: bill.order_id }).first('location_id')).location_id),
  ))!;
  const { totals } = await loadTotals(db, order.id);
  const ownIds = (await db('bill_items').where({ bill_id: billId }).select('order_item_id')).map(
    (r) => num(r.order_item_id),
  );
  const partial = bill.split_type === 'items' || bill.split_type === 'seat';
  const share = bill.split_type === 'equal' || bill.split_type === 'custom';
  const included = (id: number) => !partial || ownIds.includes(id);
  const top = order.items.filter(
    (i) => i.parentItemId === null && i.status !== 'voided' && included(i.id),
  );
  const lines = top
    .filter((i) => i.status !== 'draft' && i.status !== 'pending_confirmation')
    .map((i) => {
      const parts = order.items.filter((c) => c.parentItemId === i.id && c.status !== 'voided');
      return {
        qty: i.qty,
        name: i.variantName ? `${i.name} (${i.variantName})` : i.name,
        details: [...i.modifiers.map((m) => m.name), ...parts.map((c) => c.name)],
        amountMinor: i.lineTotalMinor + parts.reduce((s, c) => s + c.lineTotalMinor, 0),
      };
    });
  const own = totals.lines.filter((l) => included(l.id));
  const billTotal = num(bill.total_minor);
  let subtotal = totals.subtotalMinor;
  let service = totals.serviceMinor;
  let discount = totals.discountMinor;
  if (partial) {
    // This guest's dishes: their share of discounts and service; amounts add up to the bill.
    subtotal = own.reduce((s, l) => s + l.grossMinor, 0);
    service = own.reduce((s, l) => s + l.serviceMinor, 0);
    discount = Math.max(0, subtotal + service - billTotal);
  } else if (share) {
    // A share of the whole order: list the order, then just this share's amount.
    service = 0;
    discount = 0;
  }
  const payments = await db('payments').where({ bill_id: billId }).orderBy('id');
  const fiscal = (await fiscalForBills([billId])).get(billId) ?? null;
  const tax = (typeof bill.tax === 'string' ? JSON.parse(bill.tax) : bill.tax) as TaxLine[];
  return receiptDocument({
    lang: location.settings.defaultLang,
    widthChars,
    currency: location.settings.currencyDisplay,
    timeZone: location.timezone,
    location: {
      name: location.name,
      address: location.address,
      nipt: location.nipt,
      header: location.settings.receiptHeader,
      footer: location.settings.receiptFooter,
    },
    orderNumber: order.number,
    orderType: order.type,
    tableNames: order.tableNames,
    waiterName: order.waiterName,
    billLabel:
      bill.split_type === 'full' ? null : bill.label.replace('seat:', '#').replace('shared', '*'),
    lines,
    subtotalMinor: subtotal,
    discountMinor: discount,
    serviceMinor: service,
    totalMinor: billTotal,
    tax,
    payments: payments.map((p) => ({
      method: p.method as PaymentMethod,
      amountMinor: num(p.amount_minor),
      tipMinor: num(p.tip_minor),
      changeMinor: num(p.change_minor),
    })),
    fiscal,
    printedAt: new Date().toISOString(),
  });
}

/** Prints a bill's receipt on the location's receipt printer (if one is set). */
export async function printReceipt(locationId: number, billId: number): Promise<number | null> {
  const location = await locationRepo.findLocation(locationId);
  return enqueue(locationId, location?.settings.receiptPrinterId, 'receipt', (printer) =>
    receiptForBill(billId, printer.widthChars),
  );
}

/** The digital receipt behind the QR code / link (public, by the bill's random token). */
export async function digitalReceipt(token: string) {
  const bill = await db('bills').where({ receipt_token: token }).first('id', 'status');
  if (!bill || bill.status === 'open') throw AppError.notFound('Receipt not found');
  const document = await receiptForBill(num(bill.id), 42);
  const fiscal = (await fiscalForBills([num(bill.id)])).get(num(bill.id)) ?? null;
  const qrSvg = fiscal?.qrUrl
    ? await QRCode.toString(fiscal.qrUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
    : null;
  return { document, fiscal, qrSvg };
}
