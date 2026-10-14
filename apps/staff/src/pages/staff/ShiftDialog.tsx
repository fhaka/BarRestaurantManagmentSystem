import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import {
  TIMEZONE,
  localParts,
  localTime,
  shiftInputSchema,
  type Shift,
  type StaffMember,
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
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { toRange } from './time-utils';

export type ShiftDraft = { shift: Shift } | { date: string; userId?: number };

export function ShiftDialog({
  draft,
  people,
  onClose,
}: {
  draft: ShiftDraft | null;
  people: StaffMember[];
  onClose: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {draft ? (
          <ShiftForm
            key={'shift' in draft ? draft.shift.id : `${draft.date}-${draft.userId}`}
            draft={draft}
            people={people}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// The last times used, so adding a week of the same shift is quick.
let lastTimes = { from: '08:00', to: '16:00' };

function ShiftForm({
  draft,
  people,
  onClose,
}: {
  draft: ShiftDraft;
  people: StaffMember[];
  onClose: () => void;
}) {
  const { t } = useTranslation('staff');
  const { t: tc } = useTranslation();
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const shift = 'shift' in draft ? draft.shift : null;
  const [form, setForm] = useState(() => ({
    userId: shift?.userId ?? ('userId' in draft ? (draft.userId ?? null) : null),
    date: shift
      ? localParts(new Date(shift.startsAt), TIMEZONE).date
      : (draft as { date: string }).date,
    from: shift ? localTime(new Date(shift.startsAt), TIMEZONE) : lastTimes.from,
    to: shift ? localTime(new Date(shift.endsAt), TIMEZONE) : lastTimes.to,
    note: shift?.note ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['time'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (body: unknown) =>
      shift ? api('PATCH', `/shifts/${shift.id}`, { body }) : api('POST', '/shifts', { body }),
    onSuccess: () => {
      lastTimes = { from: form.from, to: form.to };
      toast.success(t('schedule.saved'));
      done();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/shifts/${shift!.id}`),
    onSuccess: done,
    onError: (err) => toast.error(message(err)),
  });
  const submit = () => {
    if (!/^\d{2}:\d{2}$/.test(form.from) || !/^\d{2}:\d{2}$/.test(form.to)) {
      return setErrors({ endsAt: t('schedule.times') });
    }
    const body = {
      userId: form.userId ?? 0,
      ...toRange(form.date, form.from, form.to),
      note: form.note || null,
    };
    const result = validate(shiftInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{shift ? t('schedule.edit') : t('schedule.add')}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label={t('schedule.person')} error={errors.userId}>
          <Select
            value={form.userId ? String(form.userId) : undefined}
            placeholder={t('schedule.person')}
            onValueChange={(v) => setForm({ ...form, userId: Number(v) })}
            options={people.map((p) => ({ value: String(p.id), label: p.name }))}
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto_auto] gap-3">
          <Field label={t('schedule.date')} error={errors.startsAt}>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => e.target.value && setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label={t('schedule.from')}>
            <Input
              type="time"
              className="w-28"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </Field>
          <Field label={t('schedule.to')}>
            <Input
              type="time"
              className="w-28"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </Field>
        </div>
        {errors.endsAt ? <p className="-mt-2 text-sm text-danger">{errors.endsAt}</p> : null}
        <Field label={t('schedule.note')} error={errors.note}>
          <Input
            value={form.note}
            maxLength={300}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>
      </div>
      <DialogFooter>
        {shift ? (
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 />
            {t('schedule.delete')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {tc('actions.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
