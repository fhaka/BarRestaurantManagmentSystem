import { TIMEZONE } from '@tavolina/shared';
import { currentLocale } from '../i18n';

/** Date + time in the restaurant's timezone (Europe/Tirane), in the UI language. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** "19:30" in the restaurant's timezone. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

/** "Wed 14 Oct" in the restaurant's timezone and the UI language. */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
