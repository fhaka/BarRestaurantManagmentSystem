import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { Approver } from '@tavolina/shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@tavolina/ui';
import { api } from '../lib/api';
import type { ApprovalRequest } from '../lib/approval';
import { useErrorMessages } from '../lib/errors';
import { useSession } from '../lib/session';
import { PinPad } from './PinPad';

/** The approval dialog: choose who approves, then their PIN. Use it through `useApproval`. */
export function ApprovalDialog({
  request,
  onDone,
}: {
  request: ApprovalRequest | null;
  onDone: (token: string | null) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent>
        {request ? (
          <ApprovalForm
            key={`${request.action}:${request.entityId}`}
            request={request}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApprovalForm({
  request,
  onDone,
}: {
  request: ApprovalRequest;
  onDone: (token: string | null) => void;
}) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const [approver, setApprover] = useState<Approver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approvers = useQuery({
    queryKey: ['approvers', locationId],
    queryFn: () => api<Approver[]>('GET', '/approvers'),
  });

  const submit = async (pin: string) => {
    setError(null);
    try {
      const res = await api<{ approvalToken: string }>('POST', '/approvals', {
        body: {
          approverId: approver!.id,
          pin,
          action: request.action,
          entityType: request.entityType,
          entityId: String(request.entityId),
        },
      });
      onDone(res.approvalToken);
    } catch (err) {
      setError(message(err));
      throw err;
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          {t('approval.title')}
        </DialogTitle>
        <DialogDescription>
          {request.summary}
          <br />
          {approver ? t('approval.enterPin', { name: approver.name }) : t('approval.choose')}
        </DialogDescription>
      </DialogHeader>
      {approver ? (
        <PinPad onComplete={submit} error={error} />
      ) : (
        <div className="flex flex-col gap-2">
          {approvers.data?.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('approval.nobody')}</p>
          ) : null}
          {approvers.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setApprover(a)}
              className="flex min-h-14 items-center gap-3 rounded-control border border-border px-3 text-left font-semibold hover:bg-surface-sunken"
            >
              <Avatar name={a.name} />
              <span className="flex-1">{a.name}</span>
            </button>
          ))}
        </div>
      )}
      <DialogFooter>
        {approver ? (
          <Button variant="ghost" onClick={() => setApprover(null)}>
            <ArrowLeft />
            {t('approval.back')}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => onDone(null)}>
            {t('approval.cancel')}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
