import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus } from 'lucide-react';
import {
  STATION_TYPES,
  stationInputSchema,
  taxRateInputSchema,
  type AdminMenu,
  type Station,
  type StationType,
  type TaxRate,
} from '@tavolina/shared';
import { Badge, Button, Card, Field, Input, Select, Switch } from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { useMenuMutation } from './useMenu';

export function SetupTab({ menu }: { menu: AdminMenu }) {
  const canEditTax = useSession((s) => s.permissions.has('settings.edit'));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <StationsCard stations={menu.stations} />
      <TaxRatesCard rates={menu.taxRates} editable={canEditTax} />
    </div>
  );
}

function StationsCard({ stations }: { stations: Station[] }) {
  const { t } = useTranslation('menu');
  const { validate } = useErrorMessages();
  const [name, setName] = useState('');
  const [type, setType] = useState<StationType>('kitchen');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMenuMutation((body: unknown) => api('POST', '/stations', { body }), {
    success: t('setup.saved'),
    onSuccess: () => setName(''),
    onFieldErrors: setErrors,
  });
  const update = useMenuMutation(({ id, ...body }: { id: number } & Partial<Station>) =>
    api('PATCH', `/stations/${id}`, { body }),
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = validate(stationInputSchema, { name, type });
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate({ name, type });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-bold tracking-tight">{t('setup.stations')}</h2>
        <p className="text-sm text-foreground-muted">{t('setup.stationsHint')}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
        {stations.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2">
            <span
              className={
                s.active
                  ? 'flex-1 font-semibold'
                  : 'flex-1 font-semibold text-foreground-subtle line-through'
              }
            >
              {s.name}
            </span>
            <Badge size="sm">{t(`setup.types.${s.type}`)}</Badge>
            <Switch
              checked={s.active}
              aria-label={`${t('setup.active')}: ${s.name}`}
              onCheckedChange={(active) => update.mutate({ id: s.id, active })}
            />
          </li>
        ))}
      </ul>
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end"
      >
        <Field label={t('setup.stationName')} error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('setup.stationType')}>
          <Select
            value={type}
            onValueChange={(v) => setType(v as StationType)}
            options={STATION_TYPES.map((s) => ({ value: s, label: t(`setup.types.${s}`) }))}
          />
        </Field>
        <Button type="submit" variant="outline" loading={create.isPending}>
          <Plus />
          {t('setup.addStation')}
        </Button>
      </form>
    </Card>
  );
}

function TaxRatesCard({ rates, editable }: { rates: TaxRate[]; editable: boolean }) {
  const { t } = useTranslation('menu');
  const { validate } = useErrorMessages();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMenuMutation((body: unknown) => api('POST', '/tax-rates', { body }), {
    success: t('setup.saved'),
    onSuccess: () => {
      setName('');
      setRate('');
    },
    onFieldErrors: setErrors,
  });
  const makeDefault = useMenuMutation((id: number) =>
    api('PATCH', `/tax-rates/${id}`, { body: { isDefault: true } }),
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name,
      rateBp: Math.round(Number(rate.replace(',', '.')) * 100),
      isDefault: rates.length === 0,
    };
    const result = validate(taxRateInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(body);
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-bold tracking-tight">{t('setup.taxRates')}</h2>
        <p className="text-sm text-foreground-muted">{t('setup.taxRatesHint')}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
        {rates.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1 font-semibold">{r.name}</span>
            <span className="font-mono text-sm tabular-nums">{r.rateBp / 100}%</span>
            {r.isDefault ? (
              <Badge tone="success" size="sm" icon={<Check />}>
                {t('setup.default')}
              </Badge>
            ) : editable ? (
              <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(r.id)}>
                {t('setup.makeDefault')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <form
          onSubmit={onSubmit}
          noValidate
          className="grid gap-3 sm:grid-cols-[1fr_110px_auto] sm:items-end"
        >
          <Field label={t('setup.taxName')} error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('setup.taxRate')} error={errors.rateBp}>
            <Input
              inputMode="decimal"
              className="font-mono"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" loading={create.isPending}>
            <Plus />
            {t('setup.addTaxRate')}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
