import { useQuery } from '@tanstack/react-query';
import { TIMEZONE, addDays, businessDate, formatCount, weekStart } from '@tavolina/shared';
import { currentLocale } from '../../i18n';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

export interface Range {
  from: string;
  to: string;
}

export const PRESETS = [
  'today',
  'yesterday',
  'last7',
  'thisWeek',
  'last30',
  'thisMonth',
  'lastMonth',
] as const;
export type Preset = (typeof PRESETS)[number];

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/** Ranges in business days (04:00–04:00), like every report. */
export function presetRange(preset: Preset): Range {
  const today = businessDate(new Date(), TIMEZONE);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'thisWeek':
      return { from: weekStart(today), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: monthStart(today), to: today };
    case 'lastMonth': {
      const end = addDays(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
  }
}

/** One report for a range and locations; every report key starts with "reports". */
export function useReport<T>(name: string, range: Range, locations: number[]) {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['reports', name, locationId, range, locations],
    queryFn: () => {
      const q = new URLSearchParams(range as unknown as Record<string, string>);
      if (locations.length) q.set('locations', locations.join(','));
      return api<T>('GET', `/reports/${name}?${q}`);
    },
    enabled: range.from <= range.to,
    placeholderData: (previous) => previous,
  });
}

/** 1 234 567 minor units → "12 346 L" for chart axes: whole lek, grouped, short above a million. */
export function axisMoney(minor: number): string {
  const lek = minor / 100;
  if (Math.abs(lek) >= 1_000_000) {
    return `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(lek / 1_000_000)}M`;
  }
  if (Math.abs(lek) >= 10_000) {
    return `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(lek / 1000)}k`;
  }
  return new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 }).format(lek);
}

/** Counts grouped like money ("3 517"), so figures side by side read the same way. */
export const formatNumber = (n: number, digits = 0) => formatCount(n, digits);

export const formatBp = (bp: number | null) => (bp === null ? '—' : `${formatCount(bp / 100, 1)}%`);

/**
 * Plan §5.13: every report exports to CSV. Built from the data on screen, with the column names in
 * the user's language; amounts in lek with two decimals; a BOM so Excel reads ë and ç.
 */
export function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number | null)[][],
) {
  const cell = (v: string | number | null) => {
    const text = v === null ? '' : String(v);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minor units as a plain CSV number of lek ("1234.50"). */
export const csvLek = (minor: number | null) => (minor === null ? null : (minor / 100).toFixed(2));
/** Thousandths as a plain CSV quantity. */
export const csvQty = (milli: number) => (milli / 1000).toFixed(3);
