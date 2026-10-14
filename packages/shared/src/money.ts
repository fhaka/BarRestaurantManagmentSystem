/**
 * Money helpers. All amounts are integers in minor units (1 lek = 100 minor units).
 * Never use floats for stored or transmitted money values.
 */

export const MINOR_PER_LEK = 100;

export type CurrencyDisplay = 'L' | 'ALL';

/** Non-breaking space, so "1 200 L" never wraps across lines. */
const NBSP = '\u00a0';

export function isMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function assertMinor(value: number): void {
  if (!isMinor(value)) {
    throw new TypeError(`Expected an integer amount in minor units, got ${String(value)}`);
  }
}

/** Converts a lek amount (possibly with decimals, e.g. from a form) to minor units. */
export function lekToMinor(lek: number): number {
  if (!Number.isFinite(lek)) throw new TypeError(`Invalid lek amount: ${String(lek)}`);
  return Math.round(lek * MINOR_PER_LEK);
}

export function minorToLek(minor: number): number {
  assertMinor(minor);
  return minor / MINOR_PER_LEK;
}

/**
 * Rounds a minor-unit amount to the nearest whole lek (half away from zero),
 * e.g. 12_345 → 12_300, 12_350 → 12_400, -150 → -200.
 */
export function roundToLek(minor: number): number {
  assertMinor(minor);
  const sign = minor < 0 ? -1 : 1;
  const abs = Math.abs(minor);
  return sign * Math.floor((abs + MINOR_PER_LEK / 2) / MINOR_PER_LEK) * MINOR_PER_LEK;
}

/** Groups an integer with spaces as thousands separators: 1234567 → "1 234 567". */
function groupThousands(n: number, separator: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export interface FormatMoneyOptions {
  /** Suffix style: "L" (default) or "ALL". */
  currency?: CurrencyDisplay;
  /** Show qindarka (decimals) when the amount is not a whole lek. Default: false (round). */
  showDecimals?: boolean;
}

/**
 * Formats minor units for display as Albanian lek: 120_000 → "1 200 L".
 * Uses non-breaking spaces as separators.
 */
export function formatMoney(minor: number, options: FormatMoneyOptions = {}): string {
  assertMinor(minor);
  const { currency = 'L', showDecimals = false } = options;
  const negative = minor < 0;
  const abs = Math.abs(minor);

  let body: string;
  if (showDecimals && abs % MINOR_PER_LEK !== 0) {
    const whole = Math.floor(abs / MINOR_PER_LEK);
    const fraction = String(abs % MINOR_PER_LEK).padStart(2, '0');
    body = `${groupThousands(whole, NBSP)},${fraction}`;
  } else {
    body = groupThousands(Math.abs(roundToLek(abs)) / MINOR_PER_LEK, NBSP);
  }

  return `${negative ? '−' : ''}${body}${NBSP}${currency}`;
}

/** A count or measure grouped like money ("3 517", "10,7"), so figures on one screen match. */
export function formatCount(value: number, decimals = 0): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const body =
    groupThousands(Number(whole), NBSP) + (fraction && Number(fraction) ? `,${fraction}` : '');
  return `${value < 0 ? '−' : ''}${body}`;
}
