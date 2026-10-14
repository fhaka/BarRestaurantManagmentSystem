import { TIMEZONE, timeToMinutes, zonedDateTime } from '@tavolina/shared';

/** "08:00"–"16:00" on a date; an end at or before the start is the next day. */
export function toRange(date: string, from: string, to: string) {
  let end = timeToMinutes(to);
  const start = timeToMinutes(from);
  if (end <= start) end += 24 * 60;
  return {
    startsAt: zonedDateTime(date, start, TIMEZONE).toISOString(),
    endsAt: zonedDateTime(date, end, TIMEZONE).toISOString(),
  };
}
