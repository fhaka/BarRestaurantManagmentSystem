import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { Approver, Order, OrderItem } from '@tavolina/shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  toast,
} from '@tavolina/ui';
import { PinPad } from '../../components/PinPad';
import { api, ApiRequestError } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { ChipToggle } from '../menu/fields';
import { useCurrentLocation } from './order-utils';

const REASON_KEYS = ['changedMind', 'wrongOrder', 'dropped', 'tooSlow', 'complaint'] as const;

/**
 * Void a sent item (business rule 3): a reason is required, and unless the user can approve
 * themselves a manager confirms with their PIN on this device (single-use token, plan §4).
 */
export function VoidDialog({
  item,
  onClose,
  onVoided,
}: {
  item: OrderItem | null;
  onClose: () => void;
  onVoided: (order: Order) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {item ? <VoidForm key={item.id} item={item} onVoided={onVoided} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VoidForm({
  item,
  onVoided,
  onClose,
}: {
  item: OrderItem;
  onVoided: (order: Order) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('orders');
  const { t: tc } = useTranslation();
  const { message } = useErrorMessages();
  const can = useSession((s) => s.can);
  const location = useCurrentLocation();
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'reason' | 'approver' | 'pin'>('reason');
  const [approver, setApprover] = useState<Approver | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsApproval =
    (location.data?.settings.voidRequiresApproval ?? true) && !can('approval.grant');
  const approvers = useQuery({
    queryKey: ['approvers', useSession.getState().locationId],
    queryFn: () => api<Approver[]>('GET', '/approvers'),
    enabled: needsApproval,
  });
  const reasonOk = reason.trim().length >= 3;

  const doVoid = async (approvalToken?: string) => {
    const order = await api<Order>('POST', `/order-items/${item.id}/void`, {
      body: { reason: reason.trim(), approvalToken },
    });
    toast.success(t('void.done', { name: item.name }));
    onVoided(order);
    onClose();
  };

  const submitReason = async () => {
    if (!reasonOk) return;
    if (needsApproval) return setStep('approver');
    setBusy(true);
    try {
      await doVoid();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const approveWithPin = async (pin: string) => {
    setPinError(null);
    try {
      const approval = await api<{ approvalToken: string }>('POST', '/approvals', {
        body: {
          approverId: approver!.id,
          pin,
          action: 'order_item.void',
          entityType: 'order_item',
          entityId: String(item.id),
        },
      });
      await doVoid(approval.approvalToken);
    } catch (err) {
      setPinError(message(err));
      // PIN mistakes keep the pad open; anything else is shown and the dialog stays for a retry.
      if (!(
        err instanceof ApiRequestError &&
        (err.code === 'INVALID_PIN' || err.code === 'PIN_LOCKED')
      )) {
        toast.error(message(err));
      }
      throw err;
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('void.title', { name: item.name })}</DialogTitle>
        <DialogDescription>
          {step === 'reason'
            ? needsApproval
              ? t('void.needsApproval')
              : t('void.description')
            : step === 'approver'
              ? t('void.chooseApprover')
              : t('void.enterPin', { name: approver?.name })}
        </DialogDescription>
      </DialogHeader>

      {step === 'reason' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {REASON_KEYS.map((k) => {
              const text = t(`void.reasons.${k}`);
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
            aria-label={t('void.reason')}
            placeholder={t('void.reasonPlaceholder')}
            maxLength={200}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      ) : step === 'approver' ? (
        <div className="flex flex-col gap-2">
          {approvers.data?.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('void.noApprovers')}</p>
          ) : null}
          {approvers.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setApprover(a);
                setStep('pin');
              }}
              className="flex min-h-14 items-center gap-3 rounded-control border border-border px-3 text-left font-semibold hover:bg-surface-sunken"
            >
              <Avatar name={a.name} />
              <span className="flex-1">{a.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <PinPad onComplete={approveWithPin} error={pinError} />
      )}

      <DialogFooter>
        {step !== 'reason' ? (
          <Button variant="ghost" onClick={() => setStep(step === 'pin' ? 'approver' : 'reason')}>
            <ArrowLeft />
            {t('void.back')}
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              {tc('actions.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!reasonOk}
              loading={busy}
              onClick={() => void submitReason()}
            >
              {needsApproval ? t('void.askManager') : t('void.confirm')}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
