import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import {
  formatMoney,
  splitEqually,
  type BillSplitInput,
  type BillView,
  type SplitType,
} from '@tavolina/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { ChipToggle, MoneyInput } from '../menu/fields';

/** Plan §5.7: split equally by N people, by seat, by selecting items, or custom amounts. */
export function SplitDialog({
  view,
  open,
  onClose,
  onSplit,
}: {
  view: BillView;
  open: boolean;
  onClose: () => void;
  onSplit: (next: BillView) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {open ? <SplitForm view={view} onSplit={onSplit} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SplitForm({
  view,
  onSplit,
  onClose,
}: {
  view: BillView;
  onSplit: (next: BillView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const total = view.totals.totalMinor;
  const lines = view.order.items.filter(
    (i) =>
      i.parentItemId === null && !['voided', 'draft', 'pending_confirmation'].includes(i.status),
  );
  const [type, setType] = useState<SplitType>('equal');
  const [parts, setParts] = useState(2);
  const [groups, setGroups] = useState<Record<number, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, 0])),
  );
  const [billCount, setBillCount] = useState(2);
  const [amounts, setAmounts] = useState<(number | null)[]>(() => splitEqually(total, 2));
  const [busy, setBusy] = useState(false);
  const seats = new Set(lines.map((l) => l.seat ?? 0));

  const customSum = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const itemGroups = Array.from({ length: billCount }, (_, i) =>
    lines.filter((l) => groups[l.id] === i).map((l) => l.id),
  );
  const valid =
    type === 'custom'
      ? customSum === total && amounts.every((a) => a !== null && a > 0 && a % 100 === 0)
      : type === 'items'
        ? itemGroups.every((g) => g.length > 0)
        : type === 'seat'
          ? seats.size > 1
          : true;

  const submit = async () => {
    const body: BillSplitInput =
      type === 'equal'
        ? { type, parts }
        : type === 'items'
          ? { type, groups: itemGroups }
          : type === 'custom'
            ? { type, amountsMinor: amounts.map((a) => a ?? 0) }
            : { type };
    setBusy(true);
    try {
      onSplit(await api<BillView>('POST', `/orders/${view.order.id}/split`, { body }));
      onClose();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const stepper = (
    value: number,
    set: (n: number) => void,
    min: number,
    max: number,
    label: string,
  ) => (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="icon"
        aria-label={t('split.less')}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        <Minus />
      </Button>
      <span
        className="min-w-10 text-center font-mono text-2xl font-bold tabular-nums"
        aria-label={label}
      >
        {value}
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label={t('split.more')}
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('split.title')}</DialogTitle>
        <DialogDescription>{t('split.total', { amount: formatMoney(total) })}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('split.how')}>
        {(['full', 'equal', 'seat', 'items', 'custom'] as const).map((k) => (
          <ChipToggle key={k} pressed={type === k} onToggle={() => setType(k)}>
            {t(`split.types.${k}`)}
          </ChipToggle>
        ))}
      </div>

      <div className="min-h-32">
        {type === 'full' ? <p className="text-foreground-muted">{t('split.fullHint')}</p> : null}
        {type === 'equal' ? (
          <div className="flex flex-col gap-3">
            {stepper(parts, setParts, 2, 20, t('split.people'))}
            <p className="text-sm text-foreground-muted">
              {splitEqually(total, parts)
                .map((a) => formatMoney(a))
                .join(' + ')}
            </p>
          </div>
        ) : null}
        {type === 'seat' ? (
          <p className="text-foreground-muted">
            {seats.size > 1 ? t('split.seatHint', { count: seats.size }) : t('split.noSeats')}
          </p>
        ) : null}
        {type === 'items' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t('split.bills')}</span>
              {stepper(
                billCount,
                (n) => {
                  setBillCount(n);
                  setGroups((g) =>
                    Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Math.min(v, n - 1)])),
                  );
                },
                2,
                10,
                t('split.bills'),
              )}
            </div>
            <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 flex-1 text-sm">
                    {l.qty}× {l.name}
                    <span className="ml-2 font-mono text-foreground-muted">
                      {formatMoney(l.lineTotalMinor)}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {Array.from({ length: billCount }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-pressed={groups[l.id] === i}
                        aria-label={t('split.toBill', { n: i + 1, name: l.name })}
                        onClick={() => setGroups({ ...groups, [l.id]: i })}
                        className={cn(
                          'size-9 rounded-full border text-sm font-bold',
                          groups[l.id] === i
                            ? 'border-primary bg-primary text-primary-fg'
                            : 'border-border-strong',
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {type === 'custom' ? (
          <div className="flex flex-col gap-2">
            {amounts.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 text-sm font-semibold">
                  {t('bill.numbered', { n: i + 1 })}
                </span>
                <MoneyInput
                  value={a}
                  onChange={(v) => setAmounts(amounts.map((x, j) => (j === i ? v : x)))}
                />
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={amounts.length >= 10}
                onClick={() => setAmounts(splitEqually(total, amounts.length + 1))}
              >
                <Plus />
                {t('split.addPart')}
              </Button>
              <span
                className={cn(
                  'text-sm font-semibold',
                  customSum === total ? 'text-success' : 'text-danger',
                )}
              >
                {customSum === total
                  ? t('split.matches')
                  : t('split.left', { amount: formatMoney(total - customSum) })}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button disabled={!valid} loading={busy} onClick={() => void submit()}>
          {t('split.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
