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
