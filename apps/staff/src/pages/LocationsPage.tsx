import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Building2, MapPin, Plus } from 'lucide-react';
import { locationCreateSchema, type Location, type MeResponse } from '@tavolina/shared';
import {
  Badge,
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
  toast,
} from '@tavolina/ui';
import { PageHeader } from '../components/AppLayout';
import { api, loadLocationContext } from '../lib/api';
import { useErrorMessages } from '../lib/errors';
import { useSession } from '../lib/session';
import { homePath } from '../nav';

export function LocationsPage() {
  const { t } = useTranslation('business');
  const { t: ta } = useTranslation('app');
  const { t: tc } = useTranslation();
  const user = useSession((s) => s.user);
  const currentId = useSession((s) => s.locationId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, fieldErrors, validate } = useErrorMessages();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', nipt: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: (body: unknown) => api<Location>('POST', '/locations', { body }),
    onSuccess: async (location) => {
      // Refresh the user's location list so the switcher includes the new one.
      const me = await api<MeResponse>('GET', '/me');
      useSession.setState({ user: me.user });
      toast.success(t('locations.created', { name: location.name }));
      setOpen(false);
      setForm({ name: '', address: '', nipt: '' });
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(message(err));
    },
  });

  async function switchTo(id: number) {
    try {
      await loadLocationContext(id);
      queryClient.removeQueries();
      navigate(homePath(useSession.getState().can));
    } catch (err) {
      toast.error(message(err));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { name: form.name, address: form.address, nipt: form.nipt || null };
    const result = validate(locationCreateSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(body);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={t('locations.title')}
        subtitle={t('locations.subtitle')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            {t('locations.add')}
          </Button>
        }
      />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(user?.locations ?? []).map((l) => {
          const current = l.id === currentId;
          return (
            <li key={l.id}>
              <Card className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-control bg-primary-soft text-primary-soft-fg">
                    <Building2 className="size-5" aria-hidden />
                  </span>
                  {current ? <Badge tone="success">{t('locations.current')}</Badge> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold tracking-tight">{l.name}</h2>
                  <p className="text-sm text-foreground-muted">
                    {t('locations.yourRole', { role: ta(`roles.${l.roleKey}`) })}
                  </p>
                </div>
                {current ? null : (
                  <Button
                    variant="outline"
                    className="mt-auto self-start"
                    onClick={() => switchTo(l.id)}
                  >
                    {t('locations.switchTo')}
                    <ArrowRight />
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('actions.close')}>
          <DialogHeader>
            <DialogTitle>{t('locations.createTitle')}</DialogTitle>
            <DialogDescription>{t('locations.createDescription')}</DialogDescription>
          </DialogHeader>
          <form id="location-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            <Field label={t('locations.name')} error={errors.name}>
              <Input
                value={form.name}
                placeholder={t('locations.namePlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label={t('locations.address')} error={errors.address}>
              <div className="relative">
                <MapPin
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
                  aria-hidden
                />
                <Input
                  className="pl-9"
                  value={form.address}
                  placeholder={t('locations.addressPlaceholder')}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
            </Field>
            <Field label={t('locations.nipt')} hint={t('locations.niptHint')} error={errors.nipt}>
              <Input
                className="font-mono uppercase"
                maxLength={10}
                value={form.nipt}
                onChange={(e) => setForm((f) => ({ ...f, nipt: e.target.value }))}
              />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" form="location-form" loading={create.isPending}>
              {t('locations.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
