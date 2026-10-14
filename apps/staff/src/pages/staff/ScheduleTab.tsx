import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  TIMEZONE,
  addDays,
  formatDuration,
  localParts,
  minutesBetween,
  weekStart,
  type Shift,
  type StaffMember,
} from '@tavolina/shared';
import { Button, Skeleton, cn } from '@tavolina/ui';
import { api } from '../../lib/api';
import { formatDay, formatTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { ShiftDialog, type ShiftDraft } from './ShiftDialog';

const today = () => localParts(new Date(), TIMEZONE).date;

/** The weekly schedule (plan §5.8): one row per person, one column per day. */
export function ScheduleTab() {
  const { t } = useTranslation('staff');
  const { t: ta } = useTranslation('app');
  const locationId = useSession((s) => s.locationId);
  const [monday, setMonday] = useState(() => weekStart(today()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [draft, setDraft] = useState<ShiftDraft | null>(null);

  const staff = useQuery({
    queryKey: ['staff', locationId],
    queryFn: () => api<StaffMember[]>('GET', '/staff'),
  });
  const shifts = useQuery({
    queryKey: ['time', 'shifts', locationId, monday],
    queryFn: () => api<Shift[]>('GET', `/shifts?from=${monday}&to=${addDays(monday, 6)}`),
  });
  const people = (staff.data ?? []).filter(
    (m) => m.active || shifts.data?.some((s) => s.userId === m.id),
  );
  const dayOf = (s: Shift) => localParts(new Date(s.startsAt), TIMEZONE).date;
  const now = today();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t('schedule.prevWeek')}
          onClick={() => setMonday(addDays(monday, -7))}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => setMonday(weekStart(today()))}>
          {t('schedule.thisWeek')}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('schedule.nextWeek')}
          onClick={() => setMonday(addDays(monday, 7))}
        >
          <ChevronRight />
        </Button>
        <span className="text-lg font-bold">
          {formatDay(monday)} – {formatDay(addDays(monday, 6))}
        </span>
        <Button
          className="ml-auto"
          onClick={() => setDraft({ date: days.includes(now) ? now : monday })}
        >
          <Plus />
          {t('schedule.add')}
        </Button>
      </div>

      {staff.isLoading || shifts.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunken">
                <th
                  scope="col"
                  className="sticky left-0 z-[1] w-48 bg-surface-sunken px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
                >
                  {t('schedule.person')}
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className={cn(
                      'px-2 py-2 text-left text-xs font-semibold capitalize',
                      d === now ? 'text-primary' : 'text-foreground-muted',
                    )}
                  >
                    {formatDay(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const mine = (shifts.data ?? []).filter((s) => s.userId === p.id);
                const total = mine.reduce(
                  (sum, s) => sum + minutesBetween(new Date(s.startsAt), new Date(s.endsAt)),
                  0,
                );
                return (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] bg-surface px-3 py-2 text-left align-top font-normal"
                    >
                      <span className="block font-semibold">{p.name}</span>
                      <span className="text-xs text-foreground-muted">
                        {ta(`roles.${p.roleKey}`)} ·{' '}
                        {t('schedule.total', { hours: formatDuration(total) })}
                      </span>
                    </th>
                    {days.map((d) => (
                      <td
                        key={d}
                        className={cn(
                          'group px-1.5 py-1.5 align-top',
                          d === now && 'bg-primary-soft/30',
                        )}
                      >
                        <div className="flex min-h-12 flex-col gap-1">
                          {mine
                            .filter((s) => dayOf(s) === d)
                            .map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setDraft({ shift: s })}
                                title={s.note ?? undefined}
                                className="rounded-control border-l-4 border-primary bg-primary-soft px-2 py-1 text-left font-mono text-xs font-semibold tabular-nums text-primary-soft-fg hover:brightness-95"
                              >
                                {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
                              </button>
                            ))}
                          <button
                            type="button"
                            aria-label={t('schedule.addFor', { name: p.name, day: formatDay(d) })}
                            onClick={() => setDraft({ date: d, userId: p.id })}
                            className="flex h-7 items-center justify-center rounded-control border border-dashed border-border text-foreground-subtle opacity-0 transition-opacity hover:border-primary hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <Plus className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ShiftDialog draft={draft} people={people} onClose={() => setDraft(null)} />
    </div>
  );
}
