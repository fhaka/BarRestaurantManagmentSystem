import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Lock, Unlock } from 'lucide-react';
import {
  ALL_DENOMINATIONS,
  countDenominations,
  formatMoney,
  type CashDrawer,
} from '@tavolina/shared';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  Textarea,
  cn,
  toast,
} from '@tavolina/ui';
import { useApproval } from '../../lib/useApproval';
import { withApproval } from '../../lib/approval';
import { currentLocale } from '../../i18n';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { MoneyInput } from '../menu/fields';

/** Cash drawer (plan §5.8): float, pay-ins and pay-outs, no-sale, and the counted close. */
export function DrawerPanel() {
  const locationId = useSession((s) => s.locationId);
  const drawer = useQuery({
    queryKey: ['cash', locationId],
    queryFn: async () =>
      (await api<{ drawer: CashDrawer | null }>('GET', '/cash-drawers/current')).drawer,
    refetchInterval: 30_000,
  });
  if (drawer.isLoading) return <Skeleton className="h-64" />;
  return drawer.data ? <OpenDrawer drawer={drawer.data} /> : <OpenForm />;
}

function useDrawerUpdate() {
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  return (next: CashDrawer | null) => {
    queryClient.setQueryData(['cash', locationId], next && next.status === 'open' ? next : null);
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
  };
}

function OpenForm() {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const update = useDrawerUpdate();
  const [float, setFloat] = useState<number | null>(500_000);
  const open = useMutation({
    mutationFn: () =>
      api<CashDrawer>('POST', '/cash-drawers', { body: { floatMinor: float ?? 0 } }),
    onSuccess: (d) => {
      toast.success(t('drawer.opened'));
      update(d);
    },
    onError: (err) => toast.error(message(err)),
  });
  return (
    <Card className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Lock className="size-5" aria-hidden />
        {t('drawer.closedTitle')}
      </h2>
      <p className="text-foreground-muted">{t('drawer.closedBody')}</p>
      <Field label={t('drawer.float')}>
        <MoneyInput value={float} onChange={setFloat} />
      </Field>
      <Button size="lg" loading={open.isPending} onClick={() => open.mutate()}>
        <Unlock />
        {t('drawer.open')}
      </Button>
    </Card>
  );
}

