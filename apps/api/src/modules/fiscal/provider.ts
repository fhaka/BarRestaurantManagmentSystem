import { createHash, randomUUID } from 'node:crypto';

/**
 * Albanian fiscalization (plan §5.11). The real DPT (tax authority) service signs every invoice
 * with the issuer's certificate and returns a unique invoice identifier. That integration must be
 * built and certified against the current DPT specification before go-live; until then
 * MockFiscalProvider returns realistic fake codes. See DECISIONS D-060.
 */

export interface FiscalTaxLine {
  rateBp: number;
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
}

/** Everything the real integration needs, captured at the moment of sale. */
export interface FiscalInvoicePayload {
  kind: 'invoice' | 'corrective';
  nipt: string | null;
  businessUnitCode: string;
  tcrCode: string;
  softwareCode: string;
  maintainerCode: string;
  operatorCode: string;
  /** Sequential per TCR per year, e.g. "23/2026/ef789gh012". */
  invoiceNumber: string;
  issuedAt: string;
  totalMinor: number;
  tax: FiscalTaxLine[];
  payments: { method: string; amountMinor: number }[];
  /** For corrective invoices (refunds): the invoice being corrected. */
  correctsNivf?: string | null;
}

export interface FiscalCashPayload {
  nipt: string | null;
  businessUnitCode: string;
  tcrCode: string;
  operatorCode: string;
  amountMinor: number;
  at: string;
}

export interface FiscalResult {
  /** Issuer security code (IIC). */
  nslf: string;
  /** Unique invoice identifier (FIC). */
  nivf: string;
  /** Verification link printed as a QR code on the receipt. */
  qrUrl: string;
}

export interface FiscalProvider {
  registerInvoice(invoice: FiscalInvoicePayload): Promise<FiscalResult>;
  registerCashDeposit(deposit: FiscalCashPayload): Promise<{ reference: string }>;
  registerWithdrawal(withdrawal: FiscalCashPayload): Promise<{ reference: string }>;
}

const VERIFY_URL = 'https://efiskalizimi-app-test.tatime.gov.al/invoice-check/#/verify';

/** Fake but realistic codes; can be told to fail to exercise the retry queue. */
export class MockFiscalProvider implements FiscalProvider {
  private failures = Number(process.env.FISCAL_MOCK_FAILURES ?? 0);

  /** The next `n` calls fail (tests, demos of "pending" receipts). */
  failNext(n: number) {
    this.failures = n;
  }

  private maybeFail() {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('Mock DPT service unavailable');
    }
  }

  async registerInvoice(invoice: FiscalInvoicePayload): Promise<FiscalResult> {
    this.maybeFail();
    // The real IIC is an MD5 of the RSA signature over these fields; the mock hashes the fields.
    const nslf = createHash('md5')
      .update(
        [
          invoice.nipt,
          invoice.issuedAt,
          invoice.invoiceNumber,
          invoice.businessUnitCode,
          invoice.tcrCode,
          invoice.softwareCode,
          invoice.totalMinor,
        ].join('|'),
      )
      .digest('hex')
      .toUpperCase();
    const params = new URLSearchParams({
      iic: nslf,
      tin: invoice.nipt ?? '',
      crtd: invoice.issuedAt,
      prc: (invoice.totalMinor / 100).toFixed(2),
    });
    return { nslf, nivf: randomUUID(), qrUrl: `${VERIFY_URL}?${params}` };
  }

  async registerCashDeposit(): Promise<{ reference: string }> {
    this.maybeFail();
    return { reference: randomUUID() };
  }

  async registerWithdrawal(): Promise<{ reference: string }> {
    this.maybeFail();
    return { reference: randomUUID() };
  }
}

let provider: FiscalProvider = new MockFiscalProvider();

export function fiscalProvider(): FiscalProvider {
  return provider;
}

/** Swap the provider (the real DPT client later; tests). */
export function setFiscalProvider(next: FiscalProvider) {
  provider = next;
}
