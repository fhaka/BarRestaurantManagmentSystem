import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { staffCredentialsSchema, type StaffMember } from '@tavolina/shared';
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
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';

export function CredentialsDialog({
  member,
  onOpenChange,
}: {
  member: StaffMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t: tc } = useTranslation();
  // Dialog content unmounts when closed, so the form starts empty each time.
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('actions.close')}>
        {member ? <CredentialsForm member={member} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CredentialsForm({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const { t } = useTranslation('staff');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();
  const { message, fieldErrors, validate } = useErrorMessages();
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api<StaffMember>('POST', `/staff/${member.id}/credentials`, { body }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success(t('credentials.saved', { name: saved.name }));
      onClose();
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(message(err));
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { pin, password };
    const result = validate(staffCredentialsSchema, body);
    if (!result.ok) return setErrors(result.errors);
    mutation.mutate(body);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('credentials.title', { name: member.name })}</DialogTitle>
        <DialogDescription>{t('credentials.description')}</DialogDescription>
      </DialogHeader>
      <form id="credentials-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {errors._form ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors._form}
          </p>
        ) : null}
        <Field label={t('credentials.newPin')} error={errors.pin}>
          <Input
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            className="font-mono tracking-[0.4em]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label={t('credentials.newPassword')} error={errors.password}>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </form>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" form="credentials-form" loading={mutation.isPending}>
          {t('credentials.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
