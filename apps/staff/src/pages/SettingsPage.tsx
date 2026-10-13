import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import {
  LANGS,
  formatMoney,
  locationUpdateSchema,
  type Lang,
  type Location,
  type MeResponse,
} from '@tavolina/shared';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  SwitchField,
  Textarea,
  cn,
  toast,
} from '@tavolina/ui';
import { PageHeader } from '../components/AppLayout';
import { api } from '../lib/api';
import { useErrorMessages } from '../lib/errors';
import { useSession } from '../lib/session';

interface FormState {
  name: string;
  address: string;
  nipt: string;
  receiptHeader: string;
  receiptFooter: string;
  currencyDisplay: 'L' | 'ALL';
  serviceChargePct: string;
  tipOptionsPct: string;
  defaultLang: Lang;
  languages: Lang[];
  guestOrderingEnabled: boolean;
  guestOrdersRequireConfirmation: boolean;
  waitersSeeAllTables: boolean;
  voidRequiresApproval: boolean;
  discountThresholdPct: string;
}

const bpToPct = (bp: number) => String(bp / 100);
const pctToBp = (pct: string) => Math.round(Number(pct.trim().replace(',', '.')) * 100);

function toForm(l: Location): FormState {
  const s = l.settings;
  return {
    name: l.name,
    address: l.address,
    nipt: l.nipt ?? '',
    receiptHeader: s.receiptHeader,
    receiptFooter: s.receiptFooter,
    currencyDisplay: s.currencyDisplay,
    serviceChargePct: bpToPct(s.serviceChargeBp),
    tipOptionsPct: s.tipOptionsBp.map(bpToPct).join(', '),
    defaultLang: s.defaultLang,
    languages: s.languages,
    guestOrderingEnabled: s.guestOrderingEnabled,
    guestOrdersRequireConfirmation: s.guestOrdersRequireConfirmation,
    waitersSeeAllTables: s.waitersSeeAllTables,
    voidRequiresApproval: s.voidRequiresApproval,
    discountThresholdPct: bpToPct(s.discountApprovalThresholdBp),
  };
}

function toPayload(f: FormState) {
  const tips = f.tipOptionsPct
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(pctToBp);
  return {
    name: f.name,
    address: f.address,
    nipt: f.nipt.trim() ? f.nipt : null,
    settings: {
      receiptHeader: f.receiptHeader,
      receiptFooter: f.receiptFooter,
      currencyDisplay: f.currencyDisplay,
      serviceChargeBp: pctToBp(f.serviceChargePct),
      tipOptionsBp: tips,
      defaultLang: f.defaultLang,
      // The main language is always offered to guests.
      languages: [...new Set<Lang>([f.defaultLang, ...f.languages])],
      guestOrderingEnabled: f.guestOrderingEnabled,
      guestOrdersRequireConfirmation: f.guestOrdersRequireConfirmation,
      waitersSeeAllTables: f.waitersSeeAllTables,
      voidRequiresApproval: f.voidRequiresApproval,
      discountApprovalThresholdBp: pctToBp(f.discountThresholdPct),
    },
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="mb-5 text-base font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </Card>
  );
}

export function SettingsPage() {
  const { t: tc } = useTranslation();
  const locationId = useSession((s) => s.locationId);
  const { message } = useErrorMessages();

  const location = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => api<Location>('GET', '/locations/current'),
  });

  if (location.isPending) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }
  if (location.isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <EmptyState
          title={message(location.error)}
          action={
            <Button variant="outline" onClick={() => void location.refetch()}>
              {tc('actions.retry')}
            </Button>
          }
        />
      </div>
    );
  }
  // Remount the form whenever fresh data arrives (e.g. after saving), so it starts from it.
  return <SettingsForm key={location.dataUpdatedAt} location={location.data} />;
}

