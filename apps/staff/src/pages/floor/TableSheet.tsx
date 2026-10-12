import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BellRing,
  Check,
  Brush,
  ClipboardList,
  Combine,
  DoorClosed,
  Lock,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  Smartphone,
  Split,
  UserRoundCog,
} from 'lucide-react';
import { formatMoney, type FloorState, type FloorTable } from '@tavolina/shared';
import {
  Avatar,
  Badge,
  Button,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { STATUS_STYLE, useElapsed, useFloorMutation, useNow } from './floor-utils';

export function TableSheet({
  floor,
  tableId,
  onClose,
}: {
  floor: FloorState;
  tableId: number | null;
  onClose: () => void;
}) {
  const { t: tc } = useTranslation();
  const table = floor.tables.find((x) => x.id === tableId) ?? null;
  // Bottom sheet on phones, side sheet on larger screens.
  const side = typeof window !== 'undefined' && window.innerWidth < 640 ? 'bottom' : 'right';
  return (
    <Sheet open={table !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={side} closeLabel={tc('actions.close')}>
        {table ? (
          <TableActions key={table.id} floor={floor} table={table} onClose={onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type Picker = null | 'move' | 'merge';

function TableActions({
  floor,
  table,
  onClose,
}: {
  floor: FloorState;
  table: FloorTable;
  onClose: () => void;
}) {
  const { t } = useTranslation('floor');
  const can = useSession((s) => s.can);
  const now = useNow();
  const elapsed = useElapsed();
  const [guests, setGuests] = useState(table.session?.guestCount ?? Math.min(table.seats, 2));
  const [picker, setPicker] = useState<Picker>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const session = table.session;
  const style = STATUS_STYLE[table.status];
  const name = (id: number) => floor.tables.find((x) => x.id === id)?.name ?? '';

  const openTable = useFloorMutation(
    () =>
      api<FloorState>('POST', '/table-sessions', {
        body: { uuid: crypto.randomUUID(), tableId: table.id, guestCount: guests },
      }),
    { success: () => t('table.opened', { name: table.name }) },
  );
  const clean = useFloorMutation(() => api<FloorState>('POST', `/tables/${table.id}/clean`), {
    success: () => t('table.cleaned', { name: table.name }),
  });
  const setGuestCount = useFloorMutation((guestCount: number) =>
    api<FloorState>('PATCH', `/table-sessions/${session!.id}`, { body: { guestCount } }),
  );
  const action = useFloorMutation(
    ({ path, body }: { path: string; body?: unknown; message: string }) =>
      api<FloorState>('POST', `/table-sessions/${session!.id}/${path}`, { body }),
    { success: (vars) => vars.message, onSuccess: () => setPicker(null) },
  );
  const queryClient = useQueryClient();
  const handle = useMutation({
    mutationFn: (id: number) => api('POST', `/service-requests/${id}/handle`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['floor'] }),
  });
  const closeTable = useFloorMutation(
    () => api<FloorState>('POST', `/table-sessions/${session!.id}/close`),
    {
      success: () => t('table.closed', { name: table.name }),
      onSuccess: () => {
        setConfirmClose(false);
        onClose();
      },
    },
  );

  const freeTables = floor.tables.filter((x) => x.active && !x.session && x.id !== table.id);
  const mergeCandidates = floor.tables.filter(
    (x) =>
      x.active &&
      x.id !== table.id &&
      !session?.tableIds.includes(x.id) &&
      (!x.session || x.session.mine),
  );

  const stepper = (value: number, onChange: (v: number) => void) => (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="icon-lg"
        aria-label={t('table.fewer')}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span
        className="min-w-12 text-center font-mono text-3xl font-bold tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <Button
        variant="outline"
        size="icon-lg"
        aria-label={t('table.more')}
        disabled={value >= 99}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 pb-2">
      <SheetHeader className="mb-0">
        <SheetTitle className="text-2xl font-extrabold tracking-tight">
          {t('table.title', { name: table.name })}
        </SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
            <Badge tone={style.tone} icon={<style.icon />}>
              {t(`status.${table.status}`)}
            </Badge>
            <span>{t('seats', { count: table.seats })}</span>
            {session && session.tableIds.length > 1 ? (
              <span>
                ·{' '}
                {t('merged', {
                  tables: session.tableIds
                    .filter((id) => id !== table.id)
                    .map(name)
                    .join(', '),
                })}
              </span>
            ) : null}
          </div>
        </SheetDescription>
      </SheetHeader>

      {table.requests.length ? (
        <section className="flex flex-col gap-2 rounded-card border-2 border-danger bg-danger-soft p-3 text-danger-soft-fg">
          {table.requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-semibold">
                {r.type === 'call_waiter' ? (
                  <BellRing className="size-4" />
                ) : (
                  <Receipt className="size-4" />
                )}
                {t(`requests.${r.type}`)} · {elapsed(r.createdAt, now)}
              </span>
              <Button
                size="sm"
                variant="outline"
                loading={handle.isPending && handle.variables === r.id}
                onClick={() => handle.mutate(r.id)}
              >
                <Check />
                {t('requests.done')}
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      {session && session.pendingGuestItems > 0 ? (
        <section className="flex items-center justify-between gap-3 rounded-card border-2 border-warning bg-warning-soft p-3 text-warning-soft-fg">
          <span className="flex items-center gap-2 font-semibold">
            <Smartphone className="size-4" />
            {t('guestOrder.pending', { count: session.pendingGuestItems })}
          </span>
          {session.mine && can('order.create') ? (
            <Button size="sm" asChild>
              <Link to={`/floor/sessions/${session.id}`}>{t('guestOrder.review')}</Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      {!session ? (
        <div className="flex flex-col gap-5">
          {table.needsCleaning && can('table.open') ? (
            <Button
              variant="outline"
              size="lg"
              loading={clean.isPending}
              onClick={() => clean.mutate(undefined)}
            >
              <Brush />
              {t('table.markClean')}
            </Button>
          ) : null}
          {can('table.open') ? (
            <section className="flex flex-col items-center gap-4 rounded-card border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground-muted">
                {t('table.guestCount')}
              </h3>
              {stepper(guests, setGuests)}
              <Button
                size="xl"
                block
                loading={openTable.isPending}
                onClick={() => openTable.mutate(undefined)}
              >
                {t('table.open')}
              </Button>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-3 gap-3 rounded-card border border-border p-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-foreground-muted">{t('table.waiter')}</dt>
              <dd className="flex items-center gap-2 font-semibold">
                {session.waiterName ? (
                  <>
                    <Avatar name={session.waiterName} size="sm" />
                    <span className="truncate">{session.waiterName.split(' ')[0]}</span>
                  </>
                ) : (
                  <span className="truncate text-foreground-muted">{t('table.noWaiter')}</span>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-foreground-muted">{t('table.since')}</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {elapsed(session.openedAt, now)}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-foreground-muted">{t('table.total')}</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {formatMoney(session.totalMinor)}
              </dd>
            </div>
          </dl>

          {!session.mine ? (
            <p className="flex items-start gap-2 rounded-control bg-surface-sunken px-3 py-2.5 text-sm text-foreground-muted">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('table.notYours', { name: session.waiterName })}
            </p>
          ) : (
            <>
              <section className="flex items-center justify-between gap-4 rounded-card border border-border p-4">
                <h3 className="text-sm font-semibold">{t('table.guestCount')}</h3>
                {stepper(session.guestCount, (v) => setGuestCount.mutate(v))}
              </section>

              {can('order.create') ? (
                <Button size="xl" block asChild>
                  <Link to={`/floor/sessions/${session.id}`}>
                    <ClipboardList />
                    {t('table.takeOrder')}
                  </Link>
                </Button>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                {session.status === 'open' ? (
                  <Button
                    variant="highlight"
                    size="lg"
                    loading={action.isPending && action.variables?.path === 'request-bill'}
                    onClick={() =>
                      action.mutate({ path: 'request-bill', message: t('table.saved') })
                    }
                  >
                    <Receipt />
                    {t('table.requestBill')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => action.mutate({ path: 'reopen', message: t('table.saved') })}
                  >
                    <RotateCcw />
                    {t('table.reopen')}
                  </Button>
                )}
                {can('table.close') ? (
                  <Button variant="outline" size="lg" onClick={() => setConfirmClose(true)}>
                    <DoorClosed />
                    {t('table.close')}
                  </Button>
                ) : null}
              </div>

              {can('table.transfer') ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
                    {t('table.actions')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={picker === 'move' ? 'secondary' : 'outline'}
                      onClick={() => setPicker(picker === 'move' ? null : 'move')}
                    >
                      <ArrowRightLeft />
                      {t('table.move')}
                    </Button>
                    <Button
                      variant={picker === 'merge' ? 'secondary' : 'outline'}
                      onClick={() => setPicker(picker === 'merge' ? null : 'merge')}
                    >
                      <Combine />
                      {t('table.merge')}
                    </Button>
                    {session.tableIds.length > 1 ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          action.mutate({
                            path: 'split',
                            body: { tableId: table.id },
                            message: t('table.splitOk', { name: table.name }),
                          })
                        }
                      >
                        <Split />
                        {t('table.split')}
                      </Button>
                    ) : null}
                  </div>

                  {picker ? (
                    <div className="flex flex-col gap-2 rounded-card border border-border p-3">
                      <p className="text-sm font-semibold">
                        {picker === 'move' ? t('table.moveTo') : t('table.mergeHint')}
                      </p>
                      {(picker === 'move' ? freeTables : mergeCandidates).length === 0 ? (
                        <p className="text-sm text-foreground-muted">{t('table.noFreeTables')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(picker === 'move' ? freeTables : mergeCandidates).map((x) => (
                            <button
                              key={x.id}
                              type="button"
                              onClick={() =>
                                action.mutate(
                                  picker === 'move'
                                    ? {
                                        path: 'transfer',
                                        body: { toTableId: x.id },
                                        message: t('table.moved', { name: x.name }),
                                      }
                                    : {
                                        path: 'merge',
                                        body: { tableId: x.id },
                                        message: t('table.mergedOk', { name: x.name }),
                                      },
                                )
                              }
                              className={cn(
                                'flex h-12 min-w-14 items-center justify-center rounded-control border-2 px-3 font-bold transition-transform active:scale-95',
                                STATUS_STYLE[x.status].tile,
                              )}
                            >
                              {x.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <UserRoundCog className="size-4 text-foreground-muted" aria-hidden />
                      {t('table.handOver')}
                    </span>
                    <Select
                      aria-label={t('table.handOver')}
                      value={session.waiterId ? String(session.waiterId) : undefined}
                      placeholder={t('table.noWaiter')}
                      onValueChange={(v) => {
                        const waiter = floor.waiters.find((w) => w.id === Number(v));
                        if (waiter && waiter.id !== session.waiterId) {
                          action.mutate({
                            path: 'transfer',
                            body: { toWaiterId: waiter.id },
                            message: t('table.handedOver', { name: waiter.name }),
                          });
                        }
                      }}
                      options={floor.waiters.map((w) => ({ value: String(w.id), label: w.name }))}
                    />
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t('table.closeConfirm', { name: table.name })}
        description={t('table.closeDescription')}
        confirmLabel={t('table.close')}
        loading={closeTable.isPending}
        onConfirm={() => closeTable.mutate(undefined)}
      />
    </div>
  );
}
