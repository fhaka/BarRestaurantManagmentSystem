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

// ---- Local dates ---------------------------------------------------------------------------------

/** "2026-10-14" + n days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week that contains `date`. */
export function weekStart(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** Minutes the local clock in `timeZone` is ahead of UTC at `at`. */
function utcOffsetMinutes(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const localAsUtc = Date.parse(`${p.date}T00:00:00Z`) + p.minutes * 60_000;
  return Math.round((localAsUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The moment the local clock in `timeZone` reads `minutes` after midnight on `date` (minutes may
 * pass 1440 for "02:00 the next night"). Correct across daylight-saving changes.
 */
export function zonedDateTime(date: string, minutes: number, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  let at = new Date(naive - utcOffsetMinutes(new Date(naive), timeZone) * 60_000);
  const second = new Date(naive - utcOffsetMinutes(at, timeZone) * 60_000);
  if (second.getTime() !== at.getTime()) at = second;
  return at;
}

/** "19:30" in the location's timezone. */
export function localTime(at: Date, timeZone: string): string {
  const m = localParts(at, timeZone).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
