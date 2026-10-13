import type { Knex } from 'knex';
import type { FiscalInfo, FiscalStatus, TaxLine } from '@tavolina/shared';
import { db } from '../../db/knex.js';
import { logger } from '../../lib/logger.js';
import * as locationRepo from '../locations/repo.js';
import * as orderRepo from '../orders/repo.js';
import { fiscalProvider, type FiscalCashPayload, type FiscalInvoicePayload } from './provider.js';

const num = (v: unknown) => Number(v);

/** Retries back off from 30 s to an hour; after this many attempts the record is "failed". */
const MAX_ATTEMPTS = 12;

/** Operator code of a staff member at the till (issued by DPT per person; derived for now). */
export const operatorCode = (userId: number) => `op${String(userId).padStart(8, '0')}`;

type Kind = 'invoice' | 'corrective' | 'cash_deposit' | 'withdrawal';

/**
 * Records a fiscal registration as "pending" inside the caller's transaction. It is sent to the
 * provider after commit (see `registerNow`) and retried by the worker until it succeeds.
 */
export async function createFiscalRecord(
  trx: Knex.Transaction,
  input: {
    locationId: number;
    kind: Kind;
    userId: number;
    totalMinor: number;
    tax?: TaxLine[];
    payments?: { method: string; amountMinor: number }[];
    billId?: number;
    refundId?: number;
    drawerId?: number;
    correctsNivf?: string | null;
  },
): Promise<number> {
  const location = await locationRepo.findLocation(input.locationId, trx);
  const codes = location!.settings.fiscal;
  const now = new Date();
  const year = now.getUTCFullYear();
  let invoiceNumber: number | null = null;
  if (input.kind === 'invoice' || input.kind === 'corrective') {
    // Invoice numbers run per TCR per year (counter row dated 1 January).
    invoiceNumber = await orderRepo.nextNumber(trx, input.locationId, `${year}-01-01`, 'fiscal');
  }
  const base = {
    nipt: location!.nipt,
    businessUnitCode: codes.businessUnitCode,
    tcrCode: codes.tcrCode,
    operatorCode: operatorCode(input.userId),
  };
  const payload =
    invoiceNumber !== null
      ? ({
          ...base,
          kind: input.kind as 'invoice' | 'corrective',
          softwareCode: codes.softwareCode,
          maintainerCode: codes.maintainerCode,
          invoiceNumber: `${invoiceNumber}/${year}/${codes.tcrCode}`,
          issuedAt: now.toISOString(),
          totalMinor: input.totalMinor,
          tax: input.tax ?? [],
          payments: input.payments ?? [],
          correctsNivf: input.correctsNivf ?? null,
        } satisfies FiscalInvoicePayload)
      : ({
          ...base,
          amountMinor: input.totalMinor,
          at: now.toISOString(),
        } satisfies FiscalCashPayload);
  const [id] = await trx('fiscal_invoices').insert({
    location_id: input.locationId,
    kind: input.kind,
    bill_id: input.billId ?? null,
    refund_id: input.refundId ?? null,
    drawer_id: input.drawerId ?? null,
    business_unit_code: codes.businessUnitCode,
    tcr_code: codes.tcrCode,
    software_code: codes.softwareCode,
    operator_code: base.operatorCode,
    invoice_number: invoiceNumber,
    year,
    issued_at: now,
    total_minor: input.totalMinor,
    payload: JSON.stringify(payload),
  });
  return num(id);
}

/** Sends one pending record to the provider; on failure schedules the next attempt. */
export async function registerNow(id: number): Promise<FiscalStatus> {
  const row = await db('fiscal_invoices').where({ id }).first();
  if (!row || row.status === 'registered') return row?.status ?? 'failed';
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const provider = fiscalProvider();
  try {
    let update: Record<string, unknown>;
    if (row.kind === 'invoice' || row.kind === 'corrective') {
      const result = await provider.registerInvoice(payload as FiscalInvoicePayload);
      update = {
        nslf: result.nslf,
        nivf: result.nivf,
        qr_url: result.qrUrl,
        response: JSON.stringify(result),
      };
    } else {
      const result =
        row.kind === 'cash_deposit'
          ? await provider.registerCashDeposit(payload as FiscalCashPayload)
          : await provider.registerWithdrawal(payload as FiscalCashPayload);
      update = { nivf: result.reference, response: JSON.stringify(result) };
    }
    await db('fiscal_invoices')
      .where({ id })
      .update({
        ...update,
        status: 'registered',
        attempts: num(row.attempts) + 1,
        last_error: null,
      });
    return 'registered';
  } catch (err) {
    const attempts = num(row.attempts) + 1;
    const delaySeconds = Math.min(3600, 30 * 2 ** (attempts - 1));
    const status: FiscalStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    await db('fiscal_invoices')
      .where({ id })
      .update({
        status,
        attempts,
        last_error: String((err as Error).message ?? err).slice(0, 500),
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000),
      });
    logger.warn({ err, fiscalId: id, attempts }, 'Fiscal registration failed; will retry');
    return status;
  }
}

/** Fire-and-forget after a commit: the sale is never blocked by the tax service. */
export function registerSoon(ids: number[]) {
  for (const id of ids) {
    void registerNow(id).catch((err: unknown) =>
      logger.error({ err, fiscalId: id }, 'Fiscal error'),
    );
  }
}

/** The retry job: everything due, oldest first. Returns how many were tried. */
export async function retryDue(limit = 20): Promise<number> {
  const due = await db('fiscal_invoices')
    .where('status', 'pending')
    .where('next_attempt_at', '<=', db.fn.now(3))
    .orderBy('next_attempt_at')
    .limit(limit)
    .select('id');
  for (const r of due) await registerNow(num(r.id));
  return due.length;
}

let timer: NodeJS.Timeout | null = null;

export function startFiscalWorker(intervalMs = 30_000) {
  if (timer) return;
  timer = setInterval(() => {
    void retryDue().catch((err: unknown) => logger.error({ err }, 'Fiscal retry job failed'));
  }, intervalMs);
  timer.unref();
}

export function stopFiscalWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function fiscalForBills(billIds: number[]): Promise<Map<number, FiscalInfo>> {
  const out = new Map<number, FiscalInfo>();
  if (!billIds.length) return out;
  const rows = await db('fiscal_invoices')
    .whereIn('bill_id', billIds)
    .where('kind', 'invoice')
    .select('bill_id', 'status', 'invoice_number', 'year', 'tcr_code', 'nslf', 'nivf', 'qr_url');
  for (const r of rows) {
    out.set(num(r.bill_id), {
      status: r.status,
      invoiceNumber: `${r.invoice_number}/${r.year}/${r.tcr_code}`,
      nslf: r.nslf,
      nivf: r.nivf,
      qrUrl: r.qr_url,
    });
  }
  return out;
}
