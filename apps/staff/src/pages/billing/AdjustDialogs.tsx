import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, type BillView, type Payment } from '@tavolina/shared';
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
  Textarea,
  toast,
} from '@tavolina/ui';
import { withApproval, type ApprovalRequest } from '../../lib/approval';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { ChipToggle, MoneyInput } from '../menu/fields';

type Approve = (request: ApprovalRequest) => Promise<string | null>;

const DISCOUNT_REASONS = ['regular', 'complaint', 'staff', 'promo', 'wait'] as const;

export interface DiscountTarget {
  orderItemId: number | null;
  name: string;
  baseMinor: number;
}

/** % or fixed off one line or the whole bill, with a reason (plan §5.7). */
export function DiscountDialog({
  view,
  target,
  approve,
  onClose,
  onDone,
}: {
  view: BillView;
  target: DiscountTarget | null;
  approve: Approve;
  onClose: () => void;
  onDone: (next: BillView) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {target ? (
          <DiscountForm
            view={view}
            target={target}
            approve={approve}
            onClose={onClose}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DiscountForm({
  view,
  target,
  approve,
  onClose,
  onDone,
}: {
  view: BillView;
  target: DiscountTarget;
  approve: Approve;
  onClose: () => void;
  onDone: (next: BillView) => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [percent, setPercent] = useState('10');
  const [fixed, setFixed] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const value =
    type === 'percent' ? Math.round(Number(percent.replace(',', '.')) * 100) : (fixed ?? 0);
  const valid =
    reason.trim().length >= 3 &&
    value > 0 &&
    (type === 'percent' ? value <= 10_000 : value % 100 === 0 && value <= target.baseMinor);
  const preview =
    type === 'percent' ? Math.round((target.baseMinor * value) / 10_000 / 100) * 100 : value;

  const submit = async () => {
    setBusy(true);
    try {
      const next = await withApproval(
        approve,
        {
          action: 'order.discount',
          entityType: 'order',
          entityId: view.order.id,
          summary: t('discount.summary', { amount: formatMoney(preview), name: target.name }),
        },
        (approvalToken) =>
          api<BillView>('POST', `/orders/${view.order.id}/discounts`, {
            body: {
              orderItemId: target.orderItemId,
              type,
              value,
              reason: reason.trim(),
              approvalToken,
            },
          }),
      );
      if (next) {
        toast.success(t('discount.done'));
        onDone(next);
        onClose();
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('discount.title', { name: target.name })}</DialogTitle>
        <DialogDescription>
          {t('discount.base', { amount: formatMoney(target.baseMinor) })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <ChipToggle pressed={type === 'percent'} onToggle={() => setType('percent')}>
            {t('discount.percent')}
          </ChipToggle>
          <ChipToggle pressed={type === 'fixed'} onToggle={() => setType('fixed')}>
            {t('discount.fixed')}
          </ChipToggle>
        </div>
        {type === 'percent' ? (
          <Field label={t('discount.percentLabel')}>
            <Input
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </Field>
        ) : (
          <Field label={t('discount.fixedLabel')}>
            <MoneyInput value={fixed} onChange={setFixed} />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          {DISCOUNT_REASONS.map((k) => {
            const text = t(`discount.reasons.${k}`);
            return (
              <ChipToggle
                key={k}
                pressed={reason === text}
                onToggle={() => setReason(reason === text ? '' : text)}
              >
                {text}
              </ChipToggle>
            );
          })}
        </div>
        <Textarea
          aria-label={t('discount.reason')}
          placeholder={t('discount.reasonPlaceholder')}
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-sm">
          {t('discount.preview')}{' '}
          <strong className="font-mono">−{formatMoney(Math.max(0, preview))}</strong>
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button disabled={!valid} loading={busy} onClick={() => void submit()}>
          {t('discount.apply')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Full or partial refund of one payment; a manager always approves (plan §5.7). */
export function RefundDialog({
  payment,
  approve,
  onClose,
  onDone,
}: {
  payment: Payment | null;
  approve: Approve;
  onClose: () => void;
  onDone: (next: BillView) => void;
}) {
  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {payment ? (
          <RefundForm payment={payment} approve={approve} onClose={onClose} onDone={onDone} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RefundForm({
  payment,
  approve,
  onClose,
  onDone,
}: {
  payment: Payment;
  approve: Approve;
  onClose: () => void;
  onDone: (next: BillView) => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const max = payment.amountMinor - payment.refundedMinor;
  const [amount, setAmount] = useState<number | null>(max);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 3 && amount !== null && amount > 0 && amount <= max;

  const submit = async () => {
    setBusy(true);
    try {
      const next = await withApproval(
        approve,
        {
          action: 'payment.refund',
          entityType: 'payment',
          entityId: payment.id,
          summary: t('refund.summary', { amount: formatMoney(amount ?? 0) }),
        },
        (approvalToken) =>
          api<BillView>('POST', `/payments/${payment.id}/refund`, {
            body: { amountMinor: amount, reason: reason.trim(), approvalToken },
          }),
      );
      if (next) {
        toast.success(t('refund.done', { amount: formatMoney(amount ?? 0) }));
        onDone(next);
        onClose();
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('refund.title')}</DialogTitle>
        <DialogDescription>
          {t(`methods.${payment.method}`)} · {formatMoney(payment.amountMinor)} ·{' '}
          {t('refund.max', { amount: formatMoney(max) })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label={t('refund.amount')}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label={t('refund.reason')}>
          <Textarea
            rows={2}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <p className="text-sm text-foreground-muted">{t('refund.note')}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="danger" disabled={!valid} loading={busy} onClick={() => void submit()}>
          {t('refund.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
