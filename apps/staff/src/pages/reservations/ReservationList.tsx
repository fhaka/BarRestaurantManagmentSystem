import { useTranslation } from 'react-i18next';
import { Globe, MessageSquareText } from 'lucide-react';
import type { Reservation } from '@tavolina/shared';
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@tavolina/ui';
import { formatTime } from '../../lib/format';
import { STATUS_TONE } from './reservation-utils';

export function ReservationList({
  reservations,
  onOpen,
}: {
  reservations: Reservation[];
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation('reservations');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('list.time')}</TableHead>
          <TableHead>{t('list.guest')}</TableHead>
          <TableHead numeric>{t('list.party')}</TableHead>
          <TableHead>{t('list.table')}</TableHead>
          <TableHead>{t('list.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reservations.map((r) => {
          const gone = r.status === 'cancelled' || r.status === 'no_show';
          return (
            <TableRow key={r.id} className={cn(gone && 'opacity-60')}>
              <TableCell className="font-mono font-bold tabular-nums">
                {formatTime(r.startsAt)}
              </TableCell>
              <TableCell>
                <button
                  type="button"
                  className={cn('text-left font-semibold hover:underline', gone && 'line-through')}
                  onClick={() => onOpen(r.id)}
                >
                  {r.name}
                </button>
                <span className="flex items-center gap-2 text-xs text-foreground-muted">
                  {r.phone}
                  {r.source === 'widget' ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Globe className="size-3" aria-hidden />
                      {t('source.widget')}
                    </span>
                  ) : null}
                  {r.notes ? (
                    <span className="inline-flex min-w-0 items-center gap-0.5">
                      <MessageSquareText className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{r.notes}</span>
                    </span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell numeric>{r.partySize}</TableCell>
              <TableCell>
                {r.tableName ?? <span className="text-foreground-muted">{t('unassigned')}</span>}
              </TableCell>
              <TableCell>
                <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