function OpenDrawer({ drawer }: { drawer: CashDrawer }) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const can = useSession((s) => s.can);
  const update = useDrawerUpdate();
  const { approve, dialog } = useApproval();
  const [movement, setMovement] = useState<'pay_in' | 'pay_out' | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const noSale = async () => {
    setBusy(true);
    try {
      const reason = t('drawer.noSaleReason');
      const res = await withApproval(
        approve,
        {
          action: 'cash_drawer.open_no_sale',
          entityType: 'cash_drawer',
          entityId: drawer.id,
          summary: t('drawer.noSaleSummary'),
        },
        (approvalToken) =>
          api<{ jobId: number | null }>('POST', `/cash-drawers/${drawer.id}/no-sale`, {
            body: { reason, approvalToken },
          }),
      );
      if (res)
        toast({
          tone: res.jobId ? 'success' : 'info',
          title: res.jobId ? t('drawer.kicked') : t('drawer.noPrinter'),
        });
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-bold">{t('drawer.movements')}</h2>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {drawer.movements.map((m) => {
            const out = m.type === 'pay_out' || m.type === 'refund' || m.type === 'tip_out';
            return (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <span className="flex-1">
                  <span className="font-semibold">{t(`drawer.types.${m.type}`)}</span>
                  {m.reason ? <span className="text-foreground-muted"> · {m.reason}</span> : null}
                  <span className="block text-xs text-foreground-subtle">
                    {new Date(m.createdAt).toLocaleTimeString(currentLocale(), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {m.userName}
                  </span>
                </span>
                <span
                  className={cn('font-mono tabular-nums', out ? 'text-danger' : 'text-success')}
                >
                  {out ? '−' : '+'}
                  {formatMoney(m.amountMinor)}
                </span>
              </li>
            );
          })}
          <li className="flex items-center justify-between py-2">
            <span className="font-semibold">{t('drawer.float')}</span>
            <span className="font-mono tabular-nums">{formatMoney(drawer.floatMinor)}</span>
          </li>
        </ul>
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <p className="text-sm text-foreground-muted">{t('drawer.expected')}</p>
          <p className="font-mono text-3xl font-extrabold tabular-nums">
            {formatMoney(drawer.expectedMinor)}
          </p>
          <p className="text-xs text-foreground-subtle">
            {t('drawer.openedBy', {
              name: drawer.openedBy,
              time: new Date(drawer.openedAt).toLocaleTimeString(currentLocale(), {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        </div>
        {can('cash.movement') ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setMovement('pay_in')}>
              <ArrowDownToLine />
              {t('drawer.payIn')}
            </Button>
            <Button variant="outline" onClick={() => setMovement('pay_out')}>
              <ArrowUpFromLine />
              {t('drawer.payOut')}
            </Button>
          </div>
        ) : null}
        <Button variant="outline" loading={busy} onClick={() => void noSale()}>
          <Banknote />
          {t('drawer.noSale')}
        </Button>
        <Button size="lg" variant="highlight" onClick={() => setClosing(true)}>
          <Lock />
          {t('drawer.close')}
        </Button>
      </Card>

      <MovementDialog
        drawer={drawer}
        type={movement}
        onClose={() => setMovement(null)}
        onDone={update}
      />
      <CloseDialog
        drawer={drawer}
        open={closing}
        approve={approve}
        onClose={() => setClosing(false)}
        onDone={update}
      />
      {dialog}
    </div>
  );
}

function MovementDialog({
  drawer,
  type,
  onClose,
  onDone,
}: {
  drawer: CashDrawer;
  type: 'pay_in' | 'pay_out' | null;
  onClose: () => void;
  onDone: (d: CashDrawer) => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api<CashDrawer>('POST', `/cash-drawers/${drawer.id}/movements`, {
        body: { type, amountMinor: amount, reason: reason.trim() },
      }),
    onSuccess: (d) => {
      toast.success(t('drawer.saved'));
      setAmount(null);
      setReason('');
      onDone(d);
      onClose();
    },
    onError: (err) => toast.error(message(err)),
  });
  return (
    <Dialog open={type !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? t(`drawer.types.${type}`) : ''}</DialogTitle>
          <DialogDescription>
            {type === 'pay_out' ? t('drawer.payOutHint') : t('drawer.payInHint')}
          </DialogDescription>
        </DialogHeader>
        <Field label={t('drawer.amount')}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label={t('drawer.reason')}>
          <Input
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('drawer.reasonPlaceholder')}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={!amount || reason.trim().length < 3}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('drawer.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** End of shift: count notes and coins; the difference is shown before a manager approves. */
function CloseDialog({
  drawer,
  open,
  approve,
  onClose,
  onDone,
}: {
  drawer: CashDrawer;
  open: boolean;
  approve: Parameters<typeof withApproval>[0];
  onClose: () => void;
  onDone: (d: CashDrawer | null) => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const numeric = Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [Number(k), Number(v || 0)]),
  );
  const counted = countDenominations(numeric);
  const diff = counted - drawer.expectedMinor;

  const submit = async () => {
    setBusy(true);
    try {
      const closed = await withApproval(
        approve,
        {
          action: 'cash_drawer.close',
          entityType: 'cash_drawer',
          entityId: drawer.id,
          summary: t('drawer.closeSummary', {
            counted: formatMoney(counted),
            diff: formatMoney(diff),
          }),
        },
        (approvalToken) =>
          api<CashDrawer>('POST', `/cash-drawers/${drawer.id}/close`, {
            body: {
              counts: Object.fromEntries(
                Object.entries(numeric)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => [k, v]),
              ),
              note: note.trim() || null,
              approvalToken,
            },
          }),
      );
      if (closed) {
        toast.success(t('drawer.closedOk', { diff: formatMoney(closed.differenceMinor ?? 0) }));
        onDone(null);
        onClose();
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('drawer.countTitle')}</DialogTitle>
          <DialogDescription>{t('drawer.countHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ALL_DENOMINATIONS.map((d) => (
            <label
              key={d}
              className="flex items-center gap-2 rounded-control border border-border px-2 py-1.5"
            >
              <span className="w-16 font-mono text-sm font-semibold tabular-nums">{d} L</span>
              <span className="text-foreground-subtle">×</span>
              <Input
                inputMode="numeric"
                aria-label={t('drawer.countOf', { value: d })}
                className="h-9"
                value={counts[d] ?? ''}
                onChange={(e) =>
                  setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '').slice(0, 5) })
                }
              />
            </label>
          ))}
        </div>
        <dl className="grid grid-cols-3 gap-2 rounded-card bg-surface-sunken p-3 text-sm">
          <div>
            <dt className="text-foreground-muted">{t('drawer.expected')}</dt>
            <dd className="font-mono font-bold tabular-nums">
              {formatMoney(drawer.expectedMinor)}
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('drawer.counted')}</dt>
            <dd className="font-mono font-bold tabular-nums">{formatMoney(counted)}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('drawer.difference')}</dt>
            <dd
              className={cn(
                'font-mono font-bold tabular-nums',
                diff === 0 ? 'text-success' : 'text-danger',
              )}
            >
              {diff > 0 ? '+' : ''}
              {formatMoney(diff)}
            </dd>
          </div>
        </dl>
        <Field label={t('drawer.note')}>
          <Textarea
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="highlight" loading={busy} onClick={() => void submit()}>
            {t('drawer.closeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
