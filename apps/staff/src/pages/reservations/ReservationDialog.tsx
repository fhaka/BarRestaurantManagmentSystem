import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import {
  TIMEZONE,
  localParts,
  localTime,
  reservationCreateSchema,
  timeToMinutes,
  zonedDateTime,
  type Reservation,
} from '@tavolina/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useFloorQuery, useNow } from '../floor/floor-utils';
import { todayLocal, useAvailability } from './reservation-utils';

const DURATIONS = [60, 90, 120, 150, 180, 240];

export function ReservationDialog({
  reservation,
  date,
  onClose,
  onSaved,
}: {
  reservation: Reservation | 'new' | null;
  date: string;
  onClose: () => void;
  onSaved: (r: { date: string }) => void;
}) {
  return (
    <Dialog open={reservation !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {reservation ? (
          <ReservationForm
            key={reservation === 'new' ? `new-${date}` : reservation.id}
            reservation={reservation === 'new' ? null : reservation}
            initialDate={date}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReservationForm({
  reservation,
  initialDate,
  onClose,
  onSaved,
}: {
  reservation: Reservation | null;
  initialDate: string;
  onClose: () => void;
  onSaved: (r: { date: string }) => void;
}) {
  const { t } = useTranslation('reservations');
  const { t: tc } = useTranslation();
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const floor = useFloorQuery();
  const [uuid] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState(() => ({
    date: reservation ? localParts(new Date(reservation.startsAt), TIMEZONE).date : initialDate,
    time: reservation ? localTime(new Date(reservation.startsAt), TIMEZONE) : '',
    durationMin: reservation?.durationMin ?? 90,
    partySize: reservation?.partySize ?? 2,
    name: reservation?.name ?? '',
    phone: reservation?.phone ?? '',
    notes: reservation?.notes ?? '',
    tableId: reservation?.tableId ?? (null as number | null),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const slots = useAvailability(form.date, form.partySize, form.durationMin, reservation?.id);

  // Until a time is chosen: the next free slot today, otherwise 19:00 or the first slot.
  const now = useNow();
  const suggested =
    slots.data?.find(
      (s) => s.available && (form.date !== todayLocal() || Date.parse(s.startsAt) > now),
    )?.time ?? '';
  const time =
    form.time || (slots.data?.some((s) => s.time === '19:00' && s.available) ? '19:00' : suggested);
  const slot = slots.data?.find((s) => s.time === time);
  const free = new Set(slot?.freeTableIds ?? []);
  const tables = (floor.data?.tables ?? [])
    .filter((x) => x.active && (free.has(x.id) || x.id === form.tableId))
    .sort((a, b) => {
      const fitA = a.seats >= form.partySize ? 0 : 1;
      const fitB = b.seats >= form.partySize ? 0 : 1;
      return (
        fitA - fitB ||
        a.seats - b.seats ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
    });
  const tableBusy = form.tableId !== null && slot !== undefined && !free.has(form.tableId);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      reservation
        ? api<Reservation>('PATCH', `/reservations/${reservation.id}`, { body })
        : api<Reservation>('POST', '/reservations', { body: { uuid, ...body } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['floor'] });
      toast.success(reservation ? t('form.saved') : t('form.created'));
      onSaved({ date: form.date });
      onClose();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const submit = () => {
    if (!/^\d{2}:\d{2}$/.test(time)) return setErrors({ time: t('form.time') });
    const body = {
      startsAt: zonedDateTime(form.date, timeToMinutes(time), TIMEZONE).toISOString(),
      durationMin: form.durationMin,
      partySize: form.partySize,
      name: form.name,
      phone: form.phone,
      notes: form.notes || null,
      tableId: form.tableId,
    };
    const result = validate(reservationCreateSchema, { uuid, ...body });
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };

  const timeOptions = (slots.data ?? []).map((s) => ({
    value: s.time,
    label: s.available || s.time === time ? s.time : `${s.time} · ${t('form.full')}`,
  }));
  if (time && !timeOptions.some((o) => o.value === time))
    timeOptions.unshift({ value: time, label: time });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{reservation ? t('form.titleEdit') : t('form.titleNew')}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={t('form.date')} error={errors.startsAt}>
            <Input
              type="date"
              value={form.date}
              onChange={(e) =>
                e.target.value && setForm({ ...form, date: e.target.value, time: '' })
              }
            />
          </Field>
          <Field label={t('form.time')} error={errors.time}>
            {slots.data && !slots.data.length ? (
              <p className="flex h-11 items-center text-sm text-foreground-muted">
                {t('form.closed')}
              </p>
            ) : (
              <Select
                value={time || undefined}
                placeholder="--:--"
                onValueChange={(v) => setForm({ ...form, time: v })}
                options={timeOptions}
              />
            )}
          </Field>
          <Field label={t('form.partySize')} error={errors.partySize}>
            <div className="flex h-11 items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="−"
                disabled={form.partySize <= 1}
                onClick={() => setForm({ ...form, partySize: form.partySize - 1 })}
              >
                <Minus />
              </Button>
              <span className="w-8 text-center font-mono text-lg font-bold tabular-nums">
                {form.partySize}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="+"
                onClick={() => setForm({ ...form, partySize: Math.min(99, form.partySize + 1) })}
              >
                <Plus />
              </Button>
            </div>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.duration')}>
            <Select
              value={String(form.durationMin)}
              onValueChange={(v) => setForm({ ...form, durationMin: Number(v) })}
              options={[...new Set([...DURATIONS, form.durationMin])]
                .sort((a, b) => a - b)
                .map((d) => ({ value: String(d), label: t('form.minutes', { count: d }) }))}
            />
          </Field>
          <Field
            label={t('form.table')}
            hint={slot ? t('form.freeTables', { count: slot.freeTableIds.length }) : undefined}
            error={errors.tableId ?? (tableBusy ? t('form.full') : undefined)}
          >
            <Select
              value={form.tableId ? String(form.tableId) : 'none'}
              onValueChange={(v) => setForm({ ...form, tableId: v === 'none' ? null : Number(v) })}
              options={[
                { value: 'none', label: t('form.noTable') },
                ...tables.map((x) => ({
                  value: String(x.id),
                  label: t(x.seats >= form.partySize ? 'form.tableOption' : 'form.tooSmall', {
                    name: x.name,
                    seats: x.seats,
                  }),
                })),
              ]}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.name')} error={errors.name}>
            <Input
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.phone')} error={errors.phone}>
            <Input
              type="tel"
              value={form.phone}
              maxLength={30}
              placeholder="+355 69 …"
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('form.notes')} error={errors.notes}>
          <Textarea
            rows={2}
            maxLength={500}
            value={form.notes}
            placeholder={t('form.notesPlaceholder')}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {t('form.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
