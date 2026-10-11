/**
 * Local-time helpers. Business rules (happy hours, category schedules, business days) are
 * evaluated in the location's timezone, Europe/Tirane, never in the server's or browser's zone.
 */

export interface LocalParts {
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAYS[parts.weekday!] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** "07:30" → 450. */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const ALL_WEEKDAYS_MASK = 0b1111111;

export function weekdayInMask(weekday: number, mask: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

/**
 * True when `minutes` falls in [from, to). A window that ends before it starts crosses
 * midnight (e.g. 22:00–02:00). Missing bounds mean "all day".
 */
export function inTimeWindow(
  minutes: number,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (!from || !to) return true;
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * The next moment the local clock in `timeZone` reads `hh:mm` (strictly after `from`).
 * Used for "out of stock until tomorrow morning". Handles DST by searching minute offsets.
 */
export function nextLocalTime(from: Date, hhmm: string, timeZone: string): Date {
  const target = timeToMinutes(hhmm);
  const { minutes } = localParts(from, timeZone);
  let delta = target - minutes;
  if (delta <= 0) delta += 24 * 60;
  // Start from the naive guess, then correct for a DST shift within ±2 hours.
  const base = new Date(from.getTime() + delta * 60_000);
  base.setUTCSeconds(0, 0);
  for (const shift of [0, -60, 60, -120, 120]) {
    const candidate = new Date(base.getTime() + shift * 60_000);
    if (candidate > from && localParts(candidate, timeZone).minutes === target) return candidate;
  }
  return base;
}
