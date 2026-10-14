import { useTranslation } from 'react-i18next';
import { Check, ChefHat, CircleDashed, Clock, HandPlatter, Send, XCircle } from 'lucide-react';
import { formatMoney } from '@tavolina/shared/client';
import type { GuestMenu, GuestOrderLine, GuestTableState, OrderItemStatus } from '@tavolina/shared';
import { Sheet, SheetContent, SheetTitle, cn } from '@tavolina/ui';
import { localLine } from '../lib/cart';

/** received → preparing → ready → served (plan §5.5), with "waiting for the waiter" first. */
const STEPS: OrderItemStatus[] = ['pending_confirmation', 'sent', 'preparing', 'ready', 'served'];
const STEP_ICON = {
  pending_confirmation: Clock,
  sent: Send,
  preparing: ChefHat,
  ready: Check,
  served: HandPlatter,
} as const;

function Timeline({ status }: { status: OrderItemStatus }) {
  const { t } = useTranslation();
  if (status === 'voided') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger">
        <XCircle className="size-4" aria-hidden />
        {t('status.voided')}
      </span>
    );
  }
  const current = STEPS.indexOf(status);
  const Icon = STEP_ICON[status as keyof typeof STEP_ICON] ?? CircleDashed;
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-bold',
          status === 'ready'
            ? 'text-success'
            : status === 'pending_confirmation'
              ? 'text-warning-soft-fg'
              : 'text-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
        {t(`status.${status as Exclude<OrderItemStatus, 'draft'>}`)}
      </span>
      <ol className="flex gap-1" aria-hidden>
        {STEPS.map((step, index) => (
          <li
            key={step}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              index <= current ? (status === 'ready' ? 'bg-success' : 'bg-primary') : 'bg-border',
            )}
          />
        ))}
      </ol>
    </div>
  );
}

function Line({
  menu,
  line,
  parts,
}: {
  menu: GuestMenu;
  line: GuestOrderLine;
  parts: GuestOrderLine[];
}) {
  const { t } = useTranslation();
  const currency = menu.location.currencyDisplay;
  const local = localLine(menu, line);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              'font-bold',
              line.status === 'voided' && 'text-foreground-muted line-through',
            )}
          >
            {line.qty}× {local.name}
            {local.variantName ? (
              <span className="font-normal text-foreground-muted"> · {local.variantName}</span>
            ) : null}
          </p>
          {local.modifiers.length ? (
            <p className="text-sm text-foreground-muted">{local.modifiers.join(', ')}</p>
          ) : null}
          {parts.length ? (
            <p className="text-sm text-foreground-muted">
              {parts.map((p) => localLine(menu, p).name).join(' · ')}
            </p>
          ) : null}
          <p className="text-xs text-foreground-subtle">
            {line.mine
              ? t('status.yours')
              : line.byStaff
                ? t('status.byStaff')
                : t('status.otherPhone')}
          </p>
        </div>
        <span className="font-mono text-sm tabular-nums">
          {formatMoney(line.lineTotalMinor, { currency })}
        </span>
      </div>
      <Timeline status={line.status} />
    </li>
  );
}

export function StatusSheet({
  open,
  onOpenChange,
  state,
  menu,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: GuestTableState;
  menu: GuestMenu;
}) {
  const { t } = useTranslation();
  const currency = menu.location.currencyDisplay;
  const top = state.lines.filter((l) => l.parentItemId === null);
  const partsOf = (id: number) => state.lines.filter((l) => l.parentItemId === id);
  const mine = top.filter((l) => l.mine);
  const others = top.filter((l) => !l.mine);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" closeLabel={t('close')} className="max-h-[92dvh]">
        <SheetTitle className="text-2xl font-extrabold tracking-tight">
          {t('status.title')}
        </SheetTitle>
        <p className="text-sm text-foreground-muted" aria-live="polite">
          {t('status.live')}
        </p>
        {top.length === 0 ? (
          <p className="py-8 text-center text-foreground-muted">{t('status.empty')}</p>
        ) : null}
        {[
          { key: 'mine', title: t('status.mine'), lines: mine },
          { key: 'table', title: t('status.table'), lines: others },
        ].map((group) =>
          group.lines.length ? (
            <section key={group.key} className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
                {group.title}
              </h3>
              <ul className="divide-y divide-border">
                {group.lines.map((line) => (
                  <Line key={line.id} menu={menu} line={line} parts={partsOf(line.id)} />
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {top.length ? (
          <dl className="mt-4 flex flex-col gap-1 border-t border-border pt-4">
            <div className="flex justify-between text-sm">
              <dt className="text-foreground-muted">{t('status.myTotal')}</dt>
              <dd className="font-mono tabular-nums">
                {formatMoney(state.myTotalMinor, { currency })}
              </dd>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <dt>{t('status.tableTotal')}</dt>
              <dd className="font-mono tabular-nums">
                {formatMoney(state.totalMinor, { currency })}
              </dd>
            </div>
          </dl>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
