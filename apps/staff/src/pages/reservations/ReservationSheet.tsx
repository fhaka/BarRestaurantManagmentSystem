import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Ban,
  CalendarCheck,
  CircleCheck,
  Globe,
  Pencil,
  Phone,
  RotateCcw,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  TIMEZONE,
  canTransitionReservation,
  localParts,
  type FloorState,
  type Reservation,
  type ReservationStatus,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatDay, formatTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { STATUS_TONE } from './reservation-utils';

export function ReservationSheet({
  reservation,
  onClose,
  onEdit,
}: {
  reservation: Reservation | null;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
}) {
  const { t } = useTranslation('reservations');
  return (
    <Sheet open={reservation !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md">
        {reservation ? (
          <Details key={reservation.id} r={reservation} onClose={onClose} onEdit={onEdit} />
        ) : (
          <SheetTitle className="sr-only">{t('title')}</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({
  r,
  onClose,
  onEdit,
}: {
  r: Reservation;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = useErrorMessages();
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const manage = can('reservation.manage');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['floor'] });
  };

  const status = useMutation({
    mutationFn: (to: ReservationStatus) =>
      api<Reservation>('POST', `/reservations/${r.id}/status`, { body: { status: to } }),
    onSuccess: () => {
      refresh();
      toast.success(t('detail.statusChanged'));
      setConfirmCancel(false);
    },
    onError: (err) => toast.error(message(err)),
  });
  const seat = useMutation({
    mutationFn: () =>
      api<FloorState>('POST', '/table-sessions', {
        body: {
          uuid: crypto.randomUUID(),
          tableId: r.tableId,
          guestCount: r.partySize,
          reservationId: r.id,
        },
      }),
    onSuccess: (floor) => {
      refresh();
      toast.success(t('detail.seated', { name: r.tableName }));
      const session = floor.tables.find((x) => x.id === r.tableId)?.session;
      onClose();
      if (session && can('order.create')) navigate(`/floor/sessions/${session.id}`);
    },
    onError: (err) => toast.error(message(err)),
  });

  const date = localParts(new Date(r.startsAt), TIMEZONE).date;
  const upcoming = r.status === 'booked' || r.status === 'confirmed';
  const action = (
    to: ReservationStatus,
    label: string,
    icon: ReactNode,
    variant: 'primary' | 'outline' | 'ghost' = 'outline',
  ) =>
    manage && canTransitionReservation(r.status, to) ? (
      <Button
        variant={variant}
        loading={status.isPending && status.variables === to}
        onClick={() => (to === 'cancelled' ? setConfirmCancel(true) : status.mutate(to))}
      >
        {icon}
        {label}
      </Button>
    ) : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">
          {r.name}
          <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
        </SheetTitle>
        <SheetDescription>
          {t('detail.at', { date: formatDay(date), time: formatTime(r.startsAt) })}
        </SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-3 rounded-card border border-border p-4 text-sm">
        <div>
          <dt className="text-foreground-muted">{t('form.partySize')}</dt>
          <dd className="text-lg font-bold">{r.partySize}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">{t('detail.table')}</dt>
          <dd className="text-lg font-bold">
            {r.tableName
              ? `${r.tableName}${r.areaName ? ` · ${r.areaName}` : ''}`
              : t('unassigned')}
          </dd>
        </div>
        <div>
          <dt className="text-foreground-muted">{t('form.duration')}</dt>
          <dd className="font-semibold">
            {formatTime(r.startsAt)}–{formatTime(r.endsAt)} ·{' '}
            {t('detail.duration', { count: r.durationMin })}
          </dd>
        </div>
        <div>
          <dt className="text-foreground-muted">{t('form.phone')}</dt>
          <dd>
            <a
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              href={`tel:${r.phone.replace(/\s/g, '')}`}
            >
              <Phone className="size-3.5" aria-hidden />
              {r.phone}
            </a>
          </dd>
        </div>
      </dl>
      {r.notes ? <p className="rounded-card bg-surface-sunken p-3 text-sm">{r.notes}</p> : null}
      <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
        {r.source === 'widget' ? (
          <>
            <Globe className="size-3.5" aria-hidden />
            {t('detail.online')}
          </>
        ) : r.createdByName ? (
          t('detail.createdBy', { name: r.createdByName })
        ) : null}
      </p>

      <div className="mt-auto flex flex-col gap-2">
        {upcoming && can('table.open') ? (
          r.tableId ? (
            <Button size="lg" loading={seat.isPending} onClick={() => seat.mutate()}>
              <UserCheck />
              {t('actions.seat')}
            </Button>
          ) : (
            <p className="text-sm text-foreground-muted">{t('detail.seatNeedsTable')}</p>
          )
        ) : null}
        {r.status === 'seated' && r.tableSessionId && can('order.create') ? (
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate(`/floor/sessions/${r.tableSessionId}`)}
          >
            {t('detail.openOrder')}
          </Button>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {action('confirmed', t('actions.confirm'), <CalendarCheck />)}
          {upcoming && manage ? (
            <Button variant="outline" onClick={() => onEdit(r)}>
              <Pencil />
              {t('detail.edit')}
            </Button>
          ) : null}
          {action('completed', t('actions.complete'), <CircleCheck />)}
          {action('no_show', t('actions.no_show'), <UserX />)}
          {r.status === 'no_show' || r.status === 'cancelled'
            ? action('booked', t('actions.rebook'), <RotateCcw />)
            : null}
          {action('cancelled', t('actions.cancel'), <Ban />, 'ghost')}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('actions.cancelConfirm', { name: r.name })}
        confirmLabel={t('actions.cancel')}
        loading={status.isPending}
        onConfirm={() => status.mutate('cancelled')}
      />
    </>
  );
}
