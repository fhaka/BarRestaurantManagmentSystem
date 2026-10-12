import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BellRing,
  LayoutGrid,
  List,
  PencilRuler,
  Receipt,
  Smartphone,
  Users,
  WifiOff,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { TABLE_STATUSES, formatMoney, type FloorTable } from '@tavolina/shared';
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { useErrorMessages } from '../../lib/errors';
import { useRealtimeStatus } from '../../lib/realtime';
import { useSession } from '../../lib/session';
import { FloorCanvas, TableShapeView } from './FloorCanvas';
import { STATUS_STYLE, useElapsed, useFloorQuery, useNow, usedExtent } from './floor-utils';
import { TableSheet } from './TableSheet';

type View = 'plan' | 'list';
const VIEW_KEY = 'tavolina.floorView';

function initialView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'plan' || saved === 'list') return saved;
  } catch {
    // ignore
  }
  // Phones get the list: the plan is too small to tap comfortably.
  return window.innerWidth < 640 ? 'list' : 'plan';
}

export function FloorPage() {
  const { t } = useTranslation('floor');
  const { t: tc } = useTranslation();
  const { message } = useErrorMessages();
  const floor = useFloorQuery();
  const locationName = useSession((s) => s.locationName);
  const canEdit = useSession((s) => s.permissions.has('floor.edit'));
  const realtime = useRealtimeStatus((s) => s.status);
  const [view, setView] = useState<View>(initialView);
  const [area, setArea] = useState<string>('');
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ignore
    }
  }, [view]);

  const data = floor.data;
  const areas = data?.areas.filter((a) => a.active) ?? [];
  const currentArea = area || String(areas[0]?.id ?? '');
  const active = data?.tables.filter((x) => x.active) ?? [];
  const occupied = active.filter((x) => x.session);
  const guests = new Set(occupied.map((x) => x.session!.id));
  const guestCount = occupied
    .filter((x) => x.session!.primaryTableId === x.id)
    .reduce((sum, x) => sum + x.session!.guestCount, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { location: locationName ?? '' })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {realtime === 'offline' ? (
              <Badge tone="warning" icon={<WifiOff />} role="status">
                {t('offline')}
              </Badge>
            ) : realtime === 'online' ? (
              <Badge tone="success" role="status">
                <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
                {t('live')}
              </Badge>
            ) : null}
            <div
              role="radiogroup"
              aria-label={t('view.label')}
              className="flex rounded-control border border-border-strong p-0.5"
            >
              {(['plan', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-[7px] px-3 text-sm font-semibold transition-colors',
                    view === v
                      ? 'bg-primary-soft text-primary-soft-fg'
                      : 'text-foreground-muted hover:text-foreground',
                  )}
                >
                  {v === 'plan' ? (
                    <LayoutGrid className="size-4" aria-hidden />
                  ) : (
                    <List className="size-4" aria-hidden />
                  )}
                  {t(`view.${v}`)}
                </button>
              ))}
            </div>
            {canEdit ? (
              <Button asChild variant="outline">
                <Link to="/floor/edit">
                  <PencilRuler />
                  {t('edit')}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {floor.isPending ? (
        <Skeleton className="h-[60dvh] w-full rounded-card" />
      ) : floor.isError ? (
        <EmptyState
          title={message(floor.error)}
          action={
            <Button variant="outline" onClick={() => void floor.refetch()}>
              {tc('actions.retry')}
            </Button>
          }
        />
      ) : areas.length === 0 || active.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            canEdit ? (
              <Button asChild>
                <Link to="/floor/edit">{t('emptyAction')}</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <p className="text-sm text-foreground-muted">
            {t('summary', {
              free: active.length - occupied.length,
              occupied: guests.size,
              guests: guestCount,
            })}
          </p>
          <Tabs value={currentArea} onValueChange={setArea}>
            <TabsList>
              {areas.map((a) => (
                <TabsTrigger key={a.id} value={String(a.id)}>
                  {a.name}
                  <span className="rounded-full bg-surface-sunken px-1.5 text-xs tabular-nums text-foreground-muted">
                    {active.filter((x) => x.areaId === a.id && x.session).length}/
                    {active.filter((x) => x.areaId === a.id).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            {areas.map((a) => {
              const tables = active.filter((x) => x.areaId === a.id);
              return (
                <TabsContent key={a.id} value={String(a.id)} className="pt-4">
                  {tables.length === 0 ? (
                    <p className="text-sm text-foreground-muted">{t('noAreaTables')}</p>
                  ) : view === 'plan' ? (
                    <PlanView tables={tables} onSelect={setSelected} />
                  ) : (
                    <ListView tables={tables} onSelect={setSelected} />
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
          <Legend />
        </>
      )}

      {data ? (
        <TableSheet floor={data} tableId={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function Legend() {
  const { t } = useTranslation('floor');
  return (
    <ul className="flex flex-wrap gap-2">
      {TABLE_STATUSES.map((s) => {
        const style = STATUS_STYLE[s];
        return (
          <li key={s}>
            <Badge tone={style.tone} icon={<style.icon />}>
              {t(`status.${s}`)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/** Guests waiting for something: a call, the bill, or a QR order to confirm. */
function attentionLabel(table: FloorTable, t: TFunction<'floor'>): string {
  const parts = [
    ...table.requests.map((r) => t(`requests.${r.type}`)),
    table.session?.pendingGuestItems
      ? t('guestOrder.pending', { count: table.session.pendingGuestItems })
      : null,
  ].filter(Boolean);
  return parts.length ? `, ${parts.join(', ')}` : '';
}

function Attention({ table, className }: { table: FloorTable; className?: string }) {
  const pending = table.session?.pendingGuestItems ?? 0;
  if (!table.requests.length && !pending) return null;
  const bill = table.requests.some((r) => r.type !== 'call_waiter');
  const call = table.requests.some((r) => r.type === 'call_waiter');
  return (
    <span
      className={cn(
        'z-10 flex items-center gap-0.5 rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-bold text-danger-fg shadow-raised motion-safe:animate-pulse',
        className,
      )}
      aria-hidden
    >
      {call ? <BellRing className="size-3.5" /> : null}
      {bill ? <Receipt className="size-3.5" /> : null}
      {pending ? (
        <>
          <Smartphone className="size-3.5" />
          {pending}
        </>
      ) : null}
    </span>
  );
}

function TableLabel({ table, compact, now }: { table: FloorTable; compact: boolean; now: number }) {
  const { t } = useTranslation('floor');
  const elapsed = useElapsed();
  const style = STATUS_STYLE[table.status];
  const s = table.session;
  return (
    <span className="relative flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-center leading-tight">
      <span className="font-extrabold">{table.name}</span>
      {compact ? (
        <style.icon className="size-3.5" aria-hidden />
      ) : (
        <>
          <span className="flex items-center gap-1 text-[11px] font-semibold">
            <style.icon className="size-3.5 shrink-0" aria-hidden />
            {s ? elapsed(s.openedAt, now) : t(`status.${table.status}`)}
          </span>
          {s ? (
            <span className="flex items-center gap-1 text-[11px] opacity-80">
              <Users className="size-3" aria-hidden />
              {s.guestCount} · {s.waiterName?.split(' ')[0] ?? t('table.noWaiter')}
            </span>
          ) : null}
        </>
      )}
    </span>
  );
}

function PlanView({ tables, onSelect }: { tables: FloorTable[]; onSelect: (id: number) => void }) {
  const { t } = useTranslation('floor');
  const now = useNow();
  const { cols, rows } = usedExtent(tables);
  return (
    <FloorCanvas cols={cols} rows={rows}>
      {(cell) =>
        tables.map((table) => {
          const style = STATUS_STYLE[table.status];
          const compact = Math.min(table.w, table.h) * cell < 72;
          return (
            <button
              key={table.id}
              type="button"
              onClick={() => onSelect(table.id)}
              aria-label={`${t('table.title', { name: table.name })}: ${t(`status.${table.status}`)}${
                table.session
                  ? `, ${t('guests', { count: table.session.guestCount })}, ${table.session.waiterName ?? t('table.noWaiter')}`
                  : ''
              }${attentionLabel(table, t)}`}
              className={cn(
                'absolute transition-transform hover:z-10 hover:scale-[1.03] focus-visible:z-10',
                style.tile
                  .split(' ')
                  .filter((c) => c.startsWith('text-'))
                  .join(' '),
                table.session && !table.session.mine && 'opacity-70',
              )}
              style={{
                left: table.x * cell,
                top: table.y * cell,
                width: table.w * cell,
                height: table.h * cell,
              }}
            >
              <TableShapeView
                shape={table.shape}
                rotation={table.rotation}
                className={cn(style.tile, 'shadow-raised')}
              />
              <TableLabel table={table} compact={compact} now={now} />
              <Attention table={table} className="absolute -left-2 -top-2" />
              {table.session && table.session.tableIds.length > 1 ? (
                <span
                  className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-surface bg-info"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })
      }
    </FloorCanvas>
  );
}

function ListView({ tables, onSelect }: { tables: FloorTable[]; onSelect: (id: number) => void }) {
  const { t } = useTranslation('floor');
  const now = useNow();
  const elapsed = useElapsed();
  const sorted = [...tables].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {sorted.map((table) => {
        const style = STATUS_STYLE[table.status];
        const s = table.session;
        return (
          <li key={table.id}>
            <button
              type="button"
              onClick={() => onSelect(table.id)}
              className={cn(
                'flex h-full min-h-28 w-full flex-col gap-1.5 rounded-card border-2 p-3 text-left transition-transform active:scale-[0.98]',
                style.tile,
                s && !s.mine && 'opacity-70',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-xl font-extrabold">{table.name}</span>
                <span className="flex items-center gap-1.5">
                  <Attention table={table} />
                  <style.icon className="size-5" aria-hidden />
                </span>
              </span>
              <span className="text-xs font-semibold">{t(`status.${table.status}`)}</span>
              {s ? (
                <span className="mt-auto flex flex-col text-xs">
                  <span className="font-mono tabular-nums">
                    {elapsed(s.openedAt, now)} · {t('guests', { count: s.guestCount })}
                  </span>
                  <span className="truncate opacity-80">{s.waiterName ?? t('table.noWaiter')}</span>
                  {s.totalMinor > 0 ? (
                    <span className="font-mono font-semibold">{formatMoney(s.totalMinor)}</span>
                  ) : null}
                </span>
              ) : (
                <span className="mt-auto text-xs opacity-80">
                  {t('seats', { count: table.seats })}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
