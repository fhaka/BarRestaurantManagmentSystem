import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  changeDue,
  formatMoney,
  PAYMENT_METHODS,
  roundToLek,
  type BillView,
  type PaymentMethod,
} from '@tavolina/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  cn,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { ChipToggle, MoneyInput } from '../menu/fields';
import { METHOD_ICON, quickTender } from './billing-utils';

export interface PayTarget {
  billId: number | null;
  label: string;
  dueMinor: number;
}

/**
 * Takes one payment on a bill (plan §5.7): cash with change, card with the terminal reference,
 * voucher or house account with a reference, plus an optional tip. Paying part of a bill and then
 * the rest another way is a mixed payment.
 */
export function PaymentDialog({
  view,
  target,
  onClose,
  onPaid,
}: {
  view: BillView;
  target: PayTarget | null;
  onClose: () => void;
  onPaid: (next: BillView) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {target ? (
          <PaymentForm
            key={`${target.billId}:${target.dueMinor}`}
            view={view}
            target={target}
            onPaid={onPaid}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  view,
  target,
  onPaid,
  onClose,
}: {
  view: BillView;
  target: PayTarget;
  onPaid: (next: BillView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState<number | null>(target.dueMinor);
  const [tip, setTip] = useState<number | null>(0);
  const [tendered, setTendered] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [uuid] = useState(() => crypto.randomUUID());

  const amountMinor = amount ?? 0;
  const tipMinor = tip ?? 0;
  const owed = amountMinor + tipMinor;
  const given = tendered ?? owed;
  const change = changeDue(given, owed);
  const needsReference = method === 'voucher' || method === 'account';
  const valid =
    amountMinor > 0 &&
    amountMinor <= target.dueMinor &&
    (method !== 'cash' || given >= owed) &&
    (!needsReference || reference.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const next = await api<BillView>('POST', `/orders/${view.order.id}/payments`, {
        body: {
          billId: target.billId,
          uuid,
          method,
          amountMinor,
          tipMinor,
          tenderedMinor: method === 'cash' ? given : null,
          reference: reference.trim() || null,
        },
      });
      toast.success(
        method === 'cash' && change > 0
          ? t('pay.doneChange', { change: formatMoney(change) })
          : t('pay.done', { amount: formatMoney(amountMinor) }),
      );
      onPaid(next);
      onClose();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('pay.title', { label: target.label })}</DialogTitle>
        <DialogDescription>
          {t('pay.due', { amount: formatMoney(target.dueMinor) })}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('pay.method')}>
          {PAYMENT_METHODS.map((m) => {
            const Icon = METHOD_ICON[m];
            return (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border-2 text-sm font-semibold',
                  method === m
                    ? 'border-primary bg-primary-soft text-primary-soft-fg'
                    : 'border-border hover:bg-surface-sunken',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {t(`methods.${m}`)}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('pay.amount')}
            hint={amountMinor < target.dueMinor ? t('pay.partial') : undefined}
          >
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label={t('pay.tip')}>
            <MoneyInput value={tip} onChange={setTip} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2" aria-label={t('pay.tip')}>
          <ChipToggle pressed={tipMinor === 0} onToggle={() => setTip(0)}>
            {t('pay.noTip')}
          </ChipToggle>
          {view.tipOptionsBp.map((bp) => {
            const value = roundToLek(Math.round((amountMinor * bp) / 10_000));
            return (
              <ChipToggle
                key={bp}
                pressed={tipMinor === value && value > 0}
                onToggle={() => setTip(value)}
              >
                {bp / 100}% · {formatMoney(value)}
              </ChipToggle>
            );
          })}
        </div>

        {method === 'cash' ? (
          <div className="flex flex-col gap-3 rounded-card border border-border p-4">
            <Field label={t('pay.tendered')}>
              <MoneyInput value={tendered} onChange={setTendered} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {quickTender(owed).map((v) => (
                <ChipToggle key={v} pressed={given === v} onToggle={() => setTendered(v)}>
                  {formatMoney(v)}
                </ChipToggle>
              ))}
            </div>
            <p className="flex items-baseline justify-between text-lg">
              <span className="font-semibold">{t('pay.change')}</span>
              <span
                className={cn(
                  'font-mono text-2xl font-bold tabular-nums',
                  given < owed && 'text-danger',
                )}
              >
                {given < owed
                  ? t('pay.short', { amount: formatMoney(owed - given) })
                  : formatMoney(change)}
              </span>
            </p>
          </div>
        ) : (
          <Field label={needsReference ? t(`pay.reference.${method}`) : t('pay.reference.card')}>
            <Input
              value={reference}
              maxLength={100}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="lg" disabled={!valid} loading={busy} onClick={() => void submit()}>
          {t('pay.confirm', { amount: formatMoney(owed) })}
        </Button>
      </DialogFooter>
    </>
  );
}
