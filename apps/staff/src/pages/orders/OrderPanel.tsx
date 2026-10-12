import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Ban,
  CloudOff,
  Flame,
  HandPlatter,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Repeat,
  Send,
  Trash2,
} from 'lucide-react';
import { formatMoney, type AdminMenu, type Order, type OrderItem } from '@tavolina/shared';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useMyOutbox } from '../../lib/outbox';
import { useSession } from '../../lib/session';
import { VoidDialog } from './VoidDialog';
import { ITEM_STATUS_STYLE, describeLine, type CartLine, type OrderTarget } from './order-utils';

export function OrderPanel({
  menu,
  order,
  target,
  cart,
  timeZone,
  readOnly,
  sending,
  onCartChange,
  onEditLine,
  onSend,
  onOrderChange,
}: {
  menu: AdminMenu;
  order: Order | null;
  target: OrderTarget;
  cart: CartLine[];
  timeZone: string;
  readOnly: boolean;
  sending: boolean;
  onCartChange: (lines: CartLine[]) => void;
  onEditLine: (line: CartLine) => void;
  onSend: () => void;
  onOrderChange: (order: Order) => void;
}) {
  const { t } = useTranslation('orders');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const can = useSession((s) => s.can);
  const [voiding, setVoiding] = useState<OrderItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const outbox = useMyOutbox();
  const queued = outbox.filter(
    (e) =>
      e.meta.kind === 'order.items' &&
      (target.kind === 'session'
        ? e.meta.sessionId === target.sessionId
        : order !== null && e.meta.orderId === order.id),
  );

  const run = async (id: string, fn: () => Promise<Order>, success?: string) => {
    setBusy(id);
    try {
      onOrderChange(await fn());
      if (success) toast.success(success);
      void queryClient.invalidateQueries({ queryKey: ['floor'] });
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(null);
    }
  };

  const items = order?.items ?? [];
  const lines = items.filter((i) => i.parentItemId === null);
  const childrenOf = (id: number) => items.filter((i) => i.parentItemId === id);
  const readyCount = items.filter((i) => i.status === 'ready' && i.comboId === null).length;
  const cartView = cart.map((line) => ({ line, view: describeLine(menu, line, timeZone) }));
  const cartTotal = cartView.reduce((sum, x) => sum + x.view.totalMinor, 0);
  const setQty = (uuid: string, qty: number) =>
    onCartChange(
      qty < 1
        ? cart.filter((l) => l.uuid !== uuid)
        : cart.map((l) => (l.uuid === uuid ? { ...l, qty } : l)),
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* New lines, not sent yet. */}
        <section aria-labelledby="cart-title" className="border-b border-border p-3">
          <h2
            id="cart-title"
            className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground-muted"
          >
            {t('cart.title')}
          </h2>
          {cart.length === 0 ? (
            <p className="py-3 text-center text-sm text-foreground-muted">
              {readOnly ? t('cart.readOnly') : t('cart.empty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {cartView.map(({ line, view }) => (
                <li
                  key={line.uuid}
                  className="flex items-start gap-2 rounded-control bg-primary-soft/50 p-2"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onEditLine(line)}
                  >
                    <span className="flex items-baseline gap-1.5 font-semibold">
                      <span className="truncate">{view.name}</span>
                      <Pencil className="size-3 shrink-0 text-foreground-subtle" aria-hidden />
                    </span>
                    <LineMeta
                      details={view.details}
                      seat={line.seat}
                      course={line.course}
                      notes={line.notes}
                    />
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatMoney(view.totalMinor)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={
                          line.qty === 1
                            ? t('cart.remove', { name: view.name })
                            : t('cart.less', { name: view.name })
                        }
                        onClick={() => setQty(line.uuid, line.qty - 1)}
                      >
                        {line.qty === 1 ? <Trash2 /> : <Minus />}
                      </Button>
                      <span className="w-6 text-center font-mono font-bold tabular-nums">
                        {line.qty}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={t('cart.more', { name: view.name })}
                        disabled={line.qty >= 99}
                        onClick={() => setQty(line.uuid, line.qty + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {queued.length ? (
          <section className="border-b border-border bg-warning-soft/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-warning-soft-fg">
              <CloudOff className="size-4" aria-hidden />
              {t('offline.waiting')}
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {queued.flatMap((e) =>
                e.meta.kind === 'order.items'
                  ? (e.meta.lines ?? []).map((l) => (
                      <li key={l.uuid} className="flex justify-between gap-2">
                        <span>
                          {l.qty}× {l.name}
                        </span>
                        <Badge tone="warning" size="sm">
                          {t('offline.notSent')}
                        </Badge>
                      </li>
                    ))
                  : [],
              )}
            </ul>
          </section>
        ) : null}

        {/* What the kitchen already has. */}
        <section aria-labelledby="sent-title" className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2
              id="sent-title"
              className="text-xs font-bold uppercase tracking-wider text-foreground-muted"
            >
              {t('sentItems')}
            </h2>
            {readyCount && order && !readOnly ? (
              <Button
                size="sm"
                variant="primary"
                loading={busy === 'serve-all'}
                onClick={() =>
                  void run(
                    'serve-all',
                    () => api<Order>('POST', `/orders/${order.id}/serve`, { body: {} }),
                    t('servedAll'),
                  )
                }
              >
                <HandPlatter />
                {t('serveAll', { count: readyCount })}
              </Button>
            ) : null}
          </div>

          {order?.heldCourses.length && !readOnly ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {order.heldCourses.map((course) => (
                <Button
                  key={course}
                  variant="highlight"
                  size="sm"
                  loading={busy === `fire-${course}`}
                  onClick={() =>
                    void run(
                      `fire-${course}`,
                      () => api<Order>('POST', `/orders/${order.id}/fire`, { body: { course } }),
                      t('fired', { n: course }),
                    )
                  }
                >
                  <Flame />
                  {t('fire', { n: course })}
                </Button>
              ))}
            </div>
          ) : null}

          {lines.length === 0 ? (
            <p className="py-3 text-center text-sm text-foreground-muted">{t('nothingSent')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {lines.map((item) => (
                <SentLine
                  key={item.id}
                  item={item}
                  parts={childrenOf(item.id)}
                  busy={busy}
                  readOnly={readOnly}
                  canVoid={can('order.void')}
                  onServe={(i) =>
                    void run(`serve-${i.id}`, () =>
                      api<Order>('POST', `/order-items/${i.id}/serve`),
                    )
                  }
                  onRepeat={(i) =>
                    void run(
                      `repeat-${i.id}`,
                      () =>
                        api<Order>('POST', `/orders/${order!.id}/repeat`, {
                          body: { itemRefs: [i.id], uuids: [crypto.randomUUID()], send: true },
                        }),
                      t('repeated', { name: i.name }),
                    )
                  }
                  onVoid={setVoiding}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="flex flex-col gap-2 border-t border-border bg-surface p-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-foreground-muted">{t('total')}</span>
          <span className="font-mono text-lg font-bold tabular-nums">
            {formatMoney((order?.totalMinor ?? 0) + cartTotal)}
          </span>
        </div>
        <Button
          size="xl"
          block
          disabled={!cart.length || readOnly}
          loading={sending}
          onClick={onSend}
        >
          <Send />
          {cart.length
            ? t('cart.send', { count: cart.reduce((n, l) => n + l.qty, 0) })
            : t('cart.sendEmpty')}
          {cart.length ? (
            <span className="ml-auto font-mono tabular-nums">{formatMoney(cartTotal)}</span>
          ) : null}
        </Button>
        <p className="hidden text-center text-xs text-foreground-subtle lg:block">
          {t('shortcuts')}
        </p>
      </footer>

      <VoidDialog item={voiding} onClose={() => setVoiding(null)} onVoided={onOrderChange} />
    </div>
  );
}

function LineMeta({
  details,
  seat,
  course,
  notes,
}: {
  details: string[];
  seat: number | null;
  course: number | null;
  notes: string | null;
}) {
  const { t } = useTranslation('orders');
  const bits = [
    ...details,
    seat ? t('seatN', { n: seat }) : null,
    course ? t('options.courseN', { n: course }) : null,
  ].filter(Boolean);
  return (
    <>
      {bits.length ? (
        <span className="block text-xs text-foreground-muted">{bits.join(' · ')}</span>
      ) : null}
      {notes ? (
        <span className="block text-xs font-semibold text-highlight-soft-fg">“{notes}”</span>
      ) : null}
    </>
  );
}

function SentLine({
  item,
  parts,
  busy,
  readOnly,
  canVoid,
  onServe,
  onRepeat,
  onVoid,
}: {
  item: OrderItem;
  /** The dishes of a combo line. */
  parts: OrderItem[];
  busy: string | null;
  readOnly: boolean;
  canVoid: boolean;
  onServe: (item: OrderItem) => void;
  onRepeat: (item: OrderItem) => void;
  onVoid: (item: OrderItem) => void;
}) {
  const { t } = useTranslation('orders');
  const style = ITEM_STATUS_STYLE[item.status];
  const voided = item.status === 'voided';
  const status = item.held ? 'held' : item.status;
  const voidable = canVoid && ['sent', 'preparing', 'ready'].includes(item.status);
  return (
    <li className={cn('flex flex-col gap-1 py-2', voided && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <span className="w-7 shrink-0 font-mono font-bold tabular-nums">{item.qty}×</span>
        <div className="min-w-0 flex-1">
          <span className={cn('font-semibold', voided && 'line-through')}>
            {item.name}
            {item.variantName ? (
              <span className="font-normal text-foreground-muted"> · {item.variantName}</span>
            ) : null}
          </span>
          <LineMeta
            details={item.modifiers.map((m) => m.name)}
            seat={item.seat}
            course={item.course}
            notes={item.notes}
          />
          {voided && item.voidReason ? (
            <span className="block text-xs text-danger">
              {t('voidedBecause', { reason: item.voidReason })}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-sm tabular-nums">{formatMoney(item.lineTotalMinor)}</span>
          <Badge tone={item.held ? 'warning' : style.tone} size="sm" icon={<style.icon />}>
            {t(`status.${status}`)}
          </Badge>
        </div>
        {!readOnly && (voidable || item.status !== 'voided') ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('itemActions', { name: item.name })}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onRepeat(item)}>
                <Repeat />
                {t('repeat')}
              </DropdownMenuItem>
              {voidable ? (
                <DropdownMenuItem destructive onSelect={() => onVoid(item)}>
                  <Ban />
                  {t('void.action')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {parts.length ? (
        <ul className="ml-9 flex flex-col gap-1 border-l-2 border-border pl-2">
          {parts.map((c) => {
            const cs = ITEM_STATUS_STYLE[c.status];
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className={cn(c.status === 'voided' && 'line-through opacity-60')}>
                  {c.name}
                  {c.variantName ? ` · ${c.variantName}` : ''}
                </span>
                <span className="flex items-center gap-1">
                  <Badge tone={c.held ? 'warning' : cs.tone} size="sm" icon={<cs.icon />}>
                    {t(`status.${c.held ? 'held' : c.status}`)}
                  </Badge>
                  {c.status === 'ready' && !readOnly ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === `serve-${c.id}`}
                      onClick={() => onServe(c)}
                    >
                      {t('serve')}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {item.status === 'ready' && item.comboId === null && !readOnly ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-9 self-start"
          loading={busy === `serve-${item.id}`}
          onClick={() => onServe(item)}
        >
          <HandPlatter />
          {t('serve')}
        </Button>
      ) : null}
    </li>
  );
}
