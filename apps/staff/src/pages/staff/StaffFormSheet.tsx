import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import {
  LANGS,
  ROLE_KEYS,
  canGrantRole,
  staffCreateSchema,
  staffUpdateSchema,
  type Lang,
  type RoleKey,
  type StaffMember,
} from '@tavolina/shared';
import {
  Button,
  Field,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SwitchField,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';

interface FormState {
  name: string;
  email: string;
  phone: string;
  roleKey: RoleKey;
  lang: Lang;
  password: string;
  pin: string;
  active: boolean;
}

const EMPTY: FormState = {
  name: '',
  email: '',
  phone: '',
  roleKey: 'waiter',
  lang: 'sq',
  password: '',
  pin: '',
  active: true,
};

export interface StaffFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this person; omit to create. */
  member?: StaffMember | null;
  onEditCredentials?: (member: StaffMember) => void;
}

export function StaffFormSheet({
  open,
  onOpenChange,
  member,
  onEditCredentials,
}: StaffFormSheetProps) {
  const { t: tc } = useTranslation();
  // The sheet content unmounts when closed, so StaffForm starts fresh on every open.
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" closeLabel={tc('actions.close')}>
        <StaffForm
          member={member ?? null}
          onClose={() => onOpenChange(false)}
          onEditCredentials={onEditCredentials}
        />
      </SheetContent>
    </Sheet>
  );
}

function initialForm(member: StaffMember | null): FormState {
  return member
    ? {
        ...EMPTY,
        name: member.name,
        email: member.email ?? '',
        phone: member.phone ?? '',
        roleKey: member.roleKey,
        lang: member.lang,
        active: member.active,
      }
    : EMPTY;
}

function StaffForm({
  member,
  onClose,
  onEditCredentials,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onEditCredentials?: (member: StaffMember) => void;
}) {
  const { t } = useTranslation('staff');
  const { t: ta } = useTranslation('app');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();
  const permissions = useSession((s) => s.permissions);
  const currentUserId = useSession((s) => s.user?.id);
  const { message, fieldErrors, validate } = useErrorMessages();
  const [form, setForm] = useState<FormState>(() => initialForm(member));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = Boolean(member);
  const isSelf = member?.id === currentUserId;

  const grantable = ROLE_KEYS.filter((r) => canGrantRole(permissions, r));

  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      member
        ? api<StaffMember>('PATCH', `/staff/${member.id}`, { body })
        : api<StaffMember>('POST', '/staff', { body }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success(editing ? t('form.saved') : t('form.created', { name: saved.name }));
      onClose();
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(message(err));
    },
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = editing
      ? {
          name: form.name,
          email: form.email,
          phone: form.phone,
          lang: form.lang,
          ...(isSelf ? {} : { roleKey: form.roleKey, active: form.active }),
        }
      : {
          name: form.name,
          email: form.email,
          phone: form.phone,
          roleKey: form.roleKey,
          lang: form.lang,
          password: form.password,
          pin: form.pin,
        };
    const result = validate(editing ? staffUpdateSchema : staffCreateSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    mutation.mutate(body);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-xl font-bold tracking-tight">
          {member ? t('form.editTitle', { name: member.name }) : t('form.createTitle')}
        </SheetTitle>
        {editing ? null : (
          <SheetDescription className="text-sm text-foreground-muted">
            {t('form.createDescription')}
          </SheetDescription>
        )}
      </SheetHeader>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 pb-2">
        <Field label={t('form.name')} error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={t('form.namePlaceholder')}
            autoComplete="off"
          />
        </Field>
        <Field label={t('form.role')} hint={t('form.roleHint')} error={errors.roleKey}>
          <Select
            value={form.roleKey}
            onValueChange={(v) => set('roleKey', v as RoleKey)}
            disabled={isSelf}
            options={(editing && !grantable.includes(form.roleKey)
              ? [form.roleKey, ...grantable]
              : grantable
            ).map((r) => ({ value: r, label: ta(`roles.${r}`) }))}
          />
        </Field>
        <Field label={t('form.email')} hint={t('form.emailHint')} error={errors.email}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('form.phone')} error={errors.phone}>
            <Input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label={t('form.lang')} error={errors.lang}>
            <Select
              value={form.lang}
              onValueChange={(v) => set('lang', v as Lang)}
              options={LANGS.map((l) => ({ value: l, label: tc(`language.${l}`) }))}
            />
          </Field>
        </div>

        {editing ? (
          <>
            {isSelf ? null : (
              <SwitchField
                label={t('form.active')}
                description={t('form.activeDescription')}
                checked={form.active}
                onCheckedChange={(v) => set('active', v)}
                className="border-t border-border pt-4"
              />
            )}
            {member && onEditCredentials ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onEditCredentials(member)}
                className="self-start"
              >
                <KeyRound />
                {t('form.credentialsButton')}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
            <Field label={t('form.pin')} hint={t('form.pinHint')} error={errors.pin}>
              <Input
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                className="font-mono tracking-[0.4em]"
                value={form.pin}
                onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label={t('form.password')} hint={t('form.passwordHint')} error={errors.password}>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {editing ? t('form.save') : t('form.create')}
          </Button>
        </div>
      </form>
    </>
  );
}
