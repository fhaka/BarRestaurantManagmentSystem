import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, LayoutList, Plus, Rows3 } from 'lucide-react';
import { addDays, type Reservation } from '@tavolina/shared';
import { Button, EmptyState, Input, Skeleton, Tabs, TabsList, TabsTrigger } from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { formatDay } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useFloorQuery } from '../floor/floor-utils';
import { ReservationDialog } from './ReservationDialog';
import { ReservationList } from './ReservationList';
import { ReservationSheet } from './ReservationSheet';
import { todayLocal, useAvailability, useReservations } from './reservation-utils';
import { Timeline } from './Timeline';

/** The reservation book (plan §5.10): one day, by table or as a list. */
export function ReservationsPage() {
  const { t } = useTranslation('reservations');
  const locationName = useSession((s) => s.locationName);
  const can = useSession((s) => s.can);
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayLocal();
  const view = params.get('view') === 'list' ? 'list' : 'timeline';
  const set = (patch: Record<string, string>) =>
    setParams({ date, view, ...patch }, { replace: true });

  const reservations = useReservations(date);
  const floor = useFloorQuery();
  // Opening hours of the day (for the timeline's width) come from the booking slots.
  const slots = useAvailability(date, 1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Reservation | 'new' | null>(null);

  const list = reservations.data ?? [];
  const active = list.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');
  const covers = active.reduce((s, r) => s + r.partySize, 0);
  const open = list.find((r) => r.id === openId) ?? null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { location: locationName ?? '' })}
        actions={
          can('reservation.manage') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus />
              {t('new')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('prevDay')}
            onClick={() => set({ date: addDays(date, -1) })}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => set({ date: todayLocal() })}>
            {t('today')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('nextDay')}
            onClick={() => set({ date: addDays(date, 1) })}
          >
            <ChevronRight />
          </Button>
        </div>
        <Input
          type="date"
          aria-label={t('date')}
          className="w-44"
          value={date}
          onChange={(e) => e.target.value && set({ date: e.target.value })}
        />
        <span className="text-lg font-bold capitalize">{formatDay(date)}</span>
        <span className="text-sm text-foreground-muted">
          {t('summary', { count: active.length, covers })}
        </span>
        <Tabs value={view} onValueChange={(v) => set({ view: v })} className="ml-auto">
          <TabsList>
            <TabsTrigger value="timeline">
              <Rows3 aria-hidden />
              {t('views.timeline')}
            </TabsTrigger>
            <TabsTrigger value="list">
              <LayoutList aria-hidden />
              {t('views.list')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {reservations.isLoading || floor.isLoading ? (
        <Skeleton className="h-96" />
      ) : view === 'timeline' && floor.data ? (
        <Timeline
          date={date}
          floor={floor.data}
          reservations={list}
          slots={slots.data ?? []}
          onOpen={setOpenId}
        />
      ) : list.length ? (
        <ReservationList reservations={list} onOpen={setOpenId} />
      ) : (
        <EmptyState
          icon={<CalendarDays />}
          title={t('empty')}
          description={t('emptyDescription')}
        />
      )}

      <ReservationSheet
        reservation={open}
        onClose={() => setOpenId(null)}
        onEdit={(r) => {
          setOpenId(null);
          setEditing(r);
        }}
      />
      <ReservationDialog
        reservation={editing}
        date={date}
        onClose={() => setEditing(null)}
        onSaved={(r) => set({ date: r.date })}
      />
    </div>
  );
}