function SettingsForm({ location }: { location: Location }) {
  const { t } = useTranslation('business');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();
  const { message, fieldErrors, validate } = useErrorMessages();
  const initial = useMemo(() => toForm(location), [location]);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: (body: unknown) => api<Location>('PATCH', `/locations/${location.id}`, { body }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['location', location.id], saved);
      // The location name may have changed: refresh the switcher and header.
      const me = await api<MeResponse>('GET', '/me');
      useSession.getState().setLocationContext(me);
      toast.success(t('settings.saved'));
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(message(err));
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = toPayload(form);
    const result = validate(locationUpdateSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  }

  const err = (key: string) => errors[key] ?? errors[`settings.${key}`];

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 pb-28 sm:px-8 sm:py-10"
    >
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle', { location: location.name })}
        actions={
          <Button type="button" variant="outline" asChild>
            <Link to="/settings/devices">
              <Printer />
              {t('settings.devices')}
            </Link>
          </Button>
        }
      />

      <Section title={t('settings.sections.business')}>
        <Field label={t('settings.name')} error={err('name')}>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
          <Field label={t('settings.address')} error={err('address')}>
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label={t('settings.nipt')} error={err('nipt')}>
            <Input
              className="font-mono uppercase"
              maxLength={10}
              value={form.nipt}
              onChange={(e) => set('nipt', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('settings.sections.receipt')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('settings.receiptHeader')}
            hint={t('settings.receiptHeaderHint')}
            error={err('receiptHeader')}
          >
            <Textarea
              value={form.receiptHeader}
              onChange={(e) => set('receiptHeader', e.target.value)}
            />
          </Field>
          <Field label={t('settings.receiptFooter')} error={err('receiptFooter')}>
            <Textarea
              value={form.receiptFooter}
              onChange={(e) => set('receiptFooter', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={t('settings.currencyDisplay')}>
            <Select
              value={form.currencyDisplay}
              onValueChange={(v) => set('currencyDisplay', v as 'L' | 'ALL')}
              options={[
                { value: 'L', label: formatMoney(120_000, { currency: 'L' }) },
                { value: 'ALL', label: formatMoney(120_000, { currency: 'ALL' }) },
              ]}
            />
          </Field>
          <Field
            label={t('settings.serviceCharge')}
            hint={t('settings.serviceChargeHint')}
            error={err('serviceChargeBp')}
          >
            <Input
              inputMode="decimal"
              className="font-mono tabular-nums"
              value={form.serviceChargePct}
              onChange={(e) => set('serviceChargePct', e.target.value)}
            />
          </Field>
          <Field
            label={t('settings.tipOptions')}
            hint={t('settings.tipOptionsHint')}
            error={err('tipOptionsBp') ?? errors['settings.tipOptionsBp.0']}
          >
            <Input
              inputMode="decimal"
              className="font-mono tabular-nums"
              value={form.tipOptionsPct}
              onChange={(e) => set('tipOptionsPct', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('settings.sections.languages')}>
        <Field label={t('settings.defaultLang')} hint={t('settings.defaultLangHint')}>
          <Select
            className="sm:w-60"
            value={form.defaultLang}
            onValueChange={(v) => set('defaultLang', v as Lang)}
            options={LANGS.map((l) => ({ value: l, label: tc(`language.${l}`) }))}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{t('settings.languages')}</legend>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => {
              const on = form.languages.includes(l) || l === form.defaultLang;
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  disabled={l === form.defaultLang}
                  onClick={() =>
                    set(
                      'languages',
                      on ? form.languages.filter((x) => x !== l) : [...form.languages, l],
                    )
                  }
                  className={cn(
                    'h-11 rounded-full border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
                    on
                      ? 'border-primary bg-primary-soft text-primary-soft-fg'
                      : 'border-border-strong text-foreground-muted hover:bg-surface-sunken',
                  )}
                >
                  {tc(`language.${l}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Section>

      <Section title={t('settings.sections.guests')}>
        <div className="-my-3 divide-y divide-border">
          <SwitchField
            label={t('settings.guestOrderingEnabled')}
            description={t('settings.guestOrderingEnabledDescription')}
            checked={form.guestOrderingEnabled}
            onCheckedChange={(v) => set('guestOrderingEnabled', v)}
          />
          <SwitchField
            label={t('settings.guestOrdersRequireConfirmation')}
            description={t('settings.guestOrdersRequireConfirmationDescription')}
            checked={form.guestOrdersRequireConfirmation}
            disabled={!form.guestOrderingEnabled}
            onCheckedChange={(v) => set('guestOrdersRequireConfirmation', v)}
          />
          <SwitchField
            label={t('settings.waitersSeeAllTables')}
            description={t('settings.waitersSeeAllTablesDescription')}
            checked={form.waitersSeeAllTables}
            onCheckedChange={(v) => set('waitersSeeAllTables', v)}
          />
        </div>
      </Section>

      <Section title={t('settings.sections.control')}>
        <div className="-my-3 divide-y divide-border">
          <SwitchField
            label={t('settings.voidRequiresApproval')}
            description={t('settings.voidRequiresApprovalDescription')}
            checked={form.voidRequiresApproval}
            onCheckedChange={(v) => set('voidRequiresApproval', v)}
          />
        </div>
        <Field
          label={t('settings.discountThreshold')}
          hint={t('settings.discountThresholdHint')}
          error={err('discountApprovalThresholdBp')}
        >
          <Input
            inputMode="decimal"
            className="font-mono tabular-nums sm:w-40"
            value={form.discountThresholdPct}
            onChange={(e) => set('discountThresholdPct', e.target.value)}
          />
        </Field>
      </Section>

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur transition-transform lg:left-[272px]',
          dirty ? 'translate-y-0' : 'translate-y-full',
        )}
        aria-hidden={!dirty}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <span className="text-sm font-medium text-foreground-muted">{t('settings.unsaved')}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              tabIndex={dirty ? 0 : -1}
              onClick={() => {
                setForm(initial);
                setErrors({});
              }}
            >
              {t('settings.reset')}
            </Button>
            <Button type="submit" loading={save.isPending} tabIndex={dirty ? 0 : -1}>
              {t('settings.save')}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
