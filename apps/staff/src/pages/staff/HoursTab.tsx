import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Plus, Trash2 } from 'lucide-react';
import {
  TIMEZONE,
  addDays,
  formatDuration,
  localParts,
  localTime,
  timeEntryInputSchema,
  weekStart,
  type HoursRow,
  type StaffMember,
  type TimeEntry,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatDay, formatTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { ChipToggle } from '../menu/fields';
import { toRange } from './time-utils';

const today = () => localParts(new Date(), TIMEZONE).date;
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => addDays(monthStart(addDays(monthStart(d), 32)), -1);

function presets() {
  const now = today();
  const monday = weekStart(now);
  const lastMonth = addDays(monthStart(now), -1);
  return {
    thisWeek: { from: monday, to: addDays(monday, 6) },
    lastWeek: { from: addDays(monday, -7), to: addDays(monday, -1) },
    thisMonth: { from: monthStart(now), to: monthEnd(now) },
    lastMonth: { from: monthStart(lastMonth), to: lastMonth },
  };
}
type Preset = keyof ReturnType<typeof presets>;
/** Diff in minutes shown as "+0:15" / "−1:30". */
const signed = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${formatDuration(Math.abs(m))}`;

/** Worked hours per person against the schedule, and the payroll export (plan §5.8). */
export function HoursTab() {
  const { t } = useTranslation('staff');
  const { t: ta } = useTranslation('app');
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const locationName = useSession((s) => s.locationName);
  const [range, setRange] = useState(presets().thisWeek);
  const [preset, setPreset] = useState<Preset | null>('thisWeek');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<TimeEntry | 'new' | null>(null);
  const [exporting, setExporting] = useState(false);
  const q = `from=${range.from}&to=${range.to}`;

  const hours = useQuery({
    queryKey: ['time', 'hours', locationId, range],
    queryFn: () => api<HoursRow[]>('GET', `/time-entries/hours?${q}`),
    enabled: range.from <= range.to,
  });
  const entries = useQuery({
    queryKey: ['time', 'entries', locationId, range],
    queryFn: () => api<TimeEntry[]>('GET', `/time-entries?${q}`),
    enabled: range.from <= range.to,
  });
  const staff = useQuery({
    queryKey: ['staff', locationId],
    queryFn: () => api<StaffMember[]>('GET', '/staff'),
  });

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await api<string>('GET', `/time-entries/hours.csv?${q}`, {
        responseType: 'text',
      });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ore-${(locationName ?? 'tavolina').replace(/\W+/g, '-').toLowerCase()}-${range.from}-${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setExporting(false);
    }
  }

  const rows = (hours.data ?? []).filter((r) => r.entries > 0 || r.scheduledMinutes > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        {(Object.keys(presets()) as Preset[]).map((p) => (
          <ChipToggle
            key={p}
            pressed={preset === p}
            onToggle={() => {
              setPreset(p);
              setRange(presets()[p]);
            }}
          >
            {t(`hours.presets.${p}`)}
          </ChipToggle>
        ))}
        <Field label={t('hours.from')} className="w-40">
          <Input
            type="date"
            value={range.from}
            onChange={(e) => {
              setPreset(null);
              if (e.target.value) setRange({ ...range, from: e.target.value });
            }}
          />
        </Field>
        <Field label={t('hours.to')} className="w-40">
          <Input
            type="date"
            value={range.to}
            onChange={(e) => {
              setPreset(null);
              if (e.target.value) setRange({ ...range, to: e.target.value });
            }}
          />
        </Field>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus />
            {t('hours.addEntry')}
          </Button>
          <Button loading={exporting} onClick={exportCsv}>
            <Download />
            {t('hours.export')}
          </Button>
        </div>
      </div>

      {hours.isLoading ? (
        <Skeleton className="h-72" />
      ) : !rows.length ? (
        <EmptyState title={t('hours.empty')} description={t('hours.emptyDescription')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('schedule.person')}</TableHead>
              <TableHead numeric>{t('hours.worked')}</TableHead>
              <TableHead numeric>{t('hours.scheduled')}</TableHead>
              <TableHead numeric>{t('hours.difference')}</TableHead>
              <TableHead numeric className="hidden sm:table-cell">
                {t('hours.entries')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const open = expanded === r.userId;
              const mine = (entries.data ?? []).filter((e) => e.userId === r.userId);
              const diff = r.workedMinutes - r.scheduledMinutes;
              return (
                <Fragment key={r.userId}>
                  <TableRow>
                    <TableCell>
                      <button
                        type="button"
                        aria-expanded={open}
                        className="flex items-center gap-2 text-left"
                        onClick={() => setExpanded(open ? null : r.userId)}
                      >
                        {open ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                        <span>
                          <span className="block font-semibold">{r.name}</span>
                          <span className="text-xs text-foreground-muted">
                            {r.roleKey ? ta(`roles.${r.roleKey}`) : ''}
                          </span>
                        </span>
                        {r.openEntries ? (
                          <Badge tone="warning" size="sm" icon={<AlertTriangle />}>
                            {t('hours.open', { count: r.openEntries })}
                          </Badge>
                        ) : null}
                      </button>
                    </TableCell>
                    <TableCell numeric className="font-bold">
                      {formatDuration(r.workedMinutes)}
                    </TableCell>
                    <TableCell numeric className="text-foreground-muted">
                      {formatDuration(r.scheduledMinutes)}
                    </TableCell>
                    <TableCell
                      numeric
                      className={
                        diff < -15 ? 'text-danger' : diff > 15 ? 'text-warning' : undefined
                      }
                    >
                      {signed(diff)}
                    </TableCell>
                    <TableCell numeric className="hidden sm:table-cell">
                      {r.entries}
                    </TableCell>
                  </TableRow>
                  {open
                    ? mine.map((e) => (
                        <TableRow key={e.id} className="bg-surface-sunken/50">
                          <TableCell className="pl-12 capitalize">
                            {formatDay(localParts(new Date(e.clockIn), TIMEZONE).date)}
                            {e.note ? (
                              <span className="block text-xs normal-case text-foreground-muted">
                                {e.note}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell numeric>
                            {formatTime(e.clockIn)}–{e.clockOut ? formatTime(e.clockOut) : '…'}
                          </TableCell>
                          <TableCell numeric>{formatDuration(e.minutes)}</TableCell>
                          <TableCell numeric>
                            <span className="text-xs text-foreground-muted">
                              {e.editedByName
                                ? t('hours.editedBy', { name: e.editedByName })
                                : t(`hours.source.${e.source}`)}
                            </span>
                          </TableCell>
                          <TableCell numeric className="hidden sm:table-cell">
                            <Button size="sm" variant="outline" onClick={() => setEditing(e)}>
                              {t('hours.fix')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
      <EntryDialog entry={editing} people={staff.data ?? []} onClose={() => setEditing(null)} />
    </div>
  );
}

function EntryDialog({
  entry,
  people,
  onClose,
}: {
  entry: TimeEntry | 'new' | null;
  people: StaffMember[];
  onClose: () => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {entry ? (
          <EntryForm
            key={entry === 'new' ? 'new' : entry.id}
            entry={entry === 'new' ? null : entry}
            people={people}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  entry,
  people,
  onClose,
}: {
  entry: TimeEntry | null;
  people: StaffMember[];
  onClose: () => void;
}) {
  const { t } = useTranslation('staff');
  const { t: tc } = useTranslation();
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    userId: entry?.userId ?? (null as number | null),
    date: localParts(entry ? new Date(entry.clockIn) : new Date(), TIMEZONE).date,
    from: entry ? localTime(new Date(entry.clockIn), TIMEZONE) : '',
    to: entry?.clockOut ? localTime(new Date(entry.clockOut), TIMEZONE) : '',
    note: entry?.note ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['time'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (body: unknown) =>
      entry
        ? api('PATCH', `/time-entries/${entry.id}`, { body })
        : api('POST', '/time-entries', { body }),
    onSuccess: () => {
      toast.success(t('hours.saved'));
      done();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/time-entries/${entry!.id}`),
    onSuccess: done,
    onError: (err) => toast.error(message(err)),
  });
  const submit = () => {
    if (!/^\d{2}:\d{2}$/.test(form.from)) return setErrors({ clockIn: t('schedule.times') });
    const range = form.to ? toRange(form.date, form.from, form.to) : null;
    const body = {
      userId: form.userId ?? 0,
      clockIn: range?.startsAt ?? toRange(form.date, form.from, form.from).startsAt,
      clockOut: range?.endsAt ?? null,
      note: form.note || null,
    };
    const result = validate(timeEntryInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {entry ? t('hours.fixTitle', { name: entry.userName }) : t('hours.addEntry')}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        {entry ? null : (
          <Field label={t('schedule.person')} error={errors.userId}>
            <Select
              value={form.userId ? String(form.userId) : undefined}
              placeholder={t('schedule.person')}
              onValueChange={(v) => setForm({ ...form, userId: Number(v) })}
              options={people.map((p) => ({ value: String(p.id), label: p.name }))}
            />
          </Field>
        )}
        <div className="grid grid-cols-[1fr_auto_auto] gap-3">
          <Field label={t('schedule.date')}>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => e.target.value && setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label={t('hours.clockIn')}>
            <Input
              type="time"
              className="w-28"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </Field>
          <Field label={t('hours.clockOut')}>
            <Input
              type="time"
              className="w-28"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </Field>
        </div>
        {errors.clockIn || errors.clockOut ? (
          <p className="-mt-2 text-sm text-danger">{errors.clockIn ?? errors.clockOut}</p>
        ) : null}
        <Field label={t('schedule.note')} hint={t('hours.noteHint')} error={errors.note}>
          <Input
            value={form.note}
            maxLength={300}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>
      </div>
      <DialogFooter>
        {entry ? (
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
