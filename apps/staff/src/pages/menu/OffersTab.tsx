import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Pencil, Percent, Plus, Trash2 } from 'lucide-react';
import {
  ALL_WEEKDAYS_MASK,
  TIMEZONE,
  formatMoney,
  inTimeWindow,
  localParts,
  priceRuleInputSchema,
  weekdayInMask,
  type AdminMenu,
  type PriceRule,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Switch,
  SwitchField,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { MoneyInput, WeekdayPicker } from './fields';
import { describeWeekdays, useWeekdayNames } from './menu-utils';
import { useMenuMutation } from './useMenu';

function activeNow(rule: PriceRule, now: Date): boolean {
  if (!rule.active) return false;
  const local = localParts(now, TIMEZONE);
  if (rule.dateFrom && local.date < rule.dateFrom) return false;
  if (rule.dateTo && local.date > rule.dateTo) return false;
  return (
    weekdayInMask(local.weekday, rule.weekdayMask) &&
    inTimeWindow(local.minutes, rule.timeFrom, rule.timeTo)
  );
}

export function OffersTab({ menu }: { menu: AdminMenu }) {
  const { t } = useTranslation('menu');
  const [dialog, setDialog] = useState<{ open: boolean; rule: PriceRule | null }>({
    open: false,
    rule: null,
  });
  const [toDelete, setToDelete] = useState<PriceRule | null>(null);
  const weekdays = useWeekdayNames();

  const toggle = useMenuMutation((rule: PriceRule) =>
    api('PATCH', `/menu/price-rules/${rule.id}`, { body: { ...rule, active: !rule.active } }),
  );
  const remove = useMenuMutation((id: number) => api('DELETE', `/menu/price-rules/${id}`), {
    success: t('offers.deleted'),
    onSuccess: () => setToDelete(null),
  });

  const target = (rule: PriceRule) =>
    rule.scope === 'category'
      ? menu.categories.find((c) => c.id === rule.scopeId)?.name
      : menu.items.find((i) => i.id === rule.scopeId)?.name;
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-foreground-muted">
          <Info className="size-4 shrink-0" aria-hidden />
          {t('offers.noStacking')}
        </p>
        <Button onClick={() => setDialog({ open: true, rule: null })}>
          <Plus />
          {t('offers.add')}
        </Button>
      </div>
      {menu.priceRules.length === 0 ? (
        <EmptyState
          icon={<Percent />}
          title={t('offers.emptyTitle')}
          description={t('offers.empty')}
          action={
            <Button onClick={() => setDialog({ open: true, rule: null })}>
              <Plus />
              {t('offers.add')}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {menu.priceRules.map((rule) => (
            <li key={rule.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{rule.name}</span>
                    <Badge tone="highlight" size="sm">
                      {t('offers.off', {
                        value:
                          rule.type === 'percent'
                            ? `${rule.value / 100}%`
                            : formatMoney(rule.value),
                      })}
                    </Badge>
                    {activeNow(rule, now) ? (
                      <Badge tone="success" size="sm">
                        {t('offers.activeNow')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-foreground-muted">
                    {target(rule) ?? '—'} ·{' '}
                    {describeWeekdays(rule.weekdayMask, t('offers.everyDay'), weekdays)} ·{' '}
                    {rule.timeFrom ? `${rule.timeFrom}–${rule.timeTo}` : t('offers.allDay')}
                    {rule.dateFrom || rule.dateTo
                      ? ` · ${rule.dateFrom ?? '…'} → ${rule.dateTo ?? '…'}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={rule.active}
                    onCheckedChange={() => toggle.mutate(rule)}
                    aria-label={t('offers.active')}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.edit')}
                    onClick={() => setDialog({ open: true, rule })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('offers.delete')}
                    onClick={() => setToDelete(rule)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <PriceRuleDialog
        open={dialog.open}
        rule={dialog.rule}
        menu={menu}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('offers.deleteConfirm', { name: toDelete?.name ?? '' })}
        confirmLabel={t('offers.delete')}
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </div>
  );
}

function PriceRuleDialog({
  open,
  rule,
  menu,
  onOpenChange,
}: {
  open: boolean;
  rule: PriceRule | null;
  menu: AdminMenu;
  onOpenChange: (open: boolean) => void;
}) {
  const { t: tc } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('actions.close')} className="max-w-xl">
        <RuleForm rule={rule} menu={menu} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({
  rule,
  menu,
  onClose,
}: {
  rule: PriceRule | null;
  menu: AdminMenu;
  onClose: () => void;
}) {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const { validate } = useErrorMessages();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    scope: rule?.scope ?? ('category' as PriceRule['scope']),
    scopeId: rule?.scopeId ?? menu.categories[0]?.id ?? 0,
    type: rule?.type ?? ('percent' as PriceRule['type']),
    percent: rule?.type === 'percent' ? String(rule.value / 100) : '20',
    amount: rule?.type === 'fixed' ? rule.value : (null as number | null),
    weekdayMask: rule?.weekdayMask ?? ALL_WEEKDAYS_MASK,
    timeFrom: rule?.timeFrom ?? '',
    timeTo: rule?.timeTo ?? '',
    dateFrom: rule?.dateFrom ?? '',
    dateTo: rule?.dateTo ?? '',
    active: rule?.active ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMenuMutation(
    (body: unknown) =>
      rule
        ? api('PATCH', `/menu/price-rules/${rule.id}`, { body })
        : api('POST', '/menu/price-rules', { body }),
    { success: t('offers.saved'), onSuccess: onClose, onFieldErrors: setErrors },
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      scope: form.scope,
      scopeId: form.scopeId,
      type: form.type,
      value:
        form.type === 'percent'
          ? Math.round(Number(form.percent.replace(',', '.')) * 100)
          : (form.amount ?? Number.NaN),
      weekdayMask: form.weekdayMask,
      timeFrom: form.timeFrom || null,
      timeTo: form.timeTo || null,
      dateFrom: form.dateFrom || null,
      dateTo: form.dateTo || null,
      active: form.active,
    };
    const result = validate(priceRuleInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  }

  const targets =
    form.scope === 'category'
      ? menu.categories.map((c) => ({ value: String(c.id), label: c.name }))
      : menu.items.map((i) => ({ value: String(i.id), label: i.name }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule ? t('offers.editTitle') : t('offers.createTitle')}</DialogTitle>
      </DialogHeader>
      <form id="rule-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field label={t('offers.name')} error={errors.name}>
          <Input
            value={form.name}
            placeholder={t('offers.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('offers.scope')}>
            <Select
              value={form.scope}
              onValueChange={(v) => {
                const scope = v as PriceRule['scope'];
                set('scope', scope);
                set(
                  'scopeId',
                  (scope === 'category' ? menu.categories[0]?.id : menu.items[0]?.id) ?? 0,
                );
              }}
              options={[
                { value: 'category', label: t('offers.scopeCategory') },
                { value: 'item', label: t('offers.scopeItem') },
              ]}
            />
          </Field>
          <Field label={t('offers.target')} error={errors.scopeId}>
            <Select
              value={String(form.scopeId)}
              onValueChange={(v) => set('scopeId', Number(v))}
              options={targets}
            />
          </Field>
          <Field label={t('offers.type')}>
            <Select
              value={form.type}
              onValueChange={(v) => set('type', v as PriceRule['type'])}
              options={[
                { value: 'percent', label: t('offers.percent') },
                { value: 'fixed', label: t('offers.fixed') },
              ]}
            />
          </Field>
          <Field label={t('offers.value')} error={errors.value}>
            {form.type === 'percent' ? (
              <div className="relative">
                <Input
                  inputMode="decimal"
                  className="pr-10 font-mono tabular-nums"
                  value={form.percent}
                  onChange={(e) => set('percent', e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-foreground-subtle">
                  %
                </span>
              </div>
            ) : (
              <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} />
            )}
          </Field>
        </div>

        <WeekdayPicker
          label={t('offers.days')}
          value={form.weekdayMask}
          onChange={(v) => set('weekdayMask', v)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label={`${t('offers.hours')} — ${t('categories.from')}`} error={errors.timeFrom}>
            <Input
              type="time"
              value={form.timeFrom}
              onChange={(e) => set('timeFrom', e.target.value)}
            />
          </Field>
          <Field label={t('categories.to')} error={errors.timeTo}>
            <Input
              type="time"
              value={form.timeTo}
              onChange={(e) => set('timeTo', e.target.value)}
            />
          </Field>
          <Field label={t('offers.dateFrom')} hint={t('offers.datesHint')} error={errors.dateFrom}>
            <Input
              type="date"
              value={form.dateFrom}
              onChange={(e) => set('dateFrom', e.target.value)}
            />
          </Field>
          <Field label={t('offers.dateTo')} error={errors.dateTo}>
            <Input
              type="date"
              value={form.dateTo}
              onChange={(e) => set('dateTo', e.target.value)}
            />
          </Field>
        </div>
        <SwitchField
          label={t('offers.active')}
          checked={form.active}
          onCheckedChange={(v) => set('active', v)}
        />
      </form>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" form="rule-form" loading={save.isPending}>
          {t('offers.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
